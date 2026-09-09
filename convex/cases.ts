import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { caseStatus, extracted, verdict, verification } from "./schema";
import { bareAddress, redactEmail } from "./lib/mailUtil";
import { rateLimiter } from "./lib/limits";

/**
 * Cases are the heart of the dashboard: one forwarded email, from the second it
 * lands to the moment a guardian says "I called her". Everything here is a
 * plain query so the UI is a live subscription and never polls.
 */

const MAX_LIST = 50;

/**
 * The dashboard link is the capability: whoever the family gave the slug to can
 * read the case list and mark a case handled. Writes still require a signed-in
 * identity so the "handled by" line means something.
 */
async function shieldFor(ctx: QueryCtx, shieldId: Id<"shields">) {
  const shield = await ctx.db.get(shieldId);
  if (!shield) throw new Error("No such shield.");
  return shield;
}

function listRow(c: Doc<"cases">) {
  return {
    _id: c._id,
    receivedAt: c.receivedAt,
    subject: c.subject,
    fromRedacted: c.fromRedacted,
    status: c.status,
    risk: c.risk,
    verdict: c.verdict,
    claimedOrg: c.extracted?.claimedOrg ?? "",
    plainSummary: c.extracted?.plainSummary ?? "",
    repliedAt: c.repliedAt,
    handledAt: c.handledAt,
    handledByName: c.handledByName,
    guardiansAlerted: c.guardiansAlerted ?? 0,
    degraded: c.degraded,
    source: c.source,
  };
}

export const list = query({
  args: { shieldId: v.id("shields") },
  handler: async (ctx, { shieldId }) => {
    const rows = await ctx.db
      .query("cases")
      .withIndex("by_shield_and_receivedAt", (q) => q.eq("shieldId", shieldId))
      .order("desc")
      .take(MAX_LIST);
    return rows.map(listRow);
  },
});

/** The evidence panel: everything we found and the exact reply that went out. */
export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const emails = await ctx.db
      .query("outbound")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .take(10);
    return {
      ...listRow(c),
      bodyExcerpt: c.bodyExcerpt,
      extracted: c.extracted,
      verification: c.verification,
      reasons: c.reasons ?? [],
      replyText: c.replyText,
      model: c.model,
      emails: emails.map((e) => ({
        _id: e._id,
        kind: e.kind,
        toRedacted: e.toRedacted,
        toName: e.toName,
        subject: e.subject,
        sentAt: e.sentAt,
      })),
    };
  },
});

/**
 * Tiles above the list. `since` comes from the browser rather than the server
 * clock, because a query that reads the wall clock does not re-run when time
 * moves and would quietly go stale.
 */
export const stats = query({
  args: { shieldId: v.id("shields"), since: v.number() },
  handler: async (ctx, { shieldId, since }) => {
    const rows = await ctx.db
      .query("cases")
      .withIndex("by_shield_and_receivedAt", (q) => q.eq("shieldId", shieldId))
      .order("desc")
      .take(200);
    const inPeriod = rows.filter((c) => c.receivedAt >= since);
    const replied = rows.filter((c) => c.repliedAt && c.repliedAt > c.receivedAt);
    const replyMs = replied.map((c) => c.repliedAt! - c.receivedAt);
    return {
      checkedThisMonth: inPeriod.length,
      caughtThisMonth: inPeriod.filter((c) => c.verdict === "scam" || c.verdict === "suspicious")
        .length,
      totalCaught: rows.filter((c) => c.verdict === "scam").length,
      falseAlarms: rows.filter((c) => c.status === "false_alarm").length,
      openCases: rows.filter(
        (c) =>
          (c.status === "analyzing" || c.status === "replied") &&
          (c.verdict === "scam" || c.verdict === "suspicious"),
      ).length,
      avgReplyMs: replyMs.length
        ? Math.round(replyMs.reduce((a, b) => a + b, 0) / replyMs.length)
        : null,
    };
  },
});

export const markHandled = mutation({
  args: { caseId: v.id("cases"), name: v.optional(v.string()) },
  handler: async (ctx, { caseId, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("No such case.");
    await shieldFor(ctx, c.shieldId);
    await ctx.db.patch(caseId, {
      status: "handled",
      handledBy: userId,
      handledByName: (name ?? "").trim().slice(0, 40) || "a guardian",
      handledAt: Date.now(),
    });
    return null;
  },
});

export const markFalseAlarm = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("No such case.");
    await shieldFor(ctx, c.shieldId);
    await ctx.db.patch(caseId, { status: "false_alarm", handledBy: userId, handledAt: Date.now() });
    return null;
  },
});

export const reopen = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("No such case.");
    await ctx.db.patch(caseId, { status: c.repliedAt ? "replied" : "analyzing" });
    return null;
  },
});

/**
 * The path a judge can take without an email client: paste the suspicious email
 * and watch the same pipeline run. Returns immediately with an `analyzing` row;
 * the analysis is scheduled, so the UI fills in live.
 */
export const submitPasted = mutation({
  args: { shieldId: v.id("shields"), subject: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    await rateLimiter.limit(ctx, "userLlm", { key: userId, throws: true });
    await rateLimiter.limit(ctx, "globalBurst", { throws: true });
    const shield = await shieldFor(ctx, args.shieldId);

    const body = args.body.trim().slice(0, 12000);
    if (body.length < 20) throw new Error("Paste a bit more of the email.");

    const caseId = await ctx.db.insert("cases", {
      shieldId: shield._id,
      source: "pasted",
      receivedAt: Date.now(),
      subject: args.subject.trim().slice(0, 200) || "(no subject)",
      fromRedacted: "pasted by a guardian",
      bodyExcerpt: body.slice(0, 4000),
      status: "analyzing",
    });
    await ctx.scheduler.runAfter(0, internal.analyze.run, { caseId, sendReply: true });
    return caseId;
  },
});

// ---------------------------------------------------------------- internal

export const byId = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => await ctx.db.get(caseId),
});

/**
 * Turn a routed inbound email into a case and start the pipeline.
 *
 * Two things it deliberately does not do: it does not open a case for a reply
 * to one of our own emails (that is a conversation, not a new forward), and it
 * does not open a case for mail we could not route to a shield — that stays in
 * the unmatched list rather than being silently dropped.
 */
export const intakeFromMail = internalMutation({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const mail = await ctx.db.get(mailMessageId);
    if (!mail || mail.direction !== "in" || !mail.targetId) return null;

    const shieldId = ctx.db.normalizeId("shields", mail.targetId);
    if (!shieldId) return null;
    const shield = await ctx.db.get(shieldId);
    if (!shield) return null;

    if (mail.threadId) {
      const ours = await ctx.db
        .query("mailMessages")
        .withIndex("by_threadId", (q) => q.eq("threadId", mail.threadId))
        .take(20);
      if (ours.some((m) => m.direction === "out")) return null;
    }

    const dupe = await ctx.db
      .query("cases")
      .withIndex("by_mailMessage", (q) => q.eq("mailMessageId", mailMessageId))
      .unique();
    if (dupe) return null;

    const caseId = await ctx.db.insert("cases", {
      shieldId: shield._id,
      mailMessageId,
      messageId: mail.messageId,
      threadId: mail.threadId,
      source: "email",
      receivedAt: mail.at,
      subject: (mail.subject || "(no subject)").slice(0, 200),
      // The forwarding parent's address is a routing key, never display data.
      fromRedacted: redactEmail(bareAddress(mail.from ?? "")),
      bodyExcerpt: (mail.fullText || mail.extractedText || "").slice(0, 4000),
      status: "analyzing",
    });
    await ctx.scheduler.runAfter(0, internal.analyze.run, { caseId, sendReply: true });
    return caseId;
  },
});

export const patchAnalysis = internalMutation({
  args: {
    caseId: v.id("cases"),
    extracted: v.optional(extracted),
    verification: v.optional(verification),
    risk: v.optional(v.number()),
    verdict: v.optional(verdict),
    reasons: v.optional(
      v.array(v.object({ text: v.string(), sourceUrl: v.optional(v.string()) })),
    ),
    replyText: v.optional(v.string()),
    replySentMessageId: v.optional(v.string()),
    repliedAt: v.optional(v.number()),
    status: v.optional(caseStatus),
    degraded: v.optional(v.string()),
    guardiansAlerted: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { caseId, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v2]) => v2 !== undefined));
    if (Object.keys(clean).length > 0) await ctx.db.patch(caseId, clean);
    return null;
  },
});

/** Recent cases for the digest cron and the guardian Q&A agent. */
export const recentForShield = internalQuery({
  args: { shieldId: v.id("shields"), since: v.number(), limit: v.number() },
  handler: async (ctx, { shieldId, since, limit }) => {
    const rows = await ctx.db
      .query("cases")
      .withIndex("by_shield_and_receivedAt", (q) =>
        q.eq("shieldId", shieldId).gte("receivedAt", since),
      )
      .order("desc")
      .take(limit);
    return rows.map((c) => ({
      _id: c._id,
      receivedAt: c.receivedAt,
      subject: c.subject,
      status: c.status,
      risk: c.risk ?? 0,
      verdict: c.verdict,
      claimedOrg: c.extracted?.claimedOrg ?? "",
      senderDomain: c.extracted?.senderDomain ?? "",
      asksFor: c.extracted?.asksFor ?? [],
      plainSummary: c.extracted?.plainSummary ?? "",
      reasons: (c.reasons ?? []).map((r) => r.text),
    }));
  },
});
