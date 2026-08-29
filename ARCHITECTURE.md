# Architecture

## The one rule

```text
The custom application owns the truth.
n8n moves information between external systems.
AI understands, extracts, summarises and drafts.
Humans approve commercial and contractual actions.
```

Everything below is a consequence of that sentence.

## Why the app owns business truth, not n8n

A workflow tool is excellent at *moving* things and poor at *being responsible*
for them. Commercial logic inside n8n means:

- **No transactions.** A change and its audit event can half-happen.
- **No types.** A renamed field fails at 3 a.m. on a live notice, not at build.
- **No tests.** You cannot prove a Site Engineer on Project A cannot see B.
- **State in two places.** The workflow's memory and the database disagree, and
  the disagreement is discovered by a client.
- **No review.** A commercial rule changes by someone dragging a node.

So Postgres holds every register, services enforce every rule, and n8n is a
courier. It carries a payload the app authored and reports back what happened.

## Why n8n stays

Because the alternative is worse. WhatsApp Business, Outlook, Gmail, SharePoint
and Drive each have their own auth dance, pagination quirks and retry semantics.
n8n already solves those, visibly, in a form a non-developer can inspect when a
mailbox stops delivering. Writing those integrations by hand would be weeks of
work to end up with something less debuggable.

The boundary is drawn where it belongs: n8n owns *reaching external systems*,
and nothing else.

## Layers

```text
  WhatsApp · Email · Drive · QR form
                 │
                 ▼
        n8n  (integration only)
                 │   HMAC-signed, idempotent
                 ▼
   /api/integrations/*   ← the only door n8n may write through
                 │
                 ▼
        services/  ← access checks, business rules, audit, transactions
                 │
                 ▼
        PostgreSQL  ← the system of record
                 ▲
                 │
        workers/  ← commercial timing: deadlines, bottlenecks, escalation
```

## Access control, honestly

Two layers, and it matters which one is load-bearing.

| Layer | What it protects | Load-bearing? |
|---|---|---|
| `project-access.service.ts` | Everything the app itself reads and writes | **Yes** |
| Postgres RLS (`prisma/sql/002_rls.sql`) | Anything arriving via the Supabase anon key or PostgREST | No — defence in depth |

**Prisma connects with a role that bypasses RLS.** That is how Postgres works.
Claiming RLS as the gate would be false comfort, so the service layer is the
gate and the integration tests prove it.

Two shapes, and picking the wrong one is the classic mistake:

- `scopeToUser()` — for **lists**. Produces a `where` fragment; unreachable rows
  simply are not returned.
- `assertProjectAccess()` — for a **specific record**. Throws **403**, never a
  silent empty result, because "not found" and "not yours" are different bugs.

## Where a decision lives

```text
Is it a commercial rule, a deadline, or a status?  → src/services/
Does it decide WHEN something happens?             → src/workers/
Does it read, extract, summarise, or draft?        → agents/
Does it move data to or from an external system?   → n8n
Is it how the business is supposed to behave?      → workflows/
```

## Decisions worth knowing

**Notice due date = event date + `notice_period_days`, calendar days.** The
literal contractual formula. Working-day helpers exist in `src/lib/dates.ts`;
do not switch without a contract that says so, because a shorter clock is a
missed notice.

**Dates render `09 Aug 2026`, never `09/08/2026`.** UAE staff come from DD/MM
and MM/DD conventions alike. The named month costs three characters and removes
the error class. Calendar dates parse and format as **UTC**; instants use
`Asia/Dubai`. Mixing them silently shifts deadlines by a day — that bug was
found by a test during the build.

**RAG thresholds:** Green > 7 days remaining · Amber 1–7 · Red ≤ 0 or breached.
Configurable per deployment in `company_settings`.

**PC numbers use an atomic counter.** `UPDATE projects SET pc_sequence =
pc_sequence + 1 RETURNING` inside the create transaction. `MAX(seq)+1` races:
two engineers filing simultaneously read the same maximum and collide.

**Vectors live in the same Postgres.** A hosted vector service would mean a
shared control plane and per-client accounts, and the embedded text *is* the
client's commercial correspondence. Every similarity query filters by
`project_id` **before** the ANN search — an unscoped search is a cross-project
leak wearing the costume of a feature.

**Notifications become `sent` only when the courier reports back.** Asking n8n
to send does not make it sent. Until the callback lands it is `pending`; on
failure `failed` with a reason. A notice is not served because we asked.

## Reusability per client

Nothing is hardcoded to ABC Fit-Out. A new deployment is a new database, a new
`.env`, a new compose stack and a new Caddy block. `CLIENT_SLUG` names it in
logs, in the n8n workflow file and in the health check.
