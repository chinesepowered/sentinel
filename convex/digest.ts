import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertNotPaused, isRateLimitError, rateLimiter } from "./lib/limits";
import { VERDICT_LABEL } from "./lib/scoring";

/**
 * The two scheduled letters (see convex/crons.ts).
 *
 * They exist because the product's job is not only to answer a forwarded email
 * — it is to keep a family in the loop between incidents. Both are deliberately
 * quiet: a shield with nothing to report gets no email at all, and the whole
 * sweep stops after a small number of sends so a cron can never eat the day's
 * AgentMail budget.
 *
 * Default runtime: no SDK is imported here, the sending goes through the Node
 * action in mailActions.ts.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
/** A cron may never spend more than this many emails in one run. */
const MAX_SENDS_PER_RUN = 6;
const MAX_SHIELDS = 50;

export const weekly = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    assertNotPaused();
    const shields = await ctx.runQuery(internal.shields.allShields, { limit: MAX_SHIELDS });
    const since = Date.now() - WEEK_MS;
    let sent = 0;

    for (const shield of shields) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      const cases = await ctx.runQuery(internal.cases.recentForShield, {
        shieldId: shield._id,
        since,
        limit: 50,
      });
      if (cases.length === 0) continue;

      const scams = cases.filter((c) => c.verdict === "scam");
      const unhandled = cases.filter(
        (c) => (c.verdict === "scam" || c.verdict === "suspicious") && c.status !== "handled",
      );
      const lines = [
        `This week ${shield.protectedFirstName} sent ${cases.length} email${cases.length === 1 ? "" : "s"} to Sentinel to be checked.`,
        "",
        ...cases
          .slice(0, 8)
          .map(
            (c) =>
              `  ${VERDICT_LABEL[(c.verdict ?? "suspicious") as keyof typeof VERDICT_LABEL]} (${c.risk}/100) — ${c.subject}`,
          ),
        "",
        scams.length > 0
          ? `${scams.length} of them ${scams.length === 1 ? "was" : "were"} an outright scam. ${shield.protectedFirstName} was told not to click or reply.`
          : "Nothing outright dangerous got through.",
        unhandled.length > 0
          ? `${unhandled.length} case${unhandled.length === 1 ? " is" : "s are"} still waiting for someone to say they called.`
          : "Every case has been marked handled. Thank you.",
        "",
        `Open the dashboard: ${process.env.SITE_URL ?? ""}/s/${shield.slug}`,
        "",
        "— Sentinel",
      ];

      const guardians = await ctx.runQuery(internal.shields.guardiansOf, {
        shieldId: shield._id,
      });
      for (const g of guardians.filter((x) => x.notify).slice(0, 2)) {
        if (sent >= MAX_SENDS_PER_RUN) break;
        try {
          await rateLimiter.limit(ctx, "globalSend", { throws: true });
          const subject = `Sentinel: what we caught for ${shield.protectedFirstName} this week`;
          const res = await ctx.runAction(internal.mailActions.send, {
            to: g.email,
            subject,
            text: [`Hi ${g.name},`, "", ...lines].join("\n"),
            caseCode: shield.caseCode,
            targetId: shield._id,
          });
          await ctx.runMutation(internal.shields.recordOutbound, {
            shieldId: shield._id,
            kind: "digest",
            to: g.email,
            toName: g.name,
            subject,
            messageId: res.messageId,
          });
          sent += 1;
        } catch (e) {
          if (isRateLimitError(e)) return { sent };
        }
      }
    }
    return { sent };
  },
});

/**
 * The note to the protected person. Its only job is to make forwarding feel
 * like a habit worth keeping, so it never scolds and never asks for anything.
 */
export const monthly = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    assertNotPaused();
    const shields = await ctx.runQuery(internal.shields.allShields, { limit: MAX_SHIELDS });
    const since = Date.now() - MONTH_MS;
    let sent = 0;

    for (const shield of shields) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      const cases = await ctx.runQuery(internal.cases.recentForShield, {
        shieldId: shield._id,
        since,
        limit: 50,
      });
      if (cases.length === 0) continue;
      const bad = cases.filter((c) => c.verdict === "scam" || c.verdict === "suspicious").length;

      const text = [
        `Hi ${shield.protectedFirstName},`,
        "",
        `You sent me ${cases.length} email${cases.length === 1 ? "" : "s"} to check this month.`,
        bad > 0
          ? `${bad} of them ${bad === 1 ? "was" : "were"} trying to trick you, and you did not fall for ${bad === 1 ? "it" : "them"}.`
          : "None of them were dangerous, and checking was still the right thing to do.",
        "",
        "Keep forwarding anything that asks for money, passwords or hurry. That is all you ever have to do.",
        "",
        "— Sentinel",
      ].join("\n");

      try {
        await rateLimiter.limit(ctx, "globalSend", { throws: true });
        const subject = "You did the right thing this month";
        const res = await ctx.runAction(internal.mailActions.send, {
          to: shield.protectedEmail,
          subject,
          text,
          caseCode: shield.caseCode,
          targetId: shield._id,
        });
        await ctx.runMutation(internal.shields.recordOutbound, {
          shieldId: shield._id,
          kind: "monthly_note",
          to: shield.protectedEmail,
          toName: shield.protectedFirstName,
          subject,
          messageId: res.messageId,
        });
        sent += 1;
      } catch (e) {
        if (isRateLimitError(e)) return { sent };
      }
    }
    return { sent };
  },
});

/** Manual trigger for the demo, so the digest can be shown without waiting a week. */
export const runNow = internalAction({
  args: { which: v.union(v.literal("weekly"), v.literal("monthly")) },
  handler: async (ctx, { which }): Promise<{ sent: number }> => {
    return which === "weekly"
      ? await ctx.runAction(internal.digest.weekly, {})
      : await ctx.runAction(internal.digest.monthly, {});
  },
});
