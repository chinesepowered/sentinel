import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * What the real organisation's website says, cached across every family in the
 * app. The first person to forward a fake bank email pays for the crawl; every
 * family after them gets the same verified answer for free. This is also what
 * keeps the demo honest when the Firecrawl budget is spent — the evidence in
 * the UI is real, it is just not freshly fetched.
 */

export const get = internalQuery({
  args: { orgKey: v.string() },
  handler: async (ctx, { orgKey }) =>
    await ctx.db
      .query("orgCache")
      .withIndex("by_orgKey", (q) => q.eq("orgKey", orgKey))
      .unique(),
});

export const put = internalMutation({
  args: {
    orgKey: v.string(),
    officialDomains: v.array(v.string()),
    officialSourceUrl: v.optional(v.string()),
    contactUrl: v.optional(v.string()),
    fraudPageUrl: v.optional(v.string()),
    fraudPageExcerpt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgCache")
      .withIndex("by_orgKey", (q) => q.eq("orgKey", args.orgKey))
      .unique();
    const row = { ...args, fetchedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("orgCache", row);
    return null;
  },
});

/** Shown on the dashboard as proof the verification is real, with source links. */
export const known = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("orgCache").order("desc").take(12);
    return rows.map((r) => ({
      _id: r._id,
      orgKey: r.orgKey,
      officialDomains: r.officialDomains,
      officialSourceUrl: r.officialSourceUrl,
      fraudPageUrl: r.fraudPageUrl,
      fetchedAt: r.fetchedAt,
    }));
  },
});
