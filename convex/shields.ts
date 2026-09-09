import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { newCaseCode, redactEmail } from "./lib/mailUtil";
import { CASE_PREFIX, DEMO_SLUG } from "./lib/app";
import { rateLimiter } from "./lib/limits";

/**
 * A shield is one protected person plus the family around them.
 *
 * PRIVACY RULE, enforced here and not by convention: `protectedEmail` is the
 * inbound routing key and never leaves the server. Every read path below
 * returns `protectedMasked` instead, so the parent's address cannot appear in
 * the dashboard, in a screenshot, or in a demo video.
 */

/** Max shields one (possibly anonymous) account may create. */
const MAX_SHIELDS_PER_USER = 3;

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base.slice(0, 18) || "family";
}

function randomSuffix(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Point an address at a shield. One row per address, newest registration wins. */
async function registerRoute(
  ctx: MutationCtx,
  email: string,
  shieldId: Id<"shields">,
  ownerId: Id<"users"> | undefined,
) {
  const clean = email.toLowerCase().trim();
  if (!clean) return;
  const existing = await ctx.db
    .query("senderRoutes")
    .withIndex("by_email", (q) => q.eq("email", clean))
    .unique();
  if (existing) await ctx.db.patch(existing._id, { targetId: shieldId, ownerId });
  else await ctx.db.insert("senderRoutes", { email: clean, targetId: shieldId, ownerId });
}

/** The public shape of a shield: no full addresses, ever. */
function publicShield(shield: Doc<"shields">) {
  return {
    _id: shield._id,
    slug: shield.slug,
    protectedFirstName: shield.protectedFirstName,
    protectedMasked: redactEmail(shield.protectedEmail),
    caseCode: shield.caseCode,
    callName: shield.callName,
    callNumber: shield.callNumber,
    isDemo: shield.isDemo ?? false,
    createdAt: shield.createdAt,
  };
}

async function inboxAddress(ctx: QueryCtx) {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "singleton"))
    .unique();
  return row?.inboxAddress ?? null;
}

export const create = mutation({
  args: {
    protectedFirstName: v.string(),
    protectedEmail: v.string(),
    callName: v.optional(v.string()),
    callNumber: v.optional(v.string()),
    guardians: v.array(v.object({ name: v.string(), email: v.string() })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");

    // The live URL is public and sign-in is anonymous, so both a per-user cap
    // and the rate limiter stand between a bored visitor and our free tiers.
    await rateLimiter.limit(ctx, "createCase", { key: userId, throws: true });
    const mine = await ctx.db
      .query("shields")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(MAX_SHIELDS_PER_USER + 1);
    if (mine.length >= MAX_SHIELDS_PER_USER) {
      throw new Error(`This demo account already has ${MAX_SHIELDS_PER_USER} shields.`);
    }

    const firstName = args.protectedFirstName.trim().slice(0, 40) || "Mum";
    const protectedEmail = args.protectedEmail.toLowerCase().trim();
    if (!protectedEmail.includes("@")) throw new Error("That does not look like an email address.");

    const shieldId = await ctx.db.insert("shields", {
      ownerId: userId,
      slug: `${slugify(firstName)}-${randomSuffix()}`,
      protectedFirstName: firstName,
      protectedEmail,
      caseCode: newCaseCode(CASE_PREFIX),
      callName: args.callName?.trim() || undefined,
      callNumber: args.callNumber?.trim() || undefined,
      createdAt: Date.now(),
    });

    await registerRoute(ctx, protectedEmail, shieldId, userId);
    for (const g of args.guardians.slice(0, 6)) {
      const email = g.email.toLowerCase().trim();
      if (!email.includes("@")) continue;
      await ctx.db.insert("guardians", {
        shieldId,
        userId,
        email,
        name: g.name.trim().slice(0, 40) || "Family",
        notify: true,
      });
      await registerRoute(ctx, email, shieldId, userId);
    }

    const shield = (await ctx.db.get(shieldId))!;
    return { slug: shield.slug };
  },
});

export const addGuardian = mutation({
  args: { shieldId: v.id("shields"), name: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const shield = await ctx.db.get(args.shieldId);
    if (!shield) throw new Error("No such shield.");
    if (shield.ownerId && shield.ownerId !== userId) throw new Error("Not your shield.");

    const email = args.email.toLowerCase().trim();
    if (!email.includes("@")) throw new Error("That does not look like an email address.");
    const existing = await ctx.db
      .query("guardians")
      .withIndex("by_shield", (q) => q.eq("shieldId", args.shieldId))
      .collect();
    if (existing.length >= 6) throw new Error("Six guardians is the limit on the demo.");
    if (existing.some((g) => g.email === email)) return null;

    await ctx.db.insert("guardians", {
      shieldId: args.shieldId,
      userId,
      email,
      name: args.name.trim().slice(0, 40) || "Family",
      notify: true,
    });
    await registerRoute(ctx, email, args.shieldId, shield.ownerId);
    return null;
  },
});

export const setNotify = mutation({
  args: { guardianId: v.id("guardians"), notify: v.boolean() },
  handler: async (ctx, { guardianId, notify }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const guardian = await ctx.db.get(guardianId);
    if (!guardian) return null;
    const shield = await ctx.db.get(guardian.shieldId);
    if (shield?.ownerId && shield.ownerId !== userId) throw new Error("Not your shield.");
    await ctx.db.patch(guardianId, { notify });
    return null;
  },
});

/**
 * The dashboard read. Keyed by an unguessable slug because the family shares
 * the link with people who never signed up — that link is the capability.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const shield = await ctx.db
      .query("shields")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!shield) return null;
    const userId = await getAuthUserId(ctx);
    const guardians = await ctx.db
      .query("guardians")
      .withIndex("by_shield", (q) => q.eq("shieldId", shield._id))
      .take(10);

    return {
      ...publicShield(shield),
      isOwner: Boolean(userId && shield.ownerId === userId),
      inboxAddress: await inboxAddress(ctx),
      guardians: guardians.map((g) => ({
        _id: g._id,
        name: g.name,
        masked: redactEmail(g.email),
        notify: g.notify,
      })),
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("shields")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(MAX_SHIELDS_PER_USER);
    return rows.map(publicShield);
  },
});

/** The seeded shield everyone lands on, so the app is never empty. */
export const demo = query({
  args: {},
  handler: async (ctx) => {
    const demoShield = await ctx.db
      .query("shields")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();
    return demoShield ? publicShield(demoShield) : null;
  },
});

// ---------------------------------------------------------------- internal

export const byId = internalQuery({
  args: { shieldId: v.id("shields") },
  handler: async (ctx, { shieldId }) => await ctx.db.get(shieldId),
});

export const guardiansOf = internalQuery({
  args: { shieldId: v.id("shields") },
  handler: async (ctx, { shieldId }) =>
    await ctx.db
      .query("guardians")
      .withIndex("by_shield", (q) => q.eq("shieldId", shieldId))
      .take(10),
});

/** Used by the crons to sweep every shield that has seen traffic. */
export const allShields = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) =>
    await ctx.db.query("shields").withIndex("by_slug").take(limit),
});

export const recordOutbound = internalMutation({
  args: {
    shieldId: v.id("shields"),
    caseId: v.optional(v.id("cases")),
    kind: v.union(
      v.literal("verdict_reply"),
      v.literal("guardian_alert"),
      v.literal("digest"),
      v.literal("monthly_note"),
    ),
    to: v.string(),
    toName: v.optional(v.string()),
    subject: v.string(),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("outbound", {
      shieldId: args.shieldId,
      caseId: args.caseId,
      kind: args.kind,
      toRedacted: redactEmail(args.to),
      toName: args.toName,
      subject: args.subject,
      messageId: args.messageId,
      sentAt: Date.now(),
    });
  },
});
