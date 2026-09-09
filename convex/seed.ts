import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { DEMO_SLUG } from "./lib/app";
import { composeParentReply } from "./lib/scoring";

/**
 * The demo family, so the dashboard is alive the moment a judge opens the URL.
 *
 * Everything here is the same shape the live pipeline writes — same extraction,
 * same verification with real source URLs, same replies — because a seed that
 * cheats would make the screenshots a lie. The organisation cache is warmed
 * with real domains too, which is also what a second family joining the app
 * would inherit for free.
 *
 * Run: `pnpm exec convex run seed:demo '{}'` (add --prod for production).
 */

const DAY = 24 * 60 * 60 * 1000;

type SeedCase = {
  daysAgo: number;
  minutesToReply: number;
  subject: string;
  fromRedacted: string;
  body: string;
  claimedOrg: string;
  orgKey: string;
  senderDomain: string;
  links: string[];
  asksFor: Doc<"cases">["extracted"] extends undefined
    ? never
    : NonNullable<Doc<"cases">["extracted"]>["asksFor"];
  urgencyCues: string[];
  threats: string[];
  plainSummary: string;
  officialDomains: string[];
  officialSourceUrl: string;
  fraudPageUrl?: string;
  fraudPageExcerpt?: string;
  linkFindings: NonNullable<Doc<"cases">["verification"]>["linkFindings"];
  risk: number;
  verdict: NonNullable<Doc<"cases">["verdict"]>;
  reasons: { text: string; sourceUrl?: string }[];
  explanation: string;
  status: Doc<"cases">["status"];
  handledByName?: string;
  guardiansAlerted: number;
};

const CASES: SeedCase[] = [
  {
    daysAgo: 2,
    minutesToReply: 0.2,
    subject: "Fwd: URGENT: Your RBC account has been locked",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: RBC Security <alerts@rbc-secure-verify.com>\nSubject: URGENT: Your RBC account has been locked\n\nDear Customer,\n\nWe detected unusual activity on your account. Your online banking has been LOCKED for your protection.\n\nYou must verify your identity within 24 hours or your account will be permanently closed and your funds frozen.\n\nVerify now: http://rbc-secure-verify.com/login\n\nRBC Royal Bank Security Team",
    claimedOrg: "RBC Royal Bank",
    orgKey: "rbc royal",
    senderDomain: "rbc-secure-verify.com",
    links: ["http://rbc-secure-verify.com/login"],
    asksFor: ["credentials", "click_link"],
    urgencyCues: ["within 24 hours", "permanently closed", "funds frozen"],
    threats: ["your account will be permanently closed"],
    plainSummary: "An email says your bank account is locked and asks you to log in through a link.",
    officialDomains: ["rbc.com", "rbcroyalbank.com"],
    officialSourceUrl: "https://www.rbcroyalbank.com/personal.html",
    fraudPageUrl: "https://www.rbc.com/privacysecurity/ca/current-fraud-alerts.html",
    fraudPageExcerpt:
      "Current fraud alerts. RBC will never send you an email asking you to verify your account by clicking a link. If you receive one, do not click it and report it to phishing@rbc.com.",
    linkFindings: [
      {
        domain: "rbc-secure-verify.com",
        url: "http://rbc-secure-verify.com/login",
        matchesOfficial: false,
        reachable: true,
        title: "RBC Online Banking - Sign In",
        excerpt:
          "Sign in to RBC Online Banking. Client Card Number. Password. Verify your identity to restore access to your account.",
      },
    ],
    risk: 97,
    verdict: "scam",
    reasons: [
      {
        text: "The email came from rbc-secure-verify.com, which is not one of RBC's own domains.",
        sourceUrl: "https://www.rbcroyalbank.com/personal.html",
      },
      {
        text: "The link opens a copy of RBC's sign-in page that asks for a card number and password.",
        sourceUrl: "http://rbc-secure-verify.com/login",
      },
      {
        text: "RBC publishes its own warning that it never asks you to verify an account by email link.",
        sourceUrl: "https://www.rbc.com/privacysecurity/ca/current-fraud-alerts.html",
      },
      { text: "The email uses a 24-hour deadline and the threat of frozen funds to rush you." },
    ],
    explanation: "This is not from RBC. It is a copy of their page built to steal your password.",
    status: "handled",
    handledByName: "Sarah",
    guardiansAlerted: 2,
  },
  {
    daysAgo: 5,
    minutesToReply: 0.3,
    subject: "Fwd: Grandma please help me",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: Daniel <daniel.help2291@gmail.com>\nSubject: Grandma please help me\n\nGrandma it's Daniel. I'm in trouble and I can't call. I was in an accident and the police took my phone.\n\nI need $2,400 for bail today. Please don't tell mom and dad, I'm so embarrassed.\n\nThe lawyer says the fastest way is Google Play gift cards. Buy them at the pharmacy and send me the codes on the back.\n\nPlease hurry grandma. I love you.",
    claimedOrg: "",
    orgKey: "",
    senderDomain: "gmail.com",
    links: [],
    asksFor: ["gift_cards", "money", "reply"],
    urgencyCues: ["today", "please hurry", "I can't call"],
    threats: ["I'm in trouble", "the police took my phone"],
    plainSummary: "Someone claiming to be your grandson asks for gift cards and says not to tell anyone.",
    officialDomains: [],
    officialSourceUrl: "",
    linkFindings: [],
    risk: 94,
    verdict: "scam",
    reasons: [
      { text: "It asks for gift card codes, which no court, lawyer or police force has ever accepted." },
      { text: "It tells you to keep it secret from the rest of the family, which is what these emails always do." },
      { text: "The sending address is a free mailbox that has nothing to do with your grandson." },
    ],
    explanation: "This is not Daniel. Someone is pretending to be him to get gift cards from you.",
    status: "handled",
    handledByName: "Tom",
    guardiansAlerted: 2,
  },
  {
    daysAgo: 8,
    minutesToReply: 0.2,
    subject: "Fwd: Canada Revenue Agency - refund of $1,472.30 pending",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: CRA Refunds <refund@cra-benefit-canada.net>\nSubject: Canada Revenue Agency - refund of $1,472.30 pending\n\nAfter the last calculation of your fiscal activity we have determined that you are eligible to receive a tax refund of $1,472.30.\n\nTo receive your refund you must submit your banking details and SIN through our secure portal.\n\nClaim your refund: http://cra-benefit-canada.net/refund\n\nFailure to claim within 5 business days will result in forfeiture.",
    claimedOrg: "Canada Revenue Agency",
    orgKey: "canada revenue agency",
    senderDomain: "cra-benefit-canada.net",
    links: ["http://cra-benefit-canada.net/refund"],
    asksFor: ["personal_info", "credentials", "click_link"],
    urgencyCues: ["within 5 business days", "forfeiture"],
    threats: ["will result in forfeiture"],
    plainSummary: "An email offers a tax refund if you enter your bank details and social insurance number.",
    officialDomains: ["canada.ca", "cra-arc.gc.ca"],
    officialSourceUrl: "https://www.canada.ca/en/revenue-agency.html",
    fraudPageUrl: "https://www.canada.ca/en/revenue-agency/corporate/security/protect-yourself-against-fraud.html",
    fraudPageExcerpt:
      "Protect yourself against fraud. The CRA will never ask for personal information by email or text message, and will never demand immediate payment by e-transfer or gift card.",
    linkFindings: [
      {
        domain: "cra-benefit-canada.net",
        url: "http://cra-benefit-canada.net/refund",
        matchesOfficial: false,
        reachable: false,
      },
    ],
    risk: 91,
    verdict: "scam",
    reasons: [
      {
        text: "The Canada Revenue Agency only uses canada.ca; this came from cra-benefit-canada.net.",
        sourceUrl: "https://www.canada.ca/en/revenue-agency.html",
      },
      {
        text: "The CRA says on its own site that it never asks for personal information by email.",
        sourceUrl: "https://www.canada.ca/en/revenue-agency/corporate/security/protect-yourself-against-fraud.html",
      },
      { text: "It asks for your banking details and social insurance number, which is never safe to send." },
    ],
    explanation: "This is not the tax office. A real refund never needs your bank details by email.",
    status: "replied",
    guardiansAlerted: 2,
  },
  {
    daysAgo: 11,
    minutesToReply: 0.2,
    subject: "Fwd: Your Netflix membership is on hold",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: Netflix <no-reply@netflix-billing-update.com>\nSubject: Your Netflix membership is on hold\n\nWe're having some trouble with your current billing information. We'll try again, but in the meantime you may want to update your payment details.\n\nUpdate account: http://netflix-billing-update.com/account\n\nNeed help? We're here if you need it.",
    claimedOrg: "Netflix",
    orgKey: "netflix",
    senderDomain: "netflix-billing-update.com",
    links: ["http://netflix-billing-update.com/account"],
    asksFor: ["credentials", "money", "click_link"],
    urgencyCues: ["membership is on hold"],
    threats: [],
    plainSummary: "An email says your Netflix payment failed and asks you to update your card.",
    officialDomains: ["netflix.com"],
    officialSourceUrl: "https://www.netflix.com/",
    linkFindings: [
      {
        domain: "netflix-billing-update.com",
        url: "http://netflix-billing-update.com/account",
        matchesOfficial: false,
        reachable: true,
        title: "Netflix - Update your payment details",
        excerpt: "Update your payment method. Card number. Expiry. CVV. Billing postcode.",
      },
    ],
    risk: 88,
    verdict: "scam",
    reasons: [
      {
        text: "Netflix only sends mail from netflix.com; this came from netflix-billing-update.com.",
        sourceUrl: "https://www.netflix.com/",
      },
      {
        text: "The page behind the link asks for a full card number and security code.",
        sourceUrl: "http://netflix-billing-update.com/account",
      },
    ],
    explanation: "This is not Netflix. The page it sends you to is collecting card numbers.",
    status: "handled",
    handledByName: "Sarah",
    guardiansAlerted: 1,
  },
  {
    daysAgo: 14,
    minutesToReply: 0.3,
    subject: "Fwd: Is this real? Photos from the library book club",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: Ottawa Public Library <newsletter@biblioottawalibrary.ca>\nSubject: Photos from the book club\n\nThank you to everyone who joined us on Thursday. Photos from the evening are on our events page, and next month's title is announced below.\n\nNo action needed - see you next month.",
    claimedOrg: "Ottawa Public Library",
    orgKey: "ottawa public library",
    senderDomain: "biblioottawalibrary.ca",
    links: ["https://biblioottawalibrary.ca/en/events"],
    asksFor: ["nothing"],
    urgencyCues: [],
    threats: [],
    plainSummary: "A newsletter from the library with photos from the book club.",
    officialDomains: ["biblioottawalibrary.ca"],
    officialSourceUrl: "https://biblioottawalibrary.ca/en",
    linkFindings: [
      {
        domain: "biblioottawalibrary.ca",
        url: "https://biblioottawalibrary.ca/en/events",
        matchesOfficial: true,
        reachable: true,
      },
    ],
    risk: 8,
    verdict: "likely_legit",
    reasons: [
      {
        text: "The sender's address is on the library's own domain, biblioottawalibrary.ca.",
        sourceUrl: "https://biblioottawalibrary.ca/en",
      },
      { text: "It asks for nothing at all: no money, no password, no hurry." },
    ],
    explanation: "This really is from the library. Nothing here is asking you for anything.",
    status: "replied",
    guardiansAlerted: 0,
  },
  {
    daysAgo: 19,
    minutesToReply: 0.4,
    subject: "Fwd: Microsoft support - your computer has a virus, call now",
    fromRedacted: "***@agentmail.to",
    body:
      "---------- Forwarded message ----------\nFrom: Microsoft Support <support@ms-defender-alert.info>\nSubject: CRITICAL: your computer has a virus\n\nWindows Defender has detected 3 threats on your computer. Your personal files and banking passwords are at risk.\n\nCall Microsoft certified technicians immediately at 1-888-555-0142 and do not restart your computer.\n\nOur technician will connect to your computer to remove the infection.",
    claimedOrg: "Microsoft",
    orgKey: "microsoft",
    senderDomain: "ms-defender-alert.info",
    links: [],
    asksFor: ["remote_access", "money"],
    urgencyCues: ["immediately", "do not restart your computer"],
    threats: ["your personal files and banking passwords are at risk"],
    plainSummary: "An email says your computer is infected and tells you to phone a number for help.",
    officialDomains: ["microsoft.com"],
    officialSourceUrl: "https://www.microsoft.com/",
    fraudPageUrl: "https://www.microsoft.com/en-us/wdsi/threats/support-scams",
    fraudPageExcerpt:
      "Microsoft error and warning messages never include a phone number. Microsoft does not send unsolicited email messages or make unsolicited phone calls to request personal or financial information.",
    linkFindings: [],
    risk: 92,
    verdict: "scam",
    reasons: [
      {
        text: "Microsoft states on its own site that its warnings never include a phone number to call.",
        sourceUrl: "https://www.microsoft.com/en-us/wdsi/threats/support-scams",
      },
      { text: "The email came from ms-defender-alert.info, which Microsoft does not own." },
      { text: "It wants someone to connect to your computer, which hands them everything on it." },
    ],
    explanation: "This is not Microsoft. Anyone who answers that number wants into your computer.",
    status: "false_alarm",
    guardiansAlerted: 2,
  },
];

const ORGS = [
  {
    orgKey: "rbc royal",
    officialDomains: ["rbc.com", "rbcroyalbank.com"],
    officialSourceUrl: "https://www.rbcroyalbank.com/personal.html",
    contactUrl: "https://www.rbcroyalbank.com/contact-us/index.html",
    fraudPageUrl: "https://www.rbc.com/privacysecurity/ca/current-fraud-alerts.html",
    fraudPageExcerpt:
      "Current fraud alerts. RBC will never send you an email asking you to verify your account by clicking a link.",
  },
  {
    orgKey: "canada revenue agency",
    officialDomains: ["canada.ca", "cra-arc.gc.ca"],
    officialSourceUrl: "https://www.canada.ca/en/revenue-agency.html",
    contactUrl: "https://www.canada.ca/en/revenue-agency/corporate/contact-information.html",
    fraudPageUrl:
      "https://www.canada.ca/en/revenue-agency/corporate/security/protect-yourself-against-fraud.html",
    fraudPageExcerpt:
      "The CRA will never ask for personal information by email or text message, and will never demand immediate payment by gift card.",
  },
  {
    orgKey: "netflix",
    officialDomains: ["netflix.com"],
    officialSourceUrl: "https://www.netflix.com/",
    contactUrl: "https://help.netflix.com/en/contactus",
    fraudPageUrl: "https://help.netflix.com/en/node/65674",
    fraudPageExcerpt:
      "Netflix will never ask for your payment information over email or text. Do not click links in a suspicious message.",
  },
  {
    orgKey: "microsoft",
    officialDomains: ["microsoft.com"],
    officialSourceUrl: "https://www.microsoft.com/",
    contactUrl: "https://support.microsoft.com/contactus",
    fraudPageUrl: "https://www.microsoft.com/en-us/wdsi/threats/support-scams",
    fraudPageExcerpt:
      "Microsoft error and warning messages never include a phone number. Microsoft does not make unsolicited phone calls to request personal or financial information.",
  },
];

export const demo = internalMutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, { reset }) => {
    // The demo family's protected address is the demo mailbox, so a real
    // forward sent during a recording routes straight into this shield.
    const protectedEmail = (
      process.env.DEMO_RECIPIENT_OVERRIDE || "margaret.demo@example.com"
    ).toLowerCase();

    let shield = await ctx.db
      .query("shields")
      .withIndex("by_slug", (q) => q.eq("slug", DEMO_SLUG))
      .unique();

    let shieldId: Id<"shields">;
    if (shield) {
      shieldId = shield._id;
      await ctx.db.patch(shieldId, { protectedEmail, isDemo: true });
    } else {
      shieldId = await ctx.db.insert("shields", {
        slug: DEMO_SLUG,
        protectedFirstName: "Margaret",
        protectedEmail,
        caseCode: "SEN-DEMO",
        callName: "Sarah",
        callNumber: "(613) 555-0136",
        isDemo: true,
        createdAt: Date.now() - 40 * DAY,
      });
    }
    shield = (await ctx.db.get(shieldId))!;

    // Route mail from the demo mailbox to the demo shield.
    const existingRoute = await ctx.db
      .query("senderRoutes")
      .withIndex("by_email", (q) => q.eq("email", protectedEmail))
      .unique();
    if (existingRoute) await ctx.db.patch(existingRoute._id, { targetId: shieldId });
    else await ctx.db.insert("senderRoutes", { email: protectedEmail, targetId: shieldId });

    const guardians = await ctx.db
      .query("guardians")
      .withIndex("by_shield", (q) => q.eq("shieldId", shieldId))
      .collect();
    if (guardians.length === 0) {
      for (const g of [
        { name: "Sarah", email: "sarah.demo@example.com" },
        { name: "Tom", email: "tom.demo@example.com" },
      ]) {
        await ctx.db.insert("guardians", { shieldId, ...g, notify: true });
      }
    }

    for (const org of ORGS) {
      const existing = await ctx.db
        .query("orgCache")
        .withIndex("by_orgKey", (q) => q.eq("orgKey", org.orgKey))
        .unique();
      const row = { ...org, fetchedAt: Date.now() - 3 * DAY };
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("orgCache", row);
    }

    const existingCases = await ctx.db
      .query("cases")
      .withIndex("by_shield_and_receivedAt", (q) => q.eq("shieldId", shieldId))
      .collect();
    if (reset) {
      for (const c of existingCases) await ctx.db.delete(c._id);
    } else if (existingCases.length > 0) {
      return { shieldId, slug: DEMO_SLUG, cases: existingCases.length, seeded: false };
    }

    const now = Date.now();
    for (const s of CASES) {
      const receivedAt = now - s.daysAgo * DAY;
      const repliedAt = receivedAt + Math.round(s.minutesToReply * 60_000);
      const caseId = await ctx.db.insert("cases", {
        shieldId,
        source: "seed",
        receivedAt,
        subject: s.subject,
        fromRedacted: s.fromRedacted,
        bodyExcerpt: s.body,
        status: s.status,
        extracted: {
          claimedOrg: s.claimedOrg,
          orgKey: s.orgKey,
          senderDomain: s.senderDomain,
          linkDomains: [...new Set(s.linkFindings.map((l) => l.domain))],
          links: s.links,
          asksFor: s.asksFor,
          urgencyCues: s.urgencyCues,
          threats: s.threats,
          plainSummary: s.plainSummary,
        },
        verification: {
          orgKey: s.orgKey,
          officialDomains: s.officialDomains,
          officialSourceUrl: s.officialSourceUrl || undefined,
          fraudPageUrl: s.fraudPageUrl,
          fraudPageExcerpt: s.fraudPageExcerpt,
          senderMatchesOfficial: s.verdict === "likely_legit",
          linkFindings: s.linkFindings,
          live: false,
          checkedAt: receivedAt,
        },
        risk: s.risk,
        verdict: s.verdict,
        reasons: s.reasons,
        replyText: composeParentReply({
          verdict: s.verdict,
          firstName: shield.protectedFirstName,
          claimedOrg: s.claimedOrg,
          explanation: s.explanation,
          callName: shield.callName,
          callNumber: shield.callNumber,
        }),
        repliedAt,
        guardiansAlerted: s.guardiansAlerted,
        handledByName: s.handledByName,
        handledAt: s.status === "handled" ? repliedAt + 6 * 60_000 : undefined,
        model: "seeded",
      });

      await ctx.db.insert("outbound", {
        shieldId,
        caseId,
        kind: "verdict_reply",
        toRedacted: "***@agentmail.to",
        toName: shield.protectedFirstName,
        subject: `Re: ${s.subject}`,
        sentAt: repliedAt,
      });
      for (let i = 0; i < s.guardiansAlerted; i++) {
        await ctx.db.insert("outbound", {
          shieldId,
          caseId,
          kind: "guardian_alert",
          toRedacted: "***@example.com",
          toName: i === 0 ? "Sarah" : "Tom",
          subject: `Sentinel alert: Margaret forwarded a ${s.verdict === "scam" ? "scam" : "suspicious"} email`,
          sentAt: repliedAt + 2000,
        });
      }
    }

    return { shieldId, slug: DEMO_SLUG, cases: CASES.length, seeded: true };
  },
});
