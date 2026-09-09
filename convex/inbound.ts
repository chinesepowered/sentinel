"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Runs (scheduled, off the webhook path) for every inbound email once it has
 * been stored and routed by mail.ingest.
 *
 * In Sentinel an inbound email is almost always a person forwarding something
 * frightening, so this hands the message to cases.intakeFromMail, which opens a
 * case and schedules the analysis. The webhook itself has already returned 200
 * by now: AgentMail never waits on a model.
 *
 * Node runtime, because the chassis calls it as a Node action.
 */
export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    await ctx.runMutation(internal.cases.intakeFromMail, { mailMessageId });
    return null;
  },
});
