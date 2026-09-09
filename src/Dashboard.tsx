import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { A, CopyButton, Logo, RiskRing, Tile, VerdictPill, duration, timeAgo, useNow, verdictUi } from "./ui";

/**
 * The guardian dashboard. Everything on this screen is a live Convex
 * subscription: when an email lands in Sentinel's inbox, the row appears here
 * on its own, fills in as each stage of the analysis finishes, and turns green
 * the moment somebody says they called.
 */
export function Dashboard({ slug }: { slug: string }) {
  const shield = useQuery(api.shields.getBySlug, { slug });
  const now = useNow(5000);
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, []);

  if (shield === undefined) return <Loading />;
  if (shield === null) return <NotFound />;

  return <DashboardBody shield={shield} now={now} monthStart={monthStart} />;
}

type Shield = NonNullable<(typeof api.shields.getBySlug)["_returnType"]>;

function DashboardBody({
  shield,
  now,
  monthStart,
}: {
  shield: Shield;
  now: number;
  monthStart: number;
}) {
  const cases = useQuery(api.cases.list, { shieldId: shield._id });
  const stats = useQuery(api.cases.stats, { shieldId: shield._id, since: monthStart });
  const crawl = useQuery(api.crawlCache.status);
  const [selected, setSelected] = useState<Id<"cases"> | null>(null);

  // Follow the newest case automatically, so a forward arriving during a demo
  // opens itself on screen.
  useEffect(() => {
    if (!cases || cases.length === 0) return;
    setSelected((prev) => (prev && cases.some((c) => c._id === prev) ? prev : cases[0]._id));
  }, [cases]);

  const analyzing = cases?.some((c) => c.status === "analyzing") ?? false;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <A href="/">
              <Logo />
            </A>
            <nav className="flex items-center gap-3 text-sm font-medium text-ink-500">
              <A href={`/setup/${shield.slug}`} className="hover:text-brand-700">
                Her setup sheet
              </A>
              <A href="/admin" className="hover:text-brand-700">
                Usage
              </A>
            </nav>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">
                {shield.protectedFirstName}'s shield
              </h1>
              <p className="mt-1 text-sm text-ink-500">
                Protecting <span className="mono">{shield.protectedMasked}</span> ·{" "}
                {shield.guardians.length} guardian{shield.guardians.length === 1 ? "" : "s"} ·{" "}
                <span className="mono">{shield.caseCode}</span>
              </p>
            </div>
            {shield.inboxAddress ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-slate-page px-3 py-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    She forwards to
                  </div>
                  <div className="mono text-sm font-medium text-ink-900">{shield.inboxAddress}</div>
                </div>
                <CopyButton text={shield.inboxAddress} />
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {crawl && !crawl.live ? (
          <p className="mb-4 rounded-xl border border-warn-200 bg-warn-50 px-4 py-2 text-sm text-warn-700">
            The Firecrawl budget for today is reserved, so verification is showing saved results
            from earlier crawls. Every source link below is still real.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Checked this month"
            value={stats ? stats.checkedThisMonth : "–"}
            sub="emails she forwarded"
          />
          <Tile
            label="Caught this month"
            value={stats ? stats.caughtThisMonth : "–"}
            sub="scam or suspicious"
          />
          <Tile
            label="Average reply"
            value={stats?.avgReplyMs ? duration(stats.avgReplyMs) : "–"}
            sub="from arrival to her inbox"
          />
          <Tile
            label="Waiting on a call"
            value={stats ? stats.openCases : "–"}
            sub="not marked handled"
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Forwarded emails
              </h2>
              {analyzing ? (
                <span className="flex items-center gap-1.5 text-xs font-medium text-brand-600">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-2 rounded-full bg-brand-300 animate-pulse-ring" />
                    <span className="relative inline-flex size-2 rounded-full bg-brand-600" />
                  </span>
                  checking now
                </span>
              ) : null}
            </div>

            <div className="mt-3 space-y-2">
              {cases === undefined ? (
                <>
                  <div className="skeleton h-20" />
                  <div className="skeleton h-20" />
                  <div className="skeleton h-20" />
                </>
              ) : cases.length === 0 ? (
                <div className="card px-4 py-8 text-center text-sm text-ink-500">
                  Nothing forwarded yet. Paste an email below to see what happens.
                </div>
              ) : (
                cases.map((c) => (
                  <button
                    key={c._id}
                    onClick={() => setSelected(c._id)}
                    className={`card animate-rise w-full px-4 py-3 text-left transition ${
                      selected === c._id ? "border-brand-300 ring-2 ring-brand-100" : "hover:border-brand-300"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <RiskRing
                        risk={c.risk}
                        verdict={c.verdict}
                        analyzing={c.status === "analyzing"}
                        size={48}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink-900">
                          {c.subject.replace(/^(fwd?|re):\s*/i, "")}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">
                          {c.status === "analyzing"
                            ? "Checking against the real organisation…"
                            : c.claimedOrg
                              ? `Claims to be ${c.claimedOrg}`
                              : c.plainSummary || "No organisation named"}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {c.status === "analyzing" ? (
                            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                              analyzing
                            </span>
                          ) : (
                            <VerdictPill verdict={c.verdict} />
                          )}
                          {c.status === "handled" ? (
                            <span className="rounded-full bg-safe-50 px-2 py-0.5 text-xs font-medium text-safe-700">
                              handled{c.handledByName ? ` by ${c.handledByName}` : ""}
                            </span>
                          ) : null}
                          {c.status === "false_alarm" ? (
                            <span className="rounded-full bg-slate-page px-2 py-0.5 text-xs font-medium text-ink-500">
                              false alarm
                            </span>
                          ) : null}
                          <span className="text-xs text-ink-300">{timeAgo(c.receivedAt, now)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <PasteBox shieldId={shield._id} />
          </section>

          <section className="lg:sticky lg:top-6">
            {selected ? <CaseDetail caseId={selected} now={now} /> : null}
          </section>
        </div>

        <GuardianStrip shield={shield} />
      </main>
    </div>
  );
}

function CaseDetail({ caseId, now }: { caseId: Id<"cases">; now: number }) {
  const c = useQuery(api.cases.get, { caseId });
  const markHandled = useMutation(api.cases.markHandled).withOptimisticUpdate(
    (store, args) => {
      // The primary guardian action, so it lands instantly rather than after a
      // round trip: the row turns green while the mutation is still in flight.
      const detail = store.getQuery(api.cases.get, { caseId: args.caseId });
      if (detail) {
        store.setQuery(
          api.cases.get,
          { caseId: args.caseId },
          {
            ...detail,
            status: "handled",
            handledAt: Date.now(),
            handledByName: args.name ?? "a guardian",
          },
        );
      }
      for (const q of store.getAllQueries(api.cases.list)) {
        if (!q.value || !q.args) continue;
        store.setQuery(
          api.cases.list,
          q.args,
          q.value.map((row) =>
            row._id === args.caseId
              ? {
                  ...row,
                  status: "handled" as const,
                  handledAt: Date.now(),
                  handledByName: args.name ?? "a guardian",
                }
              : row,
          ),
        );
      }
    },
  );
  const markFalseAlarm = useMutation(api.cases.markFalseAlarm);
  const [name, setName] = useState("");

  if (c === undefined) return <div className="skeleton h-96" />;
  if (c === null) return null;

  const ui = verdictUi(c.verdict);
  const analyzing = c.status === "analyzing";

  return (
    <div className="card animate-pop overflow-hidden">
      <div className={`border-b px-5 py-4 ${ui.bg} ${ui.border}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={`text-xl font-extrabold tracking-tight ${ui.text}`}>
              {analyzing ? "Checking this one now…" : ui.label}
              {!analyzing && c.risk !== undefined ? (
                <span className="ml-2 text-sm font-semibold opacity-70">risk {c.risk}/100</span>
              ) : null}
            </div>
            <div className="mt-1 truncate text-sm font-medium text-ink-700">{c.subject}</div>
            <div className="mt-0.5 text-xs text-ink-500">
              Forwarded by <span className="mono">{c.fromRedacted}</span> ·{" "}
              {timeAgo(c.receivedAt, now)}
              {c.repliedAt
                ? ` · replied ${duration(c.repliedAt - c.receivedAt)} after it arrived`
                : ""}
            </div>
          </div>
          <RiskRing risk={c.risk} verdict={c.verdict} analyzing={analyzing} size={64} />
        </div>

        {c.status !== "handled" && c.status !== "false_alarm" ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-32 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm"
            />
            <button
              onClick={() => void markHandled({ caseId: c._id, name: name || undefined })}
              className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-ink-700"
            >
              I called her — mark handled
            </button>
            <button
              onClick={() => void markFalseAlarm({ caseId: c._id })}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-900"
            >
              False alarm
            </button>
          </div>
        ) : (
          <div className="mt-3 text-sm font-medium text-ink-700">
            {c.status === "handled"
              ? `Handled${c.handledByName ? ` by ${c.handledByName}` : ""}${c.handledAt ? ` ${timeAgo(c.handledAt, now)}` : ""}.`
              : "Marked as a false alarm."}
          </div>
        )}
      </div>

      <div className="space-y-5 px-5 py-5">
        {c.degraded ? (
          <p className="rounded-lg border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-700">
            {c.degraded}
          </p>
        ) : null}

        <Section title="Why">
          {analyzing && (c.reasons?.length ?? 0) === 0 ? (
            <div className="space-y-2">
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-4 w-3/5" />
            </div>
          ) : (
            <ul className="space-y-2">
              {c.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-700">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${ui.dot}`} />
                  <span>
                    {r.text}{" "}
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mono text-xs text-brand-600 underline decoration-brand-300 underline-offset-2"
                      >
                        source
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="What we checked">
          {c.verification ? (
            <div className="space-y-3 text-sm">
              <Row label="Claims to be">{c.extracted?.claimedOrg || "no organisation named"}</Row>
              <Row label="Actually sent from">
                <span
                  className={`mono ${c.verification.senderMatchesOfficial ? "text-safe-700" : "text-scam-700"}`}
                >
                  {c.extracted?.senderDomain || "unknown"}
                </span>
              </Row>
              <Row label="Real domains">
                {c.verification.officialDomains.length > 0 ? (
                  <span className="mono text-ink-700">
                    {c.verification.officialDomains.join(", ")}
                  </span>
                ) : (
                  <span className="text-ink-500">could not be confirmed</span>
                )}
                {c.verification.officialSourceUrl ? (
                  <a
                    href={c.verification.officialSourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-2 text-xs text-brand-600 underline underline-offset-2"
                  >
                    source
                  </a>
                ) : null}
              </Row>
              {c.extracted && c.extracted.asksFor.length > 0 ? (
                <Row label="Asks for">
                  <span className="flex flex-wrap gap-1.5">
                    {c.extracted.asksFor.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-slate-page px-2 py-0.5 text-xs font-medium text-ink-700"
                      >
                        {a.replace(/_/g, " ")}
                      </span>
                    ))}
                  </span>
                </Row>
              ) : null}
              {c.verification.linkFindings.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Where its links actually go
                  </div>
                  <div className="mt-2 space-y-2">
                    {c.verification.linkFindings.map((l, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border px-3 py-2 ${
                          l.matchesOfficial
                            ? "border-safe-200 bg-safe-50"
                            : "border-scam-200 bg-scam-50"
                        }`}
                      >
                        <div className="mono text-xs font-medium text-ink-900">{l.domain}</div>
                        <div className="mt-0.5 text-xs text-ink-500">
                          {l.matchesOfficial
                            ? "belongs to the organisation"
                            : l.reachable
                              ? `not the organisation's domain — the page says: "${l.title ?? ""}"`
                              : "not the organisation's domain, and the page would not load"}
                        </div>
                        {l.excerpt ? (
                          <p className="mt-1.5 line-clamp-3 text-xs italic leading-relaxed text-ink-500">
                            {l.excerpt}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {c.verification.fraudPageUrl ? (
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
                  <div className="text-xs font-semibold text-brand-700">
                    The organisation's own scam warning
                  </div>
                  {c.verification.fraudPageExcerpt ? (
                    <p className="mt-1 text-xs leading-relaxed text-ink-700">
                      {c.verification.fraudPageExcerpt}
                    </p>
                  ) : null}
                  <a
                    href={c.verification.fraudPageUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mono mt-1 inline-block text-xs text-brand-600 underline underline-offset-2"
                  >
                    {c.verification.fraudPageUrl}
                  </a>
                </div>
              ) : null}
              <p className="text-xs text-ink-300">
                {c.verification.live
                  ? "Verified with a live crawl of the organisation's website."
                  : "Verified against the organisation's website, from Sentinel's saved crawl."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          )}
        </Section>

        {c.extracted && (c.extracted.urgencyCues.length > 0 || c.extracted.threats.length > 0) ? (
          <Section title="How it tried to rush her">
            <div className="flex flex-wrap gap-1.5">
              {[...c.extracted.urgencyCues, ...c.extracted.threats].map((q, i) => (
                <span
                  key={i}
                  className="rounded-lg bg-warn-50 px-2 py-1 text-xs italic text-warn-700"
                >
                  “{q}”
                </span>
              ))}
            </div>
          </Section>
        ) : null}

        {c.replyText ? (
          <Section title="The reply she received">
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-slate-page px-4 py-3 text-[13px] leading-relaxed text-ink-900">
              {c.replyText}
            </pre>
            <div className="mt-2 space-y-1">
              {c.emails.map((e) => (
                <div key={e._id} className="text-xs text-ink-500">
                  {e.kind === "verdict_reply" ? "Replied to" : "Alerted"}{" "}
                  <span className="font-medium text-ink-700">{e.toName ?? e.toRedacted}</span>{" "}
                  <span className="mono">{e.toRedacted}</span> · {timeAgo(e.sentAt, now)}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="The email she forwarded">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-white px-4 py-3 text-xs leading-relaxed text-ink-500">
            {c.bodyExcerpt}
          </pre>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="w-36 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </span>
      <span className="text-sm text-ink-900">{children}</span>
    </div>
  );
}

const SAMPLE = `---------- Forwarded message ----------
From: Amazon Security <account-update@amazon-billing-verify.com>
Subject: Your Amazon Prime membership could not be renewed

Dear customer,

We could not process the payment for your Amazon Prime membership. Your account will be suspended within 24 hours unless you update your payment details.

Update now: http://amazon-billing-verify.com/prime/update

You will need your password and the card on file.

Amazon Customer Service`;

function PasteBox({ shieldId }: { shieldId: Id<"shields"> }) {
  const submit = useMutation(api.cases.submitPasted);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("Your Amazon Prime membership could not be renewed");
  const [body, setBody] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
        >
          Check an email right now
        </button>
      ) : (
        <div className="card p-4">
          <div className="text-sm font-semibold text-ink-900">Check an email right now</div>
          <p className="mt-1 text-xs text-ink-500">
            Paste anything suspicious. It runs the same pipeline a forwarded email runs, and she
            gets the same reply.
          </p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-xs leading-relaxed"
          />
          {error ? <p className="mt-2 text-xs text-scam-700">{error}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await submit({ shieldId, subject, body });
                  setOpen(false);
                } catch (err) {
                  setError(String((err as Error).message ?? err).replace(/^.*Error:\s*/, ""));
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Check it"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-ink-500 hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GuardianStrip({ shield }: { shield: Shield }) {
  const orgs = useQuery(api.orgs.known);
  return (
    <section className="mt-8 grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Who gets told</h2>
        <div className="mt-3 space-y-2">
          {shield.guardians.length === 0 ? (
            <p className="text-sm text-ink-500">No guardians yet.</p>
          ) : (
            shield.guardians.map((g) => (
              <div key={g._id} className="flex items-center justify-between text-sm">
                <span className="font-medium text-ink-900">{g.name}</span>
                <span className="flex items-center gap-2">
                  <span className="mono text-xs text-ink-500">{g.masked}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      g.notify ? "bg-safe-50 text-safe-700" : "bg-slate-page text-ink-500"
                    }`}
                  >
                    {g.notify ? "alerted" : "muted"}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          Anything scoring 60 or more emails every guardian straight away, with the evidence and a
          link to the case. Everything else waits for the Monday digest.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Organisations Sentinel has verified
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          Shared by every family in the app: once one person's forward pays for the crawl, the next
          family gets the same verified answer for free.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(orgs ?? []).map((o) => (
            <a
              key={o._id}
              href={o.fraudPageUrl ?? o.officialSourceUrl ?? "#"}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-line px-2.5 py-1.5 transition hover:border-brand-300"
            >
              <span className="block text-xs font-semibold capitalize text-ink-900">{o.orgKey}</span>
              <span className="mono block text-[11px] text-ink-500">
                {o.officialDomains.slice(0, 2).join(", ")}
              </span>
            </a>
          ))}
          {orgs && orgs.length === 0 ? (
            <p className="text-sm text-ink-500">Nothing verified yet.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-5 py-10">
      <div className="skeleton h-10 w-64" />
      <div className="skeleton h-24" />
      <div className="skeleton h-96" />
    </div>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-5">
      <div className="text-center">
        <Logo />
        <p className="mt-4 text-ink-500">That shield link does not exist.</p>
        <A href="/" className="mt-4 inline-block text-brand-600 underline">
          Go to the front page
        </A>
      </div>
    </div>
  );
}
