import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { A, Logo } from "./ui";

/**
 * A small window on the free-tier burn, so the humans running the demo can see
 * what today has cost and whether crawling is still live. The unmatched-mail
 * list underneath is gated to a real (password) account, not merely to being
 * signed in — every visitor here is signed in anonymously.
 */
export function Admin() {
  const usage = useQuery(api.usage.today);
  const crawl = useQuery(api.crawlCache.status);
  const unrouted = useQuery(api.mail.unrouted);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <A href="/">
            <Logo />
          </A>
          <span className="text-sm text-ink-500">Usage</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-5 py-8">
        <div className="card p-5">
          <h1 className="text-lg font-bold text-ink-900">Today's sponsor usage</h1>
          <p className="mt-1 text-sm text-ink-500">
            Counted only when a call actually reached the network — a cached crawl costs nothing and
            is not counted here.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {["llm", "firecrawl", "agentmail"].map((p) => (
              <div key={p} className="rounded-xl border border-line px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {p === "llm" ? "OpenAI calls" : p === "firecrawl" ? "Firecrawl calls" : "Emails sent"}
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {usage ? (usage.counts[p] ?? 0) : "–"}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                usage?.paused ? "bg-scam-50 text-scam-700" : "bg-safe-50 text-safe-700"
              }`}
            >
              {usage?.paused ? "paused (APP_PAUSED=1)" : "running"}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                crawl?.live ? "bg-safe-50 text-safe-700" : "bg-warn-50 text-warn-700"
              }`}
            >
              {crawl?.live ? "crawl budget available" : "crawl budget reserved — serving saved crawls"}
            </span>
            {usage ? <span className="rounded-full bg-slate-page px-2.5 py-1">{usage.day}</span> : null}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Mail we could not route
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Nothing sent to Sentinel is ever dropped silently. Visible only to an account with a
            real email sign-in.
          </p>
          <div className="mt-3 space-y-2">
            {(unrouted ?? []).length === 0 ? (
              <p className="text-sm text-ink-500">Nothing unmatched.</p>
            ) : (
              (unrouted ?? []).map((m) => (
                <div key={m._id} className="rounded-lg border border-line px-3 py-2">
                  <div className="text-sm font-medium text-ink-900">{m.subject}</div>
                  <div className="mono text-xs text-ink-500">{m.from}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
