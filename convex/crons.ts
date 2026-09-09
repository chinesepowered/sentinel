import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Sentinel keeps working between forwarded emails.
 *
 * Monday morning the guardians get "what we caught this week"; the first of the
 * month the protected person gets a short, warm note telling them the habit is
 * working. Both jobs skip any family with nothing to report and stop after a
 * handful of sends, so the schedule can never drain the free AgentMail tier.
 */
const crons = cronJobs();

crons.cron("weekly guardian digest", "0 15 * * 1", internal.digest.weekly, {});
crons.cron("monthly note to the protected person", "0 15 1 * *", internal.digest.monthly, {});

export default crons;
