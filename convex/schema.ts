import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Shared chassis tables (usage, settings, mailMessages, senderRoutes,
 * crawlCache, crawlBudget) plus the Sentinel product tables (shields,
 * guardians, cases, orgCache, outbound).
 */

/** Where a case is in its life. `analyzing` is what the dashboard animates. */
export const caseStatus = v.union(
  v.literal("analyzing"),
  v.literal("replied"),
  v.literal("handled"),
  v.literal("false_alarm"),
);

/**
 * Only three verdicts, because the person reading the reply is not a security
 * analyst. `likely_legit` may only ever be set when the sending domain matched
 * the organisation's real domain — see convex/lib/scoring.ts.
 */
export const verdict = v.union(
  v.literal("scam"),
  v.literal("suspicious"),
  v.literal("likely_legit"),
);

/** What the email is trying to get out of the person reading it. */
export const askKind = v.union(
  v.literal("money"),
  v.literal("credentials"),
  v.literal("gift_cards"),
  v.literal("remote_access"),
  v.literal("personal_info"),
  v.literal("click_link"),
  v.literal("reply"),
  v.literal("nothing"),
);

/** What the LLM pulled out of the forwarded email, before any verification. */
export const extracted = v.object({
  claimedOrg: v.string(),
  orgKey: v.string(),
  senderDomain: v.string(),
  linkDomains: v.array(v.string()),
  links: v.array(v.string()),
  asksFor: v.array(askKind),
  urgencyCues: v.array(v.string()),
  threats: v.array(v.string()),
  plainSummary: v.string(),
});

/** What we found on the real web, with the URLs that prove it. */
export const verification = v.object({
  orgKey: v.string(),
  officialDomains: v.array(v.string()),
  officialSourceUrl: v.optional(v.string()),
  fraudPageUrl: v.optional(v.string()),
  fraudPageExcerpt: v.optional(v.string()),
  senderMatchesOfficial: v.boolean(),
  linkFindings: v.array(
    v.object({
      domain: v.string(),
      url: v.string(),
      matchesOfficial: v.boolean(),
      reachable: v.boolean(),
      title: v.optional(v.string()),
      excerpt: v.optional(v.string()),
    }),
  ),
  /** False when the evidence came from our store instead of a live crawl. */
  live: v.boolean(),
  checkedAt: v.number(),
});

export default defineSchema({
  ...authTables,

  /** Daily per-provider counters so free-tier burn is visible on /admin. */
  usage: defineTable({
    day: v.string(), // YYYY-MM-DD
    provider: v.string(), // firecrawl | agentmail | llm
    count: v.number(),
  }).index("by_day_provider", ["day", "provider"]),

  /** Singleton row: the app's one AgentMail inbox. */
  settings: defineTable({
    key: v.string(), // always "singleton"
    inboxId: v.string(),
    inboxAddress: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Every email in or out. Inbound is routed to a case by, in order:
   * thread id, [CASE-CODE] in the subject, then a registered sender address.
   */
  mailMessages: defineTable({
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    subject: v.string(),
    extractedText: v.optional(v.string()),
    fullText: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    /** Product row this message belongs to, once routed. */
    targetId: v.optional(v.string()),
    routed: v.boolean(),
    classification: v.optional(v.string()),
    summary: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()), // sent | delivered | bounced
    at: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId", ["threadId"])
    .index("by_caseCode", ["caseCode"])
    .index("by_target", ["targetId"])
    .index("by_routed", ["routed"]),

  /** Sender address to product row, for "forward your email here" flows. */
  senderRoutes: defineTable({
    email: v.string(),
    targetId: v.string(),
    ownerId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  /** Every Firecrawl result we have ever fetched, kept so a repeat costs nothing
   * and so the app still has data to show once the credit pool is reserved. */
  crawlCache: defineTable({
    key: v.string(),
    payload: v.string(),
    credits: v.number(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Authoritative Firecrawl balance plus today's spend, in credits. */
  crawlBudget: defineTable({
    key: v.string(),
    remainingCredits: v.number(),
    checkedAt: v.number(),
    day: v.string(),
    spentToday: v.number(),
  }).index("by_key", ["key"]),

  // ---------------------------------------------------------------- product

  /**
   * One protected person. `protectedEmail` is the inbound routing key and is
   * NEVER returned to the browser — every read path returns `protectedMasked`
   * instead (see convex/shields.ts).
   */
  shields: defineTable({
    ownerId: v.optional(v.id("users")),
    /** Unguessable; the dashboard URL is /s/<slug> and the family shares it. */
    slug: v.string(),
    protectedFirstName: v.string(),
    protectedEmail: v.string(),
    /** Routing code carried in every subject we send, e.g. SEN-7F3K. */
    caseCode: v.string(),
    /** Phone number the reply tells the parent to call. Optional. */
    callName: v.optional(v.string()),
    callNumber: v.optional(v.string()),
    /** The seeded demo shield is world-readable on purpose. */
    isDemo: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("by_caseCode", ["caseCode"])
    .index("by_protectedEmail", ["protectedEmail"]),

  /** The adult children who get alerted. Their address is a routing key too. */
  guardians: defineTable({
    shieldId: v.id("shields"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.string(),
    notify: v.boolean(),
  })
    .index("by_shield", ["shieldId"])
    .index("by_email", ["email"]),

  /** One forwarded email, from arrival to verdict to "handled". */
  cases: defineTable({
    shieldId: v.id("shields"),
    /** The inbound mailMessages row, when the case came in by email. */
    mailMessageId: v.optional(v.id("mailMessages")),
    messageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    source: v.union(v.literal("email"), v.literal("pasted"), v.literal("seed")),
    receivedAt: v.number(),
    subject: v.string(),
    /** Redacted at write time. The full address never lands in this table. */
    fromRedacted: v.string(),
    bodyExcerpt: v.string(),

    status: caseStatus,
    extracted: v.optional(extracted),
    verification: v.optional(verification),
    risk: v.optional(v.number()),
    verdict: v.optional(verdict),
    reasons: v.optional(
      v.array(v.object({ text: v.string(), sourceUrl: v.optional(v.string()) })),
    ),
    /** Exactly what the protected person was sent, shown to guardians. */
    replyText: v.optional(v.string()),
    replySentMessageId: v.optional(v.string()),
    repliedAt: v.optional(v.number()),
    /** Set when a quota or an outage stopped part of the pipeline. */
    degraded: v.optional(v.string()),
    guardiansAlerted: v.optional(v.number()),
    model: v.optional(v.string()),

    handledBy: v.optional(v.id("users")),
    handledByName: v.optional(v.string()),
    handledAt: v.optional(v.number()),
  })
    .index("by_shield_and_receivedAt", ["shieldId", "receivedAt"])
    .index("by_shield_and_status", ["shieldId", "status"])
    .index("by_mailMessage", ["mailMessageId"]),

  /**
   * Shared across every shield: what the real organisation's site says. One
   * family's forwarded bank scam warms the cache for every other family, so the
   * second "RBC" case in the app costs zero Firecrawl credits.
   */
  orgCache: defineTable({
    orgKey: v.string(),
    officialDomains: v.array(v.string()),
    officialSourceUrl: v.optional(v.string()),
    contactUrl: v.optional(v.string()),
    fraudPageUrl: v.optional(v.string()),
    fraudPageExcerpt: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_orgKey", ["orgKey"]),

  /** Every email the product sent about a shield, for the guardian thread view. */
  outbound: defineTable({
    shieldId: v.id("shields"),
    caseId: v.optional(v.id("cases")),
    kind: v.union(
      v.literal("verdict_reply"),
      v.literal("guardian_alert"),
      v.literal("digest"),
      v.literal("monthly_note"),
    ),
    toRedacted: v.string(),
    toName: v.optional(v.string()),
    subject: v.string(),
    messageId: v.optional(v.string()),
    sentAt: v.number(),
  })
    .index("by_shield_and_sentAt", ["shieldId", "sentAt"])
    .index("by_case", ["caseId"]),
});
