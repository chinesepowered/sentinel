"use node";

import { v } from "convex/values";
import { Agent } from "@convex-dev/agent";
import { action } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { agentModel, modelId } from "./lib/llm";
import { QUOTA_MESSAGE, assertNotPaused, isRateLimitError, rateLimiter } from "./lib/limits";

/**
 * "Has anyone pretended to be her bank before?"
 *
 * A guardian's questions are about a history, not a single email, so this runs
 * on the Convex Agent component: the thread and every message live in Convex,
 * which means a question asked on a phone in the car is still there on the
 * laptop at home. The answer is grounded in the family's own cases, and the
 * agent is told to say it does not know rather than to reassure.
 */
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

const sentinelAgent = new Agent(components.agent, {
  name: "Sentinel guardian assistant",
  languageModel: agentModel(),
  instructions:
    "You help an adult child understand what their parent has been sent. Answer only from the " +
    "case history you are given, in two or three short sentences. Quote subjects and dates when " +
    "they help. If the history does not answer the question, say so plainly — never guess, and " +
    "never reassure anyone that an email is safe.",
});

export const ask = action({
  args: {
    shieldId: v.id("shields"),
    question: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; answer: string; model: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const question = args.question.trim().slice(0, 400);
    if (question.length < 3) throw new Error("Ask a longer question.");

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
      await rateLimiter.limit(ctx, "userLlm", { key: userId, throws: true });
    } catch (e) {
      if (isRateLimitError(e)) throw new Error(QUOTA_MESSAGE);
      throw e;
    }

    const shield = await ctx.runQuery(internal.shields.byId, { shieldId: args.shieldId });
    if (!shield) throw new Error("No such shield.");
    const cases = await ctx.runQuery(internal.cases.recentForShield, {
      shieldId: args.shieldId,
      since: Date.now() - NINETY_DAYS,
      limit: 50,
    });

    const history = cases
      .map(
        (c) =>
          `- ${new Date(c.receivedAt).toISOString().slice(0, 10)} | ${c.verdict ?? "pending"} ` +
          `(risk ${c.risk}) | claims to be: ${c.claimedOrg || "nobody"} | sent from: ${c.senderDomain || "unknown"} ` +
          `| wanted: ${c.asksFor.join(", ") || "nothing"} | ${c.subject} | ${c.plainSummary}`,
      )
      .join("\n");

    const threadId =
      args.threadId ??
      (await sentinelAgent.createThread(ctx, {
        userId,
        title: `${shield.protectedFirstName}'s cases`,
      })).threadId;

    const result = await sentinelAgent.generateText(
      ctx,
      { threadId },
      {
        prompt:
          `The protected person is ${shield.protectedFirstName}.\n\n` +
          `Everything she has forwarded in the last 90 days:\n${history || "(nothing yet)"}\n\n` +
          `Question from a guardian: ${question}`,
      },
    );
    await ctx.runMutation(internal.usage.bump, { provider: "llm" });

    return { threadId, answer: result.text, model: modelId() };
  },
});
