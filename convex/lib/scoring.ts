/**
 * Pure scoring, domain and copy helpers. No SDK imports, so mutations, actions
 * and the seed all share exactly the same rules.
 *
 * THE SAFETY RULE THAT MATTERS: the dangerous failure here is not a scam we
 * call suspicious, it is a scam we call fine. So a model is never allowed to
 * hand out "likely legit" on its own — the code below only lets that verdict
 * stand when the sending domain actually matched a domain we found on the
 * organisation's real website. Everything uncertain lands on "suspicious".
 */

export type Verdict = "scam" | "suspicious" | "likely_legit";

export type Ask =
  | "money"
  | "credentials"
  | "gift_cards"
  | "remote_access"
  | "personal_info"
  | "click_link"
  | "reply"
  | "nothing";

/** Asks that on their own are enough to keep an email off "likely legit". */
const DANGEROUS_ASKS: Ask[] = ["money", "credentials", "gift_cards", "remote_access"];

const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "co.jp", "com.au", "co.nz", "com.br",
  "co.za", "gc.ca", "on.ca", "qc.ca", "com.mx", "co.in", "com.sg",
]);

/** Host out of a URL or an address, lowercased, no port, no www. */
export function hostOf(input: string): string {
  let s = (input ?? "").trim().toLowerCase();
  if (!s) return "";
  const at = s.lastIndexOf("@");
  if (at >= 0 && !s.includes("/")) s = s.slice(at + 1);
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^www\./, "");
  return s.replace(/\.+$/, "");
}

/** example.co.uk out of login.secure.example.co.uk. */
export function registrableDomain(input: string): string {
  const host = hostOf(input);
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return lastTwo;
}

/** True when `domain` is, or sits under, one of the organisation's own domains. */
export function domainMatches(domain: string, officialDomains: string[]): boolean {
  const d = registrableDomain(domain);
  if (!d) return false;
  return officialDomains.some((o) => {
    const od = registrableDomain(o);
    return Boolean(od) && d === od;
  });
}

/**
 * A lookalike is the tell a person misses: the real name is in there, but the
 * domain that actually receives the click is somebody else's.
 */
export function looksLikeImpersonation(domain: string, officialDomains: string[]): boolean {
  const d = registrableDomain(domain);
  if (!d || domainMatches(d, officialDomains)) return false;
  return officialDomains.some((o) => {
    const brand = registrableDomain(o).split(".")[0];
    return brand.length >= 3 && d.includes(brand);
  });
}

/** Risk to verdict. Deliberately coarse: three buckets is all a person needs. */
export function bandVerdict(risk: number): Verdict {
  if (risk >= 70) return "scam";
  if (risk >= 35) return "suspicious";
  return "likely_legit";
}

export type Reason = { text: string; sourceUrl?: string };

export type SafetyInput = {
  risk: number;
  verdict: Verdict;
  reasons: Reason[];
  senderDomain: string;
  linkDomains: string[];
  asksFor: Ask[];
  officialDomains: string[];
  senderMatchesOfficial: boolean;
  /** True when we could not verify the organisation at all. */
  unverified: boolean;
};

/**
 * Clamp whatever the model said into something that cannot reassure by
 * accident. Every adjustment adds its own reason, so the guardian can see the
 * app's rule and not just the model's opinion.
 */
export function applySafetyRules(input: SafetyInput): {
  risk: number;
  verdict: Verdict;
  reasons: Reason[];
} {
  let risk = Math.max(0, Math.min(100, Math.round(input.risk)));
  const reasons = [...input.reasons];
  const add = (text: string, sourceUrl?: string) => {
    if (!reasons.some((r) => r.text === text)) reasons.push({ text, sourceUrl });
  };

  const dangerous = input.asksFor.filter((a) => DANGEROUS_ASKS.includes(a));
  if (dangerous.length > 0 && risk < 60) {
    risk = 60;
    add(`The email asks for ${dangerous.join(", ").replace(/_/g, " ")}, which is never a safe thing to send by email.`);
  }

  const impersonating = [input.senderDomain, ...input.linkDomains].filter((d) =>
    looksLikeImpersonation(d, input.officialDomains),
  );
  if (impersonating.length > 0 && risk < 80) {
    risk = 80;
    add(`${impersonating[0]} borrows the organisation's name but is not one of its real domains.`);
  }

  // The one-way door: nothing may be called fine without a domain match.
  if (bandVerdict(risk) === "likely_legit" && !input.senderMatchesOfficial) {
    risk = Math.max(risk, 40);
    add(
      input.unverified
        ? "We could not confirm this organisation's real website, so we are not calling this safe."
        : "The sending address is not on the organisation's own domain, so we are not calling this safe.",
    );
  }

  return { risk, verdict: bandVerdict(risk), reasons };
}

export const VERDICT_LINE: Record<Verdict, string> = {
  scam: "SCAM — do not reply, do not click.",
  suspicious: "NOT SURE — treat this as unsafe.",
  likely_legit: "THIS ONE LOOKS FINE.",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  scam: "Scam",
  suspicious: "Suspicious",
  likely_legit: "Looks fine",
};

/**
 * The reply the protected person actually reads. Structure is fixed in code —
 * verdict line, one plain sentence, one instruction — and only the middle
 * sentence comes from the model, so a chatty model can never bury the verdict.
 */
export function composeParentReply(args: {
  verdict: Verdict;
  firstName: string;
  claimedOrg: string;
  explanation: string;
  callName?: string;
  callNumber?: string;
}): string {
  const org = args.claimedOrg.trim();
  const explanation = tidy(args.explanation, 240) || fallbackExplanation(args.verdict, org);
  const call = args.callName
    ? `${args.callName}${args.callNumber ? ` at ${args.callNumber}` : ""}`
    : "someone in the family";

  const action =
    args.verdict === "likely_legit"
      ? `What to do: nothing. You were right to check.`
      : args.verdict === "suspicious"
        ? `What to do: do not click anything and do not reply. Call ${call} before you do anything else.`
        : `What to do: delete it. Do not click, do not reply, do not send money. If you are worried, call ${call}.`;

  return [
    `Hi ${args.firstName},`,
    "",
    VERDICT_LINE[args.verdict],
    "",
    explanation,
    "",
    action,
    "",
    "You did the right thing by sending it to me.",
    "",
    "— Sentinel",
  ].join("\n");
}

function fallbackExplanation(verdict: Verdict, org: string): string {
  if (verdict === "likely_legit") {
    return org
      ? `This really does come from ${org}.`
      : "The sender's address checks out against the real organisation's website.";
  }
  return org
    ? `This is not from ${org}, even though it says it is.`
    : "We could not match this sender to any real organisation.";
}

/** The email a guardian gets. Longer, and it names the evidence. */
export function composeGuardianAlert(args: {
  guardianName: string;
  firstName: string;
  verdict: Verdict;
  risk: number;
  subject: string;
  claimedOrg: string;
  reasons: Reason[];
  dashboardUrl: string;
}): string {
  const lines: string[] = [
    `Hi ${args.guardianName},`,
    "",
    `${args.firstName} forwarded an email to Sentinel and it came back ${VERDICT_LABEL[args.verdict].toUpperCase()} (risk ${args.risk}/100).`,
    "",
    `Subject: ${args.subject}`,
  ];
  if (args.claimedOrg) lines.push(`Claims to be: ${args.claimedOrg}`);
  lines.push(
    "",
    "Why:",
    ...args.reasons.slice(0, 4).map((r) => `  - ${r.text}${r.sourceUrl ? ` (${r.sourceUrl})` : ""}`),
    "",
    `${args.firstName} has already been told not to click or reply. A phone call from you is the thing that ends this.`,
    "",
    `Open the case: ${args.dashboardUrl}`,
    "",
    "— Sentinel",
  );
  return lines.join("\n");
}

/** Trim model prose to one tidy sentence-ish string. */
export function tidy(s: string | undefined, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return (stop > 40 ? cut.slice(0, stop + 1) : cut).trim();
}

/** Stable cache key for an organisation name. */
export function orgKeyOf(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|ltd|llc|plc|corp|corporation|company|bank of|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
