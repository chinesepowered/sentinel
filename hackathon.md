# Hackathon log

- **Project:** Sentinel
- **Event:** Convex All Gas Hackathon
- **What it does:** An older adult forwards a suspicious email to one address and gets a plain-language verdict back in seconds, verified against the real organisation's website, while the family dashboard lights up.
- **Live app:** https://grateful-minnow-9.convex.site
- **Repo:** https://github.com/chinesepowered/sentinel
- **Frontend:** Convex static hosting
- **Convex deployment:** https://grateful-minnow-9.convex.cloud
- **Components:** @convex-dev/static-hosting, @convex-dev/agent, @convex-dev/rate-limiter
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, scheduled functions, crons, realtime queries, optimistic updates
- **Auth:** Convex Auth
- **AI models:** OpenAI, through an OpenAI-compatible chat completions endpoint configured by `LLM_BASE_URL` / `LLM_MODEL` on the deployment
- **Started:** 2026-09-09T03:38:53Z
- **Last updated:** 2026-09-09T13:04:14Z

## Log

### 2026-09-09 - 720d952
Set up the Convex chassis: Vite + React + Tailwind front end, Convex Auth with
anonymous and password providers, static hosting, and the shared integration
libraries for the LLM, Firecrawl and AgentMail. Registered the static-hosting,
agent and rate-limiter components. Added the signed AgentMail webhook as an HTTP
action, inbound routing by thread id then subject code then sender address, a
per-provider usage table, a credit-budgeted Firecrawl gateway with a permanent
result cache, and per-user plus global rate limits. Convex features: schema,
indexes, queries, mutations, actions, HTTP actions, scheduled functions, Convex
Auth, components (`convex/schema.ts`, `convex/http.ts`, `convex/mail.ts`,
`convex/mailActions.ts`, `convex/lib/`).

### 2026-09-09 - d8732b8
Built the product backend. Added `shields`, `guardians`, `cases`, `orgCache` and
`outbound` tables with indexes for every lookup, then the analysis pipeline: an
inbound email becomes a case in `analyzing`, an OpenAI call extracts the claimed
organisation, sender domain, links and what the email asks for, Firecrawl
verifies the organisation's real domains and finds its own fraud-warning page,
Firecrawl fetches the landing page behind suspicious links, and a second OpenAI
call scores the risk with reasons that cite those URLs. Added the safety layer
that clamps the result — nothing may be called safe without a domain match, and
anything asking for money, credentials, gift cards or remote access is floored
at 60. Added the crons for the weekly guardian digest and the monthly note, and
a seed that creates the demo family, six past cases in mixed verdicts and a
warmed organisation cache. Convex features: schema, indexes, queries, mutations,
actions, scheduled functions, crons (`convex/schema.ts`, `convex/analyze.ts`,
`convex/cases.ts`, `convex/shields.ts`, `convex/orgs.ts`, `convex/crons.ts`,
`convex/digest.ts`, `convex/seed.ts`, `convex/lib/scoring.ts`).

### 2026-09-09 - 928cf38
Built the front end: a guardian dashboard whose case list, stat tiles and
evidence panel are all live `useQuery` subscriptions, with risk rings, verdict
pills, the exact reply the protected person received, the source links behind
every reason, and a Handled action that lands as an optimistic update. Added the
printable setup one-pager with the inbox address in large type and a QR code
that opens a pre-addressed email, a landing page that creates a shield, and an
admin page showing the day's sponsor usage and whether crawling is still within
budget. Convex features: realtime queries, mutations with optimistic updates
(`src/Dashboard.tsx`, `src/Setup.tsx`, `src/Home.tsx`, `src/Admin.tsx`).

### 2026-09-09 - 1cb3b8b
Added guardian question answering on the Agent component: a thread per family
stored in Convex, answers grounded only in that family's own case history, and
instructions that require it to say it does not know rather than reassure.
Verified against the dev deployment — asked whether anyone had impersonated the
protected person's bank before and got back the correct case with its date and
the domain the email actually came from. Convex features: actions, components
(`convex/ask.ts`, `convex/lib/llm.ts`).

### 2026-09-09 - e5fddb8
Made the dashboard follow a case the moment it arrives, so an email forwarded
during a demo opens itself on screen, and fixed the redaction of the forwarding
address so a raw `Name <address>` header can never leave a fragment of the
address on the case row (`src/Dashboard.tsx`, `convex/cases.ts`).

### 2026-09-09 - 9d6a33c
Deployed to production and verified the whole loop against it. A real email sent
from a separate mailbox arrived through the signed AgentMail webhook, was routed
to the demo shield by its sender address, and produced a scam verdict at 100/100
with reasons citing the organisation's real domains found by a live crawl; the
reply reached the protected address and two guardian alerts went out, 28 seconds
from arrival. Also verified in a browser against the live URL: anonymous
sign-in, the paste-an-email path filling in live from `analyzing` to a verdict,
the Handled action turning a row green, and the guardian question answering. A
legitimate email was verified separately: the sending domain matched the
organisation's own domain found by the crawl, and it came back as looks-fine
with a calm reply and no alert. Seeded the demo family on both deployments and
captured the README screenshots from the live site (`README.md`,
`public/demo/`).
