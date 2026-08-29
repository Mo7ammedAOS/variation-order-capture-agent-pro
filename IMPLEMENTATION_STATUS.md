# Implementation Status

**Phase 1 — code complete, not yet run against a database.**
Last updated 2026-08-29.

## Gates

```text
npm run lint        PASS
npm run typecheck   PASS
npm test            PASS — 51 unit tests
npm run build       PASS — 18 routes
npm run test:db     NOT RUN — needs a real DATABASE_URL
npm run db:migrate  NOT RUN — needs Supabase credentials
npm run db:seed     NOT RUN — needs Supabase credentials
deploy/release.sh   NOT RUN — needs the VPS and DNS
```

**Nothing has touched a database yet.** The blocker is the five Supabase values
and the Drive credentials — see DEPLOYMENT_GUIDE.md.

## Phase 1 goals

| # | Goal | Status |
|---|---|---|
| 1 | Sign in | Built |
| 2 | Company dashboard | Built — 9 cards, 4 charts |
| 3 | Create projects | Built |
| 4 | Assign users to projects | Built |
| 5 | Configure contract rules | Built (seeded + read; edit form is Phase 2) |
| 6 | Contacts and authority | Built |
| 7 | Upload / register documents | Built — Drive + local adapters |
| 8 | Create a Potential Change (mobile) | Built |
| 9 | Variation register | Built — 15 columns, filters, card view |
| 10 | Assign PM / QS / CM | Built — auto on capture, manual via Team tab |
| 11 | Start Notice Assessment | Built — the three outcomes |
| 12 | Owner, next action, deadline, risk, bottleneck | Built |
| 13 | Company / project / my-tasks dashboards | Built |
| 14 | Audit events | Built — in-transaction |

## Required tests

| # | Test | Where | State |
|---|---|---|---|
| 1 | Authentication | `login/actions.ts` | Manual |
| 2 | Role-based access | `tests/unit/rbac.test.ts` | **Passing** |
| 3 | Project-level access | `tests/integration/project-access.test.ts` | Written, needs DB |
| 4 | A cannot access B | same | Written, needs DB |
| 5 | MD sees all | same | Written, needs DB |
| 6 | PM sees assigned only | `rbac` + integration | **Passing** / needs DB |
| 7 | QS sees assigned only | same | **Passing** / needs DB |
| 8 | SE creates only on assigned | integration | Written, needs DB |
| 9 | PC number valid | `tests/unit/pc-number.test.ts` | **Passing** |
| 10 | Notice due date correct | `tests/unit/dates.test.ts` | **Passing** |
| 11 | Countdown displays | `tests/unit/risk.test.ts` | **Passing** |
| 12 | Risk colour correct | same | **Passing** |
| 13 | Task assignment | integration | Partial |
| 14 | Bottleneck creation | `runDetectionSweep` via seed | Needs DB |
| 15 | Audit created | integration | Partial |
| 16 | Mobile form validation | Zod schema | **Passing** |
| 17 | Mock WhatsApp validates | `integration-contract.test.ts` | **Passing** |
| 18 | Mock email validates | same | **Passing** |
| 19 | Duplicate event safe | `processOnce` + schema tests | Unit passing; end-to-end needs DB |
| 20 | Lint / typecheck / build | scripts | **Passing** |

Plus three this design added: vector search cannot cross a project boundary; the
document proxy refuses a file on an unassigned project; PC numbers do not
collide under concurrency.

## Bugs found and fixed during the build

**Notice deadlines were a day early.** `parseISO('2026-08-01')` reads a bare
date as *local* time; at UTC+4 that is `2026-07-31T20:00Z`, so every derived
deadline landed a day short. Calendar dates now parse and format as UTC;
instants keep the deployment timezone. Caught by a test before it could ship a
shortened contractual clock.

**Zod generics collapsed input and output types.** `ZodSchema<T>` forces them
equal, which silently discarded every `.default()` and handed services
`field | undefined`. Fixed in `src/lib/api.ts`.

## Known limitations

- **Nothing has run against a database.** Migrations, seed, integration tests
  and deploy are all unexercised.
- **Contract rules are read-only in the UI.** Seeded and displayed; no edit form.
- **Project / contact / member creation is API-only.** No forms yet — the
  services and routes exist.
- **Rate limiting is per-container.** Move to Redis before scaling past one.
- **RLS covers reads only**, deliberately — writes must go through the app.
- **Arabic is structural only.** `dir`, logical properties, language fields. No
  translation.
- **Workers are interface-only** except the bottleneck sweep. No reminders or
  escalation yet, per the spec.
- **AI is a mock.** Keyword matcher in the real envelope. No paid calls.
- **`voyage` embeddings throw.** Deliberate — Phase 2.
- **No 2FA.**
- **The repo is public**, by your decision.

## Phase 2

```text
Priority
  1  Run migrations + seed; get the integration tests green
  2  Deploy to the VPS, verify on a phone
  3  Build master.json — the eight lanes, sticky notes, deactivated
  4  Connect WhatsApp and email capture for real
  5  Notice PDF generation and the send path (D/E lanes)
  6  Real Claude adapter behind the existing envelope
Then
  7  Variation Orders, invoices, payments tables + services
  8  QS pricing, procurement and subcontractor quotations, EOT
  9  Reminder and escalation workers on BullMQ
 10  Document RAG over drawings and specs
 11  Arabic translation
 12  Unassigned Capture Inbox UI for triaged events
```

`potential_changes` already carries `estimated_value` and the status enum has
room, so 7 and 8 are additive — no migration of existing rows.
