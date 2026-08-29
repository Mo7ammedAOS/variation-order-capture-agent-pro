# Database Schema

PostgreSQL, via Prisma. **One database per client deployment.** Never shared,
never multi-tenant.

Source of truth: `prisma/schema.prisma`. This file explains the decisions.

## Tables

| Table | Holds |
|---|---|
| `company_settings` | One row per deployment (`singleton` unique). Branding, timezone, workweek, RAG threshold |
| `users` | Profile. `id` = the Supabase `auth.users` UUID |
| `projects` | Project register, contract value, and the PC counter |
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
| `document_chunks` | pgvector chunks (Phase 2 RAG) |
| `potential_change_embeddings` | pgvector, for duplicate detection |

## Additions beyond the spec, and why each is load-bearing

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
  the columns arrive via `prisma/sql/001_vector.sql` and are written with raw SQL.

## Indexes

Every `projectId` (the access filter is on every query), plus
`(projectId, pcNumber)` unique, `(source, externalId)` unique, the dashboard
filter columns (`noticeDueDate`, `currentStatus`, `riskLevel`,
`currentOwnerUserId`, `dueDate`), and HNSW on both vector columns.

HNSW rather than IVFFlat: it needs no training pass, so it behaves correctly on
a table that starts empty and fills up — which is exactly a new deployment.

## Deliberately absent in Phase 1

Variation Orders, invoices and payments have **no tables yet**, per the spec.
Their service stubs exist. The intended shape:

```text
variation_orders    potential_change_id, vo_number, submitted_value,
                    approved_value, submitted_at, client_response_at, status
invoices            variation_order_id, invoice_number, invoiced_value,
                    issued_at, due_at, status
payments            invoice_id, amount, received_at, reference
```

`potential_changes` already carries `estimated_value` and the status enum has
room, so adding these is additive — no migration of existing rows.

## Migrations

```bash
npx prisma migrate dev --name <what_changed>   # development
npx prisma migrate deploy                      # production, via deploy/release.sh
npx prisma db execute --file prisma/sql/001_vector.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/sql/002_rls.sql   --schema prisma/schema.prisma
```

Both SQL files are idempotent. Run them after `migrate`, in order.
