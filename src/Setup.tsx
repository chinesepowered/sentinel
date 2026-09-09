import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import QRCode from "qrcode";
import { api } from "../convex/_generated/api";
import { A, Logo } from "./ui";

/**
 * The printable one-pager that ends up on a fridge.
 *
 * It is the only screen in the app designed for the protected person rather
 * than the family: one address in very large type, one rule, and a QR code that
 * opens a new email to Sentinel on their phone so they never have to type it.
 */
export function Setup({ slug }: { slug: string }) {
  const shield = useQuery(api.shields.getBySlug, { slug });
  const settings = useQuery(api.mail.getSettings);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const address = settings?.inboxAddress ?? "";

  useEffect(() => {
    if (!address || !canvasRef.current) return;
    void QRCode.toCanvas(
      canvasRef.current,
      `mailto:${address}?subject=${encodeURIComponent("Is this a scam?")}`,
      { width: 168, margin: 1, color: { dark: "#0b1220", light: "#ffffff" } },
    );
  }, [address]);

  if (shield === undefined) return <div className="skeleton m-10 h-96" />;
  if (shield === null) return <p className="p-10 text-ink-500">That link does not exist.</p>;

  return (
    <div className="min-h-screen bg-slate-page py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-6 flex max-w-3xl items-center justify-between px-5">
        <A href={`/s/${shield.slug}`} className="text-sm font-medium text-ink-500 hover:text-brand-700">
          ← Back to the dashboard
        </A>
        <button
          onClick={() => window.print()}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Print this page
        </button>
      </div>

      <div className="print-plain mx-auto max-w-3xl rounded-2xl border border-line bg-white px-10 py-10 shadow-sm">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="text-sm text-ink-500">For {shield.protectedFirstName}</span>
        </div>

        <h1 className="mt-8 text-4xl font-extrabold leading-tight tracking-tight text-ink-900">
          If an email asks for money, a password,
          <br />
          or says hurry — send it to me first.
        </h1>

        <div className="mt-8 rounded-2xl border-2 border-brand-300 bg-brand-50 px-6 py-6">
          <div className="text-sm font-semibold uppercase tracking-widest text-brand-700">
            Forward it to
          </div>
          <div className="mono mt-2 text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">
            {address || "…"}
          </div>
          <div className="mt-4 flex items-center gap-5">
            <canvas ref={canvasRef} className="rounded-lg border border-brand-100 bg-white" />
            <p className="text-sm leading-relaxed text-ink-700">
              Point your phone's camera at this square and it will start an email to me. You do not
              have to type anything — just attach or forward the message you are worried about and
              press send.
            </p>
          </div>
        </div>

        <ol className="mt-8 space-y-4">
          {[
            {
              h: "Do not click anything first",
              p: "Not a link, not a button, not an “unsubscribe”. Just forward it.",
            },
            {
              h: "Forward it to the address above",
              p: "Anything at all. There is no such thing as bothering me too often.",
            },
            {
              h: "Wait for my reply",
              p: `It usually comes back in under a minute and it is three lines long. The first line tells you what it is.`,
            },
            {
              h: "If it says SCAM, delete it",
              p: shield.callName
                ? `And if anything worries you, call ${shield.callName}${shield.callNumber ? ` on ${shield.callNumber}` : ""}.`
                : "And if anything worries you, call someone in the family.",
            },
          ].map((s, i) => (
            <li key={i} className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <div className="text-lg font-bold text-ink-900">{s.h}</div>
                <p className="text-[15px] leading-relaxed text-ink-700">{s.p}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-xl bg-slate-page px-5 py-4 text-[15px] leading-relaxed text-ink-700">
          <span className="font-bold">You will never be in trouble for asking.</span> The people who
          get caught by these emails are the ones who felt too rushed or too embarrassed to check.
          Checking is the whole trick.
        </div>

        <p className="mt-6 text-xs text-ink-300">
          Sentinel · {shield.protectedFirstName}'s shield · reference {shield.caseCode}
        </p>
      </div>
    </div>
  );
}
