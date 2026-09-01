# Database Schema

PostgreSQL, via Prisma. **One database per client deployment.** Never shared,
never multi-tenant.

Source of truth: `prisma/schema.prisma`. This file explains the decisions.

## Tables

| Table | Holds |
|---|---|
| `company_settings` | One row per deployment (`singleton` unique). Branding, timezone, workweek, RAG threshold |
| `users` | Profile. `id` = the Supabase `auth.users` UUID |
| `projects` | Project register, contract value, and four separate number series |
| `project_members` | Who may do what on which project. **The grant** |
| `project_contract_rules` | The contractual clock and approval thresholds |
| `contacts` | Authority register — was this person allowed to ask? |
| `project_documents` | File metadata and the storage id. Also the access boundary |
| `potential_changes` | The heart. Capture → notice → owner → deadline → risk |
| `tasks` | Who owns the next action, and by when |
| `bottlenecks` | What is blocked, for how long, and what value is at risk |
| `activity_logs` | Append-only audit |
| `integration_events` | Inbound event log + idempotency |
| `notification_logs` | Delivery state machine |
| `notices` | The notice document: draft, issued, served, acknowledged, superseded |
| `variation_orders` | What we put to the client, and what they said back. One per change |
| `invoices` | Monthly progress applications against an agreed VO |
| `payments` | Money received. Many per invoice |
| `document_chunks` | pgvector chunks (Phase 2 RAG) |
| `potential_change_embeddings` | pgvector, for duplicate detection |

## Additions beyond the spec, and why each is load-bearing

**`potential_changes.source_location` and `.source_occurred_at`** — where and
when the change was *raised*, which is not where and when it *happened*.

`location` and `event_date` describe the change: the part of the works
affected, and the date the notice clock counts from. These two describe the
conversation that surfaced it — the meeting room, the video platform, the
WhatsApp group, and the moment somebody first said so.

They exist because a verbal instruction is worth exactly as much as the record
of it. When a variation is challenged months later the questions are who
instructed it, where, and when. Before this, the capture form hardcoded
`source_type = 'mobile_form'`, so every change claimed to have originated in
the app even when the person was writing up a site meeting — a record that
answers none of the three.

The gap between the two dates is evidence in its own right, and the change
detail page states it rather than leaving it to be inferred: a change raised
three weeks after it happened says something about notice risk before anyone
assesses it. `SourceType` also gained `meeting_online`, so a video call is
distinguishable from a meeting somebody attended.

**`projects.pc_sequence`** — an atomic counter.

```sql
UPDATE projects SET pc_sequence = pc_sequence + 1
 WHERE id = $1 RETURNING pc_sequence
```

`MAX(sequence) + 1` races. Two site engineers filing at the same moment read the
same maximum and collide on `(project_id, pc_number)`. `UPDATE ... RETURNING`
takes a row lock and cannot. Covered by a concurrency test.

**`integration_events`** — unique `(source, external_id)`.

Rule 2 demands idempotency and there was nowhere to record it. The unique index
*is* the guarantee; the pre-check in `processOnce()` is only an optimisation, and
a real race falls through to the winner's stored result.

**`notification_logs`** — the delivery state machine.

`pending → queued → sent → delivered`, or `failed`. Nothing may set `sent`
except the callback at `/api/integrations/notifications/delivery-status`, and a
success without an `external_message_id` is rejected: "sent" with nothing to
point at is not evidence, and this record may later be the proof a notice was
served.

**`capture_questions`** — the outstanding "which project?" and its answer.

`kind` distinguishes the two shapes. A **choose** question lists the reporter's
live jobs and is answered with a number or a code. A **confirm** question puts
back the one project we read out of their own message, and is answered with a
word. For a confirm, `candidate_project_ids[0]` **is the proposal** and the rest
are their other live jobs, carried so that "no, it is DXB-002" resolves in one
reply instead of being read as a brand new report. Nothing may reorder that
array.

`source_message_id` and `source_subject` are the message being answered, so the
question goes back as a REPLY on the same thread rather than as a fresh email.

**`notification_logs.reply_to_message_id`** — passed to n8n lane D, which uses
it to reply in place of sending. Null on everything that is not answering an
inbound message.

**`drive_folder_id` / `drive_file_id`** — Drive holds bytes, this database is
the index. We never list a folder to discover what exists: Drive permits
duplicate names, and a listing is not an access-control boundary.

## Types worth noting

- **`@db.Date`** for `event_date`, `notice_due_date`, `due_date` — calendar
  dates, no time, no zone. Prisma returns them as UTC midnight. `src/lib/dates.ts`
  parses and formats these in **UTC**; instants use `Asia/Dubai`. Mixing them
  shifts deadlines by a day.
- **`Decimal(18,2)`** for money. Never float — 0.1 + 0.2 has no place near a
  contract sum.
- **`Unsupported("vector(384)")`** for embeddings. Prisma has no vector type, so
  the columns arrive via the `20260829223700_pgvector_indexes` migration and are
  written with raw SQL.

## Indexes

Every `projectId` (the access filter is on every query), plus
`(projectId, pcNumber)` unique, `(source, externalId)` unique, the dashboard
filter columns (`noticeDueDate`, `currentStatus`, `riskLevel`,
`currentOwnerUserId`, `dueDate`), and HNSW on both vector columns.

HNSW rather than IVFFlat: it needs no training pass, so it behaves correctly on
a table that starts empty and fills up — which is exactly a new deployment.

**`notices`, and `projects.notice_sequence`** — added 2026-09-01 with stage 5.

A separate table rather than four columns on `potential_changes`, because a
rejected notice is redrafted and the rejected round has to survive intact.
Columns would be overwritten by the redraft, and the file would lose its own
history at the exact moment somebody is arguing about it. `@@unique
(potential_change_id, version)` makes the rounds explicit.

Its own counter, separate from `pc_sequence`, for two reasons. A notice
reference gets quoted in correspondence and read back months later, so it must
not move when a change is renumbered; and one shared counter would imply that
PC-0042 produced notice 0042, when most changes never produce a notice at all.

`external_message_id` is the load-bearing column: it is what the courier
returned, and therefore the only proof the notice actually left. `notices` with
a status of `sent` and a null message id are raised as `notice_sent_no_proof`,
because a notice you cannot prove you served is, in an argument, a notice you
did not serve.

**The money end** — `variation_orders`, `invoices`, `payments`, added
2026-09-01 with stage 6. Three of Osman's decisions are baked into their shape:

**One VO per change.** `variation_orders.potential_change_id` is UNIQUE, and
that index is the rule rather than a convention. A rejected VO drags nothing
else down with it, and a partial approval never has to be apportioned back
across bundled changes by somebody guessing which one lost the money.

**`invoices` are progress applications, not sales invoices.** Fit-out is billed
monthly against a cumulative percentage, with retention held back. A person
enters `cumulative_percent` and nothing else; `basis_value`,
`previously_applied`, `gross_this_period`, `retention_amount`, `net_value`,
`vat_amount` and `total_due` are computed once and **frozen onto the row** —
including the history, so the arithmetic on an issued invoice can be reproduced
line for line even if the VO is later revised or an earlier application
cancelled. That is the paper the client is holding.

**`submitted_value` and `approved_value` are separate columns**, and the lower
figure never overwrites the higher. The difference is what the company
conceded, and a contractor who cannot say what it conceded cannot learn to
concede less.

Three further rules hold across all three tables:

- Every money column is `NUMERIC(18,2)`, never a float, and the arithmetic runs
  in whole fils through `src/lib/money.ts`. `0.1 + 0.2` is a curiosity in most
  software and a wrong invoice here.
- **Nothing derived is stored.** "Overdue", "approved but unbilled" and
  "retention held" are computed on read. A stored total needs a job to maintain
  it, and the day that job fails the number is wrong *and* confident.
- `invoices.status` is never typed by a person. It is recomputed from the sum of
  its payments on every write, so the register cannot say paid while the bank
  says otherwise.

Four number series per project, all separate — `pc_sequence`,
`notice_sequence`, `vo_sequence`, `invoice_sequence`. A VO number is quoted on
a payment certificate and an invoice number on a bank transfer, so neither may
move because something upstream was renumbered. Per project rather than
company-wide, because a company-wide invoice series tells every client how much
work the contractor has on, from the size of the gaps.

## Deliberately absent

Retention release, credit notes, and EOT valuation. Retention is withheld
correctly at every application and reported as held; the separate application
that releases it at practical completion is not built. A credit note is the
right answer to an over-certification and to a payment against a wrong invoice,
and the system currently refuses those cases rather than inventing a document
for them.

## Migrations

```bash
npx prisma migrate dev --name <what_changed>   # development
npx prisma migrate deploy                      # everywhere else
```

That is the whole procedure. The pgvector indexes and the row level security
policies used to live in `prisma/sql/*.sql`, applied by hand afterwards, and on
2026-08-30 that proved to be a real hazard: anything that rebuilt the schema
from the migrations came up **with RLS disabled and not one policy**, silently.
Nothing failed, nothing warned, and the anon key would have read everything.
They are now migrations `20260829223700_pgvector_indexes` and
`20260829223701_row_level_security`, so `migrate deploy` cannot leave them out.
Both remain idempotent.

**Never point `--shadow-database-url` at a real database.** Prisma RESETS the
shadow database to replay migrations into it. Aimed at a live URL it will empty
it, which is how the above was discovered.
