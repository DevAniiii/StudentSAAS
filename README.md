# ScholarFolio

**Academic Ledger** — a student portal built as a registrar's ledger rather than a
dashboard: ruled paper, tabular figures, and a term ruler that runs across the top
of every screen.

```
npm install
cp .env.example .env      # then fill in DATABASE_URL and SESSION_SECRET
npm run db:setup          # migrate + seed
npm run dev
```

Sign in with `maya.krishnan@college.edu` / `folio-demo-2026`. Every seeded account
uses that password.

---

## What it is

A single-student portal over a real academic record: courses, weekly meetings,
assessments and submissions, marks and GPA, attendance, invoices and payments,
instructor messages, and announcements. Nine screens, all reading the same
PostgreSQL database — there is no fixture layer and no parallel demo dataset, so a
database outage surfaces as an honest error state rather than silently serving
stale objects.

### Design

Light-first, with a dark theme as a genuine second theme rather than an inversion:
every colour is a token, so a component never writes a `dark:` variant.

| Role | Face | Use |
| --- | --- | --- |
| Display | **Fraunces** (variable, `SOFT`/`WONK`/`opsz` unlocked) | Headlines, the wordmark |
| UI text | **Space Grotesk** | Everything else |
| Figures | **JetBrains Mono** | Every number, identifier, code-like string |

Deliberately not Inter, Roboto or Arial. The type pairing is a large part of why
this does not read as a template.

The signature interaction is the **Ledger Spine**: a CSS-gradient term ruler
condensed into the topbar and expanded on `/today`, where week ticks draw in,
assessment deadlines appear as notches coloured by state, and a pip travels the
elapsed span to mark now. `/term` is the same ruler at full height.

Motion is GSAP + Lenis, in `src/animations`, with `prefers-reduced-motion` honoured
as a first-class branch rather than a blanket duration reduction.

## Requirements

- Node **20.9+**
- PostgreSQL **15+**

`DATABASE_URL` may point at a local install, a Supabase direct host, or a pooler.
If you use a Supabase pooler, note that it needs the `postgres.<ref>` username
form and the *regional* pooler host — neither is derivable from the project ref,
and both are load-bearing. `.env.example` documents the cases, including the
`connection_limit` cap a 15-connection pooler requires and the `\$` escaping
that stops `dotenv-expand` truncating a password.

## Getting a database

There is no bundled cluster. Point `DATABASE_URL` at any PostgreSQL 15+ instance
and run:

```bash
npm run db:setup    # migrate deploy + seed
```

The seed is deterministic and idempotent, and it creates a full term: 6 sections,
13 assessments, ~70 attendance sessions, invoices, message threads and
announcements, so every screen has something real to render.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| **`npm run smoke`** | **End-to-end suite — see below** |
| `npm run db:setup` | `migrate deploy` + seed |
| `npm run db:seed` / `db:migrate` / `db:reset` / `db:studio` | Prisma tasks |

## Tests

`npm run smoke` is the suite that matters. It runs a production build, starts the
resulting server on a free port, drives it over HTTP with a real cookie jar, and
asserts the things a user could actually check — 84 of them, across the
unauthenticated surface, login, the authenticated shell, preferences, messages,
notifications, password and session revocation, and logout.

Testing the **built** artifact rather than `next dev` is deliberate. A dev server
compiles routes on demand and is forgiving about things a production server is
not, so a green dev run can still ship a build that 500s. It also means the
suite exercises the same server that `npm start` will.

It owns its own process, and that is not optional: the login endpoint
rate-limits, and the counters live in process memory, so pointing the harness at
a long-lived server makes the second run report a wall of 429s that look like an
auth failure. Point it at staging with `SMOKE_BASE=http://…` instead.

> **Windows note.** `npm run smoke` runs `prisma generate`, which replaces
> `query_engine-windows.dll.node`. If a previous run's server is still alive, that
> rename fails with `EPERM` and the run dies before it starts. The symptom reads
> like a broken build; the cause is a locked DLL. Stop stray servers and re-run:
>
> ```powershell
> Get-NetTCPConnection -State Listen | Where-Object LocalPort -gt 3000
> Get-Process -Id <those pids> | Stop-Process -Force
> ```

## Architecture

```
src/
  app/            routes — App Router, (app) = authenticated shell
    api/v1/       JSON API, one envelope, one error vocabulary
  server/         read models: academic, attendance, comms, context, finance
  components/
    shell/        sidebar, topbar, spine, command palette, theme
    ui/           button, field, panel, dialog, toast, states, data display
    pages/        screen-level composition
  animations/     GSAP + Lenis, reduced motion
  lib/            dates, money, grades, attendance, cn
  styles/         globals.css — the design system
prisma/           schema, migrations, seed
scripts/          smoke suite + design-system tooling
```

Server components read through `src/server`, which owns every derived value — a
resolved name, a computed percentage, a tone, a pre-formatted date. Pages ask a
question and lay out the answer; they do not do arithmetic. That is why a
percentage looks the same on `/today` as it does on `/grades`.

Dates are formatted **once, on the server**, in the institution's timezone, and
passed down as strings. Formatting on both sides is a hydration mismatch waiting
for a locale to change.

### State and errors

Empty, not-found and inline-error states are designed components in
`src/components/ui/states.tsx`, not per-page inventions, and `error.tsx` /
`global-error.tsx` catch anything thrown during a render — with the wording
distinguishing a database outage from a bug, because a student cannot act on
"a query failed" but can act on "the records service is down, try again in a
minute".

Two states in the spec's matrix are deliberately **not** built here, and the
reason is the design rather than an omission:

- **Permission denied.** The portal is single-role. Every authenticated account
  is a student, and there is no resource a signed-in student is *denied* — so a
  permission-denied component would have no call site. Where a record exists but
  belongs to someone else, the API answers **404 rather than 403**, because
  "forbidden" would confirm the record exists, and that confirmation is itself
  the disclosure.
- **Skeleton / degraded banner.** Every screen is server-rendered and awaits its
  data, so there is no client-side fetch to cover with a skeleton. Rather than
  add a loading state nothing can trigger, the boundary states above carry the
  weight. Adding streaming + Suspense would make skeletons real, and is the
  natural next step if page-level latency ever justifies it.

The API answers with one envelope on both success and failure, with a
`requestId` top-level in each, and nothing cacheable:

```jsonc
{ "data": …, "error": null, "requestId": "sf_…" }
{ "data": null, "error": { "code": "VALIDATION_FAILED", "message": "…", "fields": [...] }, "requestId": "sf_…" }
```

Clients branch on `error.code` and never on the prose.

### Security

- **Sessions are database rows, not JWTs.** A JWT cannot be revoked, and
  "sign out everywhere" is a real requirement here. The cookie (`sf_session`,
  HttpOnly, `SameSite=Lax`) is 32 random bytes and nothing else — no user id, no
  role, no expiry. Only its SHA-256 digest is stored.
- **`Secure` is decided by the environment, not by the request's scheme.** Behind a
  TLS-terminating proxy — the normal deployment — every request reaching the app is
  already plain HTTP, so a cookie that trusted the request scheme would drop
  `Secure` in exactly the deployments that need it, leaving a session credential
  that travels in the clear on any downgrade. So `Secure` is set whenever
  `NODE_ENV=production`.
- **Passwords are scrypt** (N=2¹⁴, r=8, p=1, 32-byte key) in a self-describing
  `scrypt$N$r$p$salt$hash` format, so the cost parameters can be raised later
  without invalidating anyone's stored password. Verification bounds `N`, `r` and
  `p` before allocating, so a tampered row cannot turn a login into an
  out-of-memory crash.
- **Login failures are indistinguishable** — same status, same message, same cost,
  with a decoy hash run when the account does not exist, so response time does not
  leak whether an address is registered.
- **CSRF**: `SameSite=Lax` plus an `Origin` check on every state change.
- **Open redirects** are closed on both `?next=` and `Referer`; the notifications
  redirect emits a **relative** `Location`, which cannot name a host at all.
- **Not-found is not forbidden** where existence is itself a disclosure.
- Every authorisation check is re-derived server-side from the database, never
  trusted from the request.

## Known scope

The portal is **read-only for assessment submission and payment**, and says so in
the interface rather than offering a control that does nothing: payments are
recorded by the bursar's office, and the assignments screen reports submission
state without accepting a hand-in. Everything else in the record is live and
writable through the API.
