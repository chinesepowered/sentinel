import { useEffect, useState, type ReactNode } from "react";

/** Shared presentation pieces. The verdict is the only loud thing on screen. */

export type Verdict = "scam" | "suspicious" | "likely_legit";

export const VERDICT_UI: Record<
  Verdict,
  { label: string; short: string; text: string; bg: string; border: string; stroke: string; dot: string }
> = {
  scam: {
    label: "Scam",
    short: "SCAM",
    text: "text-scam-700",
    bg: "bg-scam-50",
    border: "border-scam-200",
    stroke: "#dc2626",
    dot: "bg-scam-500",
  },
  suspicious: {
    label: "Suspicious",
    short: "NOT SURE",
    text: "text-warn-700",
    bg: "bg-warn-50",
    border: "border-warn-200",
    stroke: "#d97706",
    dot: "bg-warn-500",
  },
  likely_legit: {
    label: "Looks fine",
    short: "FINE",
    text: "text-safe-700",
    bg: "bg-safe-50",
    border: "border-safe-200",
    stroke: "#16a34a",
    dot: "bg-safe-500",
  },
};

export function verdictUi(v: string | undefined) {
  return VERDICT_UI[(v as Verdict) ?? "suspicious"] ?? VERDICT_UI.suspicious;
}

/** The risk ring: a number a guardian can read across a kitchen at a glance. */
export function RiskRing({
  risk,
  verdict,
  size = 56,
  analyzing = false,
}: {
  risk?: number;
  verdict?: string;
  size?: number;
  analyzing?: boolean;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, risk ?? 0)) / 100;
  const ui = verdictUi(verdict);

  if (analyzing) {
    return (
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="animate-spin" style={{ animationDuration: "1.6s" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#93b1f8"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * 0.25} ${circumference}`}
          />
        </svg>
        <span className="absolute text-[10px] font-semibold text-brand-600">···</span>
      </div>
    );
  }

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ui.stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * pct} ${circumference}`}
          className="ring-sweep"
          style={{ ["--dash" as string]: `${circumference}` }}
        />
      </svg>
      <span className={`absolute text-sm font-bold ${ui.text}`}>{risk ?? "–"}</span>
    </div>
  );
}

export function VerdictPill({ verdict, className = "" }: { verdict?: string; className?: string }) {
  const ui = verdictUi(verdict);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ui.bg} ${ui.border} ${ui.text} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${ui.dot}`} />
      {ui.label}
    </span>
  );
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink-900">{value}</div>
      {sub ? <div className="text-xs text-ink-500">{sub}</div> : null}
    </div>
  );
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function duration(ms: number): string {
  if (ms < 1000) return "under a second";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} seconds`;
  return `${Math.round(s / 60)} minutes`;
}

/** A clock that ticks, so "12s ago" is honest without any polling of the server. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="24" viewBox="0 0 22 24" aria-hidden>
        <path
          d="M11 1.5 20 5v7.2c0 5-3.7 9.2-9 10.3-5.3-1.1-9-5.3-9-10.3V5l9-3.5Z"
          fill="#2557d6"
          stroke="#12275f"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="m6.8 11.8 3 3 5.4-5.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight text-ink-900">Sentinel</span>
    </span>
  );
}

/** Link that keeps the SPA on one page load. */
export function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function A({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
