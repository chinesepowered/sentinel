"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { extract, modelId } from "./lib/llm";
import { excerpt, scrape, search } from "./lib/firecrawl";
import { QUOTA_MESSAGE, assertNotPaused, isRateLimitError, rateLimiter } from "./lib/limits";
import { ALERT_THRESHOLD } from "./lib/app";
import {
  type Ask,
  type Reason,
  type Verdict,
  applySafetyRules,
  cleanExcerpt,
  composeGuardianAlert,
  composeParentReply,
  domainMatches,
  orgKeyOf,
  registrableDomain,
  tidy,
} from "./lib/scoring";

/**
 * The pipeline. One forwarded email in, one plain-language verdict out.
 *
 *   1. OpenAI reads the forwarded email and pulls out what it CLAIMS to be.
 *   2. Firecrawl goes and looks at the organisation's real website, so the
 *      answer is grounded in something outside the email itself.
 *   3. Any link in the email gets its landing page fetched in Firecrawl's
 *      sandbox — we never fetch a phishing page from our own runtime.
 *   4. OpenAI scores it, the safety rules in lib/scoring.ts clamp the result,
 *      and AgentMail replies to the parent and alerts the family.
 *
 * Every step writes to the case as it finishes, so the dashboard fills in live
 * rather than blinking from empty to done.
 */

const ASKS: Ask[] = [
  "money",
  "credentials",
  "gift_cards",
  "remote_access",
  "personal_info",
  "click_link",
  "reply",
  "nothing",
];

/** Sites that describe an organisation but are not the organisation. */
const NOT_OFFICIAL = [
  "wikipedia.org", "facebook.com", "linkedin.com", "x.com", "twitter.com",
  "instagram.com", "youtube.com", "reddit.com", "glassdoor.com", "crunchbase.com",
  "bloomberg.com", "trustpilot.com", "indeed.com", "yelp.com", "medium.com",
  "quora.com", "tripadvisor.com", "amazon.com", "apple.com/app-store",
];

const ExtractSchema = z.object({
  claimedOrg: z
    .string()
    .default("")
    .describe("The organisation the email claims to be from, e.g. 'RBC Royal Bank'. Empty if none."),
  originalSenderAddress: z
    .string()
    .default("")
    .describe("The From: address of the ORIGINAL email inside the forward, not the forwarder."),
  linkUrls: z.array(z.string()).default([]).describe("Every http(s) link in the email body."),
  asksFor: z
    .array(z.string())
    .default([])
    .describe(
      "What the email wants, from: money, credentials, gift_cards, remote_access, personal_info, click_link, reply, nothing.",
    ),
  urgencyCues: z
    .array(z.string())
    .default([])
    .describe("Short quotes that create fear or time pressure."),
  threats: z.array(z.string()).default([]).describe("Short quotes threatening a consequence."),
  plainSummary: z
    .string()
    .default("")
    .describe("One short sentence, plain English, describing what the email says."),
});

const OfficialSchema = z.object({
  officialDomains: z
    .array(z.string())
    .default([])
    .describe("Bare domains the organisation itself owns, e.g. ['rbc.com','rbcroyalbank.com']."),
  contactUrl: z.string().default("").describe("URL of the organisation's own contact page, if seen."),
});

const ScoreSchema = z.object({
  risk: z.number().default(50).describe("0 = certainly safe, 100 = certainly a scam."),
  verdict: z.string().default("suspicious").describe("scam | suspicious | likely_legit"),
  reasons: z
    .array(z.object({ text: z.string().default(""), sourceUrl: z.string().default("") }))
    .default([])
    .describe("Two to four short reasons. Cite a sourceUrl from the evidence when one supports it."),
  explanationForParent: z
    .string()
    .default("")
    .describe(
      "ONE sentence, under 25 words, for an 80-year-old. No jargon, no 'phishing', no 'domain'. Say who it really is or is not from.",
    ),
  guardianSummary: z
    .string()
    .default("")
    .describe("One sentence for the adult child, may be technical."),
});

type LinkFinding = {
  domain: string;
  url: string;
  matchesOfficial: boolean;
  reachable: boolean;
  title?: string;
  excerpt?: string;
};

function uniq(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

/** Find the organisation's real domains, once per organisation, for everyone. */
async function verifyOrg(
  ctx: ActionCtx,
  claimedOrg: string,
  orgKey: string,
): Promise<{
  officialDomains: string[];
  officialSourceUrl?: string;
  fraudPageUrl?: string;
  fraudPageExcerpt?: string;
  live: boolean;
}> {
  const cached = await ctx.runQuery(internal.orgs.get, { orgKey });
  if (cached && cached.officialDomains.length > 0) {
    return {
      officialDomains: cached.officialDomains,
      officialSourceUrl: cached.officialSourceUrl,
      fraudPageUrl: cached.fraudPageUrl,
      fraudPageExcerpt: cached.fraudPageExcerpt,
      live: false,
    };
  }
  if (!claimedOrg) return { officialDomains: [], live: false };

  // Two searches, run together: who the organisation really is, and whether it
  // publishes a warning about exactly this kind of email.
  const [site, fraud] = await Promise.all([
    search(ctx, `${claimedOrg} official website contact`, 4),
    search(ctx, `${claimedOrg} fraud alert current scams warning`, 4).catch(() => null),
  ]);
  if (!site.cached && site.data) await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
  if (fraud && !fraud.cached && fraud.data) {
    await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
  }
  const hits = site.data ?? [];
  if (hits.length === 0) return { officialDomains: [], live: !site.stale };

  const candidates = hits
    .map((h) => ({ url: h.url, host: registrableDomain(h.url), title: h.title, description: h.description }))
    .filter((h) => h.host && !NOT_OFFICIAL.some((bad) => h.host.endsWith(bad)));

  // The search finds pages; the model decides which of those domains the
  // organisation actually owns. Grounded in real URLs, never invented.
  let officialDomains: string[] = [];
  let contactUrl: string | undefined;
  try {
    const picked = await extract(
      OfficialSchema,
      `Organisation: ${claimedOrg}\n\nWeb search results:\n` +
        candidates
          .map((c, i) => `${i + 1}. ${c.title ?? ""}\n   ${c.url}\n   ${c.description ?? ""}`)
          .join("\n"),
      {
        system:
          "You identify which domains an organisation genuinely owns. Only list domains that appear in the results. Never guess a domain that is not there.",
        maxTokens: 500,
      },
    );
    await ctx.runMutation(internal.usage.bump, { provider: "llm" });
    officialDomains = uniq(picked.officialDomains.map(registrableDomain)).slice(0, 4);
    contactUrl = picked.contactUrl || undefined;
  } catch {
    officialDomains = [];
  }
  if (officialDomains.length === 0) {
    officialDomains = uniq(candidates.map((c) => c.host)).slice(0, 2);
  }

  // The organisation's own "current scams" page is the strongest citation we
  // can put in front of a worried family, so look for one — but only accept it
  // when it is hosted on a domain we just verified as theirs.
  let fraudPageUrl: string | undefined;
  let fraudPageExcerpt: string | undefined;
  const own = (fraud?.data ?? []).find((h) => domainMatches(h.url, officialDomains));
  if (own) {
    fraudPageUrl = own.url;
    fraudPageExcerpt =
      cleanExcerpt(own.markdown ?? "", 400) || excerpt(own.description ?? "", 400) || undefined;
  }

  if (officialDomains.length > 0) {
    await ctx.runMutation(internal.orgs.put, {
      orgKey,
      officialDomains,
      officialSourceUrl: candidates[0]?.url ?? hits[0]?.url,
      contactUrl,
      fraudPageUrl,
      fraudPageExcerpt,
    });
  }

  return {
    officialDomains,
    officialSourceUrl: candidates[0]?.url ?? hits[0]?.url,
    fraudPageUrl,
    fraudPageExcerpt,
    live: !site.stale,
  };
}

/** Look at where a link actually goes. Firecrawl fetches it, never we do. */
async function inspectLinks(
  ctx: ActionCtx,
  links: string[],
  officialDomains: string[],
): Promise<LinkFinding[]> {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const link of links) {
    const domain = registrableDomain(link);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    targets.push(link);
    if (targets.length >= 2) break;
  }

  const findings: LinkFinding[] = [];
  for (const url of targets) {
    const domain = registrableDomain(url);
    const matchesOfficial = domainMatches(domain, officialDomains);
    if (matchesOfficial) {
      findings.push({ domain, url, matchesOfficial: true, reachable: true });
      continue;
    }
    try {
      const page = await scrape(ctx, url);
      if (!page.cached && page.data) {
        await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
      }
      findings.push({
        domain,
        url,
        matchesOfficial: false,
        reachable: Boolean(page.data?.markdown),
        title: page.data?.title,
        excerpt: page.data ? cleanExcerpt(page.data.markdown, 400) || undefined : undefined,
      });
    } catch {
      // A link that cannot be fetched at all is itself worth knowing.
      findings.push({ domain, url, matchesOfficial: false, reachable: false });
    }
  }
  return findings;
}

export const run = internalAction({
  args: { caseId: v.id("cases"), sendReply: v.boolean() },
  handler: async (ctx, { caseId, sendReply }) => {
    const c = await ctx.runQuery(internal.cases.byId, { caseId });
    if (!c) return null;
    const shield = await ctx.runQuery(internal.shields.byId, { shieldId: c.shieldId });
    if (!shield) return null;
    const limitKey = shield.ownerId ?? "public";

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalLlm", { throws: true });
      await rateLimiter.limit(ctx, "userLlm", { key: limitKey, throws: true });

      // ---- 1. What does this email claim to be? -------------------------
      const raw = await extract(
        ExtractSchema,
        `Subject: ${c.subject}\n\n${c.bodyExcerpt.slice(0, 6000)}`,
        {
          system:
            "You read emails that an older adult has forwarded because they looked suspicious. " +
            "The email is usually a forward, so the interesting sender and links are INSIDE the body. " +
            "Report only what is actually written. Do not judge it yet.",
          maxTokens: 1200,
        },
      );
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });

      const claimedOrg = tidy(raw.claimedOrg, 60);
      const orgKey = orgKeyOf(claimedOrg);
      const senderDomain = registrableDomain(raw.originalSenderAddress);
      const links = uniq(raw.linkUrls.map((l) => l.trim())).slice(0, 8);
      const linkDomains = uniq(links.map(registrableDomain));
      const asksFor = uniq(
        raw.asksFor.map((a) => a.toLowerCase().replace(/[\s-]+/g, "_")),
      ).filter((a): a is Ask => (ASKS as string[]).includes(a));

      const extractedRow = {
        claimedOrg,
        orgKey,
        senderDomain,
        linkDomains,
        links,
        asksFor: asksFor.length > 0 ? asksFor : (["nothing"] as Ask[]),
        urgencyCues: raw.urgencyCues.map((u) => tidy(u, 120)).filter(Boolean).slice(0, 5),
        threats: raw.threats.map((t) => tidy(t, 120)).filter(Boolean).slice(0, 5),
        plainSummary: tidy(raw.plainSummary, 200),
      };
      // Land it now: the guardian watching the dashboard sees the claim appear
      // before the crawl has finished.
      await ctx.runMutation(internal.cases.patchAnalysis, {
        caseId,
        extracted: extractedRow,
        model: modelId(),
      });

      // ---- 2 & 3. Check it against the real world ------------------------
      let org = { officialDomains: [] as string[], live: false } as Awaited<
        ReturnType<typeof verifyOrg>
      >;
      let linkFindings: LinkFinding[] = [];
      try {
        await rateLimiter.limit(ctx, "globalCrawl", { throws: true });
        await rateLimiter.limit(ctx, "userCrawl", { key: limitKey, throws: true });
        org = await verifyOrg(ctx, claimedOrg, orgKey);
        linkFindings = await inspectLinks(ctx, links, org.officialDomains);
      } catch (e) {
        if (!isRateLimitError(e)) throw e;
        // Out of crawl budget: fall back to whatever the shared cache knows.
        const cached = await ctx.runQuery(internal.orgs.get, { orgKey });
        org = {
          officialDomains: cached?.officialDomains ?? [],
          officialSourceUrl: cached?.officialSourceUrl,
          fraudPageUrl: cached?.fraudPageUrl,
          fraudPageExcerpt: cached?.fraudPageExcerpt,
          live: false,
        };
      }

      const senderMatchesOfficial =
        Boolean(senderDomain) &&
        org.officialDomains.length > 0 &&
        domainMatches(senderDomain, org.officialDomains);

      const verificationRow = {
        orgKey,
        officialDomains: org.officialDomains,
        officialSourceUrl: org.officialSourceUrl,
        fraudPageUrl: org.fraudPageUrl,
        fraudPageExcerpt: org.fraudPageExcerpt,
        senderMatchesOfficial,
        linkFindings,
        live: org.live,
        checkedAt: Date.now(),
      };
      await ctx.runMutation(internal.cases.patchAnalysis, {
        caseId,
        verification: verificationRow,
      });

      // ---- 4. Score it, then clamp the score -----------------------------
      const evidence = [
        `Subject: ${c.subject}`,
        `Email body (truncated):\n${c.bodyExcerpt.slice(0, 3000)}`,
        `\nWhat the email claims: ${JSON.stringify(extractedRow)}`,
        `\nWhat the real web says: ${JSON.stringify({
          officialDomains: org.officialDomains,
          officialSourceUrl: org.officialSourceUrl,
          fraudPageUrl: org.fraudPageUrl,
          fraudPageExcerpt: (org.fraudPageExcerpt ?? "").slice(0, 400),
          senderMatchesOfficial,
          linkFindings,
        })}`,
      ].join("\n");

      const scored = await extract(ScoreSchema, evidence, {
        system:
          "You protect an older adult from email scams. You are cautious by design: the dangerous " +
          "mistake is telling someone an email is safe when it is not, so anything you cannot verify " +
          "is suspicious, never safe. Only call an email likely_legit when the sending domain is one " +
          "of the organisation's own verified domains. Cite the evidence URLs you were given.",
        maxTokens: 1200,
      });
      await ctx.runMutation(internal.usage.bump, { provider: "llm" });

      const modelVerdict: Verdict = (["scam", "suspicious", "likely_legit"] as const).includes(
        scored.verdict as Verdict,
      )
        ? (scored.verdict as Verdict)
        : "suspicious";

      const modelReasons: Reason[] = scored.reasons
        .map((r) => ({ text: tidy(r.text, 220), sourceUrl: r.sourceUrl || undefined }))
        .filter((r) => r.text.length > 0)
        .slice(0, 5);

      const safe = applySafetyRules({
        risk: scored.risk,
        verdict: modelVerdict,
        reasons: modelReasons,
        senderDomain,
        linkDomains,
        asksFor: extractedRow.asksFor,
        officialDomains: org.officialDomains,
        senderMatchesOfficial,
        unverified: org.officialDomains.length === 0,
      });

      // A verified source deserves to be visible in the evidence list.
      if (org.fraudPageUrl && safe.verdict !== "likely_legit") {
        safe.reasons.push({
          text: `${claimedOrg || "The organisation"} publishes its own warning about scams like this.`,
          sourceUrl: org.fraudPageUrl,
        });
      }

      const replyText = composeParentReply({
        verdict: safe.verdict,
        firstName: shield.protectedFirstName,
        claimedOrg,
        explanation: scored.explanationForParent,
        callName: shield.callName,
        callNumber: shield.callNumber,
      });

      await ctx.runMutation(internal.cases.patchAnalysis, {
        caseId,
        risk: safe.risk,
        verdict: safe.verdict,
        reasons: safe.reasons,
        replyText,
        status: "replied",
      });

      // ---- 5. Tell the person who forwarded it ---------------------------
      let degraded: string | undefined;
      if (sendReply) {
        try {
          await rateLimiter.limit(ctx, "globalSend", { throws: true });
          await rateLimiter.limit(ctx, "userSend", { key: limitKey, throws: true });
          const sent = await ctx.runAction(internal.mailActions.send, {
            to: shield.protectedEmail,
            subject: `Re: ${c.subject}`.slice(0, 160),
            text: replyText,
            caseCode: shield.caseCode,
            targetId: shield._id,
          });
          await ctx.runMutation(internal.cases.patchAnalysis, {
            caseId,
            replySentMessageId: sent.messageId,
            repliedAt: Date.now(),
          });
          await ctx.runMutation(internal.shields.recordOutbound, {
            shieldId: shield._id,
            caseId,
            kind: "verdict_reply",
            to: shield.protectedEmail,
            toName: shield.protectedFirstName,
            subject: `Re: ${c.subject}`.slice(0, 160),
            messageId: sent.messageId,
          });
        } catch (e) {
          degraded = isRateLimitError(e) ? QUOTA_MESSAGE : "The reply email could not be sent.";
        }
      }

      // ---- 6. Light up the family ----------------------------------------
      let alerted = 0;
      if (safe.risk >= ALERT_THRESHOLD) {
        const guardians = await ctx.runQuery(internal.shields.guardiansOf, {
          shieldId: shield._id,
        });
        const dashboardUrl = `${process.env.SITE_URL ?? ""}/s/${shield.slug}`;
        for (const g of guardians.filter((x) => x.notify).slice(0, 3)) {
          try {
            await rateLimiter.limit(ctx, "globalSend", { throws: true });
            const body = composeGuardianAlert({
              guardianName: g.name,
              firstName: shield.protectedFirstName,
              verdict: safe.verdict,
              risk: safe.risk,
              subject: c.subject,
              claimedOrg,
              reasons: safe.reasons,
              dashboardUrl,
            });
            const subject = `Sentinel alert: ${shield.protectedFirstName} forwarded a ${
              safe.verdict === "scam" ? "scam" : "suspicious"
            } email`;
            const sent = await ctx.runAction(internal.mailActions.send, {
              to: g.email,
              subject,
              text: body,
              caseCode: shield.caseCode,
              targetId: shield._id,
            });
            await ctx.runMutation(internal.shields.recordOutbound, {
              shieldId: shield._id,
              caseId,
              kind: "guardian_alert",
              to: g.email,
              toName: g.name,
              subject,
              messageId: sent.messageId,
            });
            alerted += 1;
          } catch (e) {
            degraded = isRateLimitError(e)
              ? QUOTA_MESSAGE
              : degraded ?? "A guardian alert could not be sent.";
          }
        }
      }

      await ctx.runMutation(internal.cases.patchAnalysis, {
        caseId,
        guardiansAlerted: alerted,
        degraded,
      });
      return null;
    } catch (e) {
      // Failing safe means failing loud: an email we could not finish checking
      // is never described as fine.
      const message = isRateLimitError(e)
        ? QUOTA_MESSAGE
        : String((e as Error)?.message ?? e).slice(0, 200);
      await ctx.runMutation(internal.cases.patchAnalysis, {
        caseId,
        status: "replied",
        risk: c.risk ?? 50,
        verdict: c.verdict ?? "suspicious",
        reasons: c.reasons ?? [
          { text: "Sentinel could not finish checking this email, so it is being treated as unsafe." },
        ],
        replyText:
          c.replyText ??
          composeParentReply({
            verdict: "suspicious",
            firstName: shield.protectedFirstName,
            claimedOrg: "",
            explanation: "I could not finish checking this one, so please treat it as unsafe.",
            callName: shield.callName,
            callNumber: shield.callNumber,
          }),
        degraded: message,
      });
      return null;
    }
  },
});
