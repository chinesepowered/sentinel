import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { A, Logo, navigate } from "./ui";

/**
 * The front door. A judge should be one click from a dashboard that already
 * has cases in it, and one short form from a shield of their own.
 */
export function Home() {
  const demo = useQuery(api.shields.demo);
  const mine = useQuery(api.shields.listMine);
  const settings = useQuery(api.mail.getSettings);
  const create = useMutation(api.shields.create);

  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [callName, setCallName] = useState("");
  const [callNumber, setCallNumber] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await create({
        protectedFirstName: firstName,
        protectedEmail: email,
        callName: callName || undefined,
        callNumber: callNumber || undefined,
        guardians:
          guardianEmail.trim().length > 0
            ? [{ name: guardianName || "Family", email: guardianEmail }]
            : [],
      });
      navigate(`/s/${res.slug}`);
    } catch (err) {
      setError(String((err as Error).message ?? err).replace(/^.*Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Logo />
          <nav className="flex items-center gap-4 text-sm font-medium text-ink-500">
            {demo ? (
              <A href={`/s/${demo.slug}`} className="hover:text-brand-700">
                Demo dashboard
              </A>
            ) : null}
            <A href="/admin" className="hover:text-brand-700">
              Usage
            </A>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-20">
        <section className="grid gap-10 py-14 md:grid-cols-[1.15fr_1fr] md:items-center">
          <div className="animate-rise">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">
              A scam shield for your parent's inbox
            </p>
            <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-ink-900 sm:text-5xl">
              One rule she has to remember:
              <br />
              <span className="text-brand-700">forward it to Sentinel.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-700">
              If an email asks for money, a password, or hurry, she forwards it to one address.
              Sentinel checks who really sent it against the organisation's own website, and writes
              back within seconds in three plain lines. If it is bad, your phone lights up too.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {demo ? (
                <A
                  href={`/s/${demo.slug}`}
                  className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
                >
                  Open the demo family dashboard
                </A>
              ) : null}
              <a
                href="#setup"
                className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-semibold text-ink-700 transition hover:border-brand-300"
              >
                Set one up for your family
              </a>
            </div>
            {settings?.inboxAddress ? (
              <p className="mt-5 text-sm text-ink-500">
                Sentinel's live inbox:{" "}
                <span className="mono font-medium text-ink-700">{settings.inboxAddress}</span>
              </p>
            ) : null}
          </div>

          <div className="card animate-pop p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              What she gets back
            </div>
            <div className="mt-3 rounded-xl border border-scam-200 bg-scam-50 p-4">
              <div className="text-lg font-extrabold tracking-tight text-scam-700">
                SCAM — do not reply, do not click.
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
                This is not from RBC. It is a copy of their page built to steal your password.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
                <span className="font-semibold">What to do:</span> delete it. Do not click, do not
                reply, do not send money. If you are worried, call Sarah at (613) 555-0136.
              </p>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-500">
                You did the right thing by sending it to me.
              </p>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Every reply is three lines: the verdict, why, and the one thing to do.
            </p>
          </div>
        </section>

        <section className="grid gap-4 border-y border-line py-8 sm:grid-cols-3">
          {[
            {
              n: "1",
              h: "She forwards it",
              p: "Sentinel is saved as a contact in her mail app. Forwarding is the whole interface.",
            },
            {
              n: "2",
              h: "We check the real web",
              p: "The organisation's actual website decides what its real domains are — not the email.",
            },
            {
              n: "3",
              h: "Everyone hears at once",
              p: "She gets a plain reply. If it is dangerous, the family is emailed and the dashboard turns red.",
            },
          ].map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                {s.n}
              </span>
              <div>
                <div className="font-semibold text-ink-900">{s.h}</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">{s.p}</p>
              </div>
            </div>
          ))}
        </section>

        {mine && mine.length > 0 ? (
          <section className="py-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              Your shields
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {mine.map((s) => (
                <A
                  key={s._id}
                  href={`/s/${s.slug}`}
                  className="card flex items-center justify-between px-4 py-3 transition hover:border-brand-300"
                >
                  <span className="font-semibold text-ink-900">{s.protectedFirstName}</span>
                  <span className="mono text-xs text-ink-500">{s.caseCode}</span>
                </A>
              ))}
            </div>
          </section>
        ) : null}

        <section id="setup" className="py-10">
          <div className="card p-6">
            <h2 className="text-xl font-bold tracking-tight text-ink-900">Set up a shield</h2>
            <p className="mt-1 text-sm text-ink-500">
              Two minutes. You get a dashboard link to share with your brothers and sisters, and a
              printable page for her fridge.
            </p>
            <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Her first name" hint="Used in every reply she gets.">
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Margaret"
                  className="input"
                />
              </Field>
              <Field
                label="The email she forwards from"
                hint="Only used to recognise her forwards."
              >
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="her.address@example.com"
                  className="input"
                />
              </Field>
              <Field label="Who should she call?" hint="Goes into the reply, in her words.">
                <input
                  value={callName}
                  onChange={(e) => setCallName(e.target.value)}
                  placeholder="Sarah"
                  className="input"
                />
              </Field>
              <Field label="On what number?">
                <input
                  value={callNumber}
                  onChange={(e) => setCallNumber(e.target.value)}
                  placeholder="(613) 555-0136"
                  className="input"
                />
              </Field>
              <Field label="Guardian's name" hint="Alerted when something dangerous arrives.">
                <input
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="Sarah"
                  className="input"
                />
              </Field>
              <Field label="Guardian's email">
                <input
                  type="email"
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input"
                />
              </Field>
              <div className="sm:col-span-2">
                {error ? (
                  <p className="mb-3 rounded-lg border border-scam-200 bg-scam-50 px-3 py-2 text-sm text-scam-700">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {busy ? "Creating…" : "Create the shield"}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  This is a public demo running on free tiers. Outbound mail is redirected to the
                  demo mailbox, so nothing is sent to the address you type. Her address is stored
                  only to route her forwards and is never shown in the dashboard.
                </p>
              </div>
            </form>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-white py-8">
        <div className="mx-auto max-w-5xl px-5 text-sm text-ink-500">
          Sentinel — built for the Convex All Gas Hackathon.
        </div>
      </footer>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}
