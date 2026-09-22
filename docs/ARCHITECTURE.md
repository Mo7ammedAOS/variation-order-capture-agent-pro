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
| Postgres RLS (`20260829223701_row_level_security` migration) | Anything arriving via the Supabase anon key or PostgREST | No — defence in depth |

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

**The notice is drafted before it is approved, and frozen when it is.** The
system writes the first draft the moment a notice is judged required, so the
two seats approve a page of words rather than an intention; the moment they
agree, the text goes read-only and a PDF of it is filed. Approving an intention
and then generating the letter afterwards would put two signatures under
something nobody read. See `notice-document.service.ts`.

The PDF is written by `lib/pdf.ts` — about a hundred lines, no dependency —
because the one document in this system that may end up in front of a tribunal
should have nothing between the text and the bytes. The cost of that choice is
real and stated: base-14 WinAnsi fonts only, so **no Arabic**.

**The money is integer arithmetic, in one file.** `src/lib/money.ts` works in
whole fils and every figure on an invoice comes out of it. Each amount is
rounded once and the next is built on the rounded one — VAT is charged on the
rounded net, and the total is the sum of the two figures printed above it.
Otherwise an invoice shows three numbers where the first two do not make the
third, and no explanation of floating point will make that acceptable to the
person deciding whether to pay it. It throws rather than clamping: a silently
corrected figure is a wrong invoice nobody notices.

**Derived commercial figures are never stored.** Approved-but-unbilled,
outstanding, overdue and retention held are computed on read from rows that
cannot go stale. A cached total needs a job to maintain it; the day that job
fails, the number is wrong and confident, and a director acts on it.

**AI suggests, and is structurally prevented from deciding.** The capture
extractor answers into a JSON schema with no field for a cost, a rate, a
quantity, a number of days, or a notice decision. Prohibitions written into a
prompt are requests a model may or may not honour; a schema with nowhere to put
a price is a wall. The Potential Change is created before the extraction is
consulted, so a model failure degrades the title and never loses the report —
and the audit event records which reader actually ran.

**Captured text is untrusted input.** A WhatsApp message from site can contain
a sentence shaped like an instruction. It is passed inside a fenced block
labelled as data, with the reminder to follow only the original instructions
placed AFTER the payload — the half that matters, since an instruction before
the payload is the one the payload gets to argue with.

## Reusability per client

Nothing is hardcoded to ABC Fit-Out. A new deployment is a new database, a new
`.env` and a new compose stack — Traefik discovers the route from container
labels, so there is no proxy config to edit. `CLIENT_SLUG` names it in
logs, in the n8n workflow file and in the health check.
