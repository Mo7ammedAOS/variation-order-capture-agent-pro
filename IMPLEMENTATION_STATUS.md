# Implementation Status

**Phase 1 — DEPLOYED and live at https://vo.osmanflow.com.**
Last updated 2026-08-30.

## Gates

```text
npm run lint        PASS
npm run typecheck   PASS
npm test            PASS — 107 tests, 20 of them against the real database
npm run build       PASS
npm run db:migrate  PASS — 4 migrations: schema, capture source fields,
                    pgvector indexes, row level security
npm run db:seed     PASS — 12 users, 5 projects, 20 changes, 25 tasks,
                    11 bottlenecks from the real sweep, 20 local embeddings
deployment         LIVE — https://vo.osmanflow.com, valid Let's Encrypt
                    certificate, HSTS, sign-in and project scoping verified
                    from outside on a phone viewport
```

The database is live. Outstanding: the deployment domain, and the Google Drive
decision (Workspace + Shared Drive, or a personal Gmail with an OAuth refresh
token). `STORAGE_PROVIDER=local` works fully in the meantime.

## Deployment, 2026-08-30

Live on the Hostinger VPS `srv1859636` behind the Traefik that already fronts
n8n. n8n stayed up throughout — Traefik discovers the new container from labels,
so there was no shared config file to reload and no way for this to take n8n
down.

| Page | Warm |
|---|---|
| sign-in → dashboard | 1,979 ms |
| dashboard | 1,300 ms |
| register | 1,313 ms |
| my tasks | 1,195 ms |
| capture form | 1,206 ms |

Verified from outside: valid certificate, HSTS, `http` → `https`, a signed-out
`/api/*` returning 401 JSON rather than a redirect, a Site Engineer seeing only
his two projects, and a change on a project he is not assigned to returning
**403** from the API and **404** from the page.

### Four faults the first deploy exposed

Each one had been sitting in code that had never been built or run.

**`NEXT_PUBLIC_*` were build-time placeholders.** Next inlines them into the
compiled output including the Edge middleware, so the middleware asked a
Supabase project that does not exist whether the cookie was valid, found no
session, and redirected every user to `/login` forever — with no error anywhere,
while the login page rendered from the real database and credentials were
accepted. They are required build args now and the build fails without them.

**Evidence photos had no volume.** `LOCAL_STORAGE_ROOT=./.uploads` wrote into the
container, so every rebuild would have destroyed them silently: the rows survive
and only the bytes vanish, discovered months later when a photo is needed to
defend a variation.

**The Dockerfile had never been built.** It copied `/app/public`, which does not
exist, and the model cache from `/root/.cache/huggingface`, where
transformers.js does not put it.

**`prisma migrate deploy` could not run in the runner.** Next's standalone output
traces a subset of `node_modules`, and the hand-copied Prisma CLI's own
dependencies were not in it. Migrations now run from the build stage.

Plus: the reverse proxy was Traefik, not the Caddy every deployment document
had described.

## Phase 1 goals

| # | Goal | Status |
|---|---|---|
| 1 | Sign in | Built |
| 2 | Company dashboard | Built — 9 cards, 4 charts |
| 3 | Create projects | Built |
| 4 | Assign users to projects | Built |
| 5 | Configure contract rules | Built — editable, capability-gated, audited |
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
| 3 | Project-level access | `tests/integration/project-access.test.ts` | **Passing** |
| 4 | A cannot access B | same | **Passing** |
| 5 | MD sees all | same | **Passing** |
| 6 | PM sees assigned only | `rbac` + integration | **Passing** |
| 7 | QS sees assigned only | same | **Passing** |
| 8 | SE creates only on assigned | integration | **Passing** |
| 9 | PC number valid | `tests/unit/pc-number.test.ts` | **Passing** |
| 10 | Notice due date correct | `tests/unit/dates.test.ts` | **Passing** |
| 11 | Countdown displays | `tests/unit/risk.test.ts` | **Passing** |
| 12 | Risk colour correct | same | **Passing** |
| 13 | Task assignment | integration | **Passing** |
| 14 | Bottleneck creation | `runDetectionSweep` via seed | **Passing** — 11 detected |
| 15 | Audit created | `tests/integration/contract-rules.test.ts` | **Passing** |
| 16 | Mobile form validation | Zod schema | **Passing** |
| 17 | Mock WhatsApp validates | `integration-contract.test.ts` | **Passing** |
| 18 | Mock email validates | same | **Passing** |
| 19 | Duplicate event safe | `processOnce` + schema tests | **Passing** |
| 20 | Lint / typecheck / build | scripts | **Passing** |

Plus these this design added: vector search cannot cross a project boundary; the
document proxy refuses a file on an unassigned project; PC numbers do not
collide under concurrency; a signed-out `/api/*` call gets 401 rather than a
redirect; and the contract-rules suite below.

## Lifecycle — `tests/unit/status-transitions.test.ts`, `tests/integration/status-change.test.ts`

`changeStatus` existed with a capability but no route, no UI, and **no
transition validation** — it accepted any status. A change sitting in
`notice_assessment` could therefore be moved straight to `included_scope`, past
the entitlement question, and nothing would look wrong: the change would appear
to progress normally and the notice would simply never be served.

What is now enforced, and where each rule came from:

| Rule | Source |
|---|---|
| A change leaves `notice_assessment` only via the assessment | `notice.service.ts` already encodes the three outcomes |
| A newly captured change goes to the assessment | `capture.service.ts` and `createPotentialChange` both do this |
| `included_scope` and `cancelled` are ends | Reopening is a different action with different authority |
| No move to the status it is already in | — |

**Settled 2026-08-30: scope → price → CM → approval.** The PM defines what the
change is, the QS prices what was defined, the CM reviews, then internal
approval. Encoded in `allowedNextStatuses`; the UI narrowed by itself, because
the form asks that function what to offer.

Forward moves advance one stage and may never skip — skipping is how a change
reaches "included in scope" with nobody having approved it. Backward moves to
any earlier stage are allowed, because a CM who spots a pricing error needs to
send it back, and a strictly forward chain would leave cancellation as the only
correction.

Choosing that order made `assessNotice` wrong: "notice not required" routed
straight to `qs_pricing`, skipping scope review, and raised a QS pricing task
for the QS. It now routes to `pm_scope_review`, raises a scope review task for
the PM, and takes its due date from `pmScopeReviewDueDays` rather than the QS's
allowance.

## Contract rules — `tests/integration/contract-rules.test.ts`

The rules decide every deadline in the product, so editing them is tested as a
commercial control rather than as a form:

| Test | Why it exists |
|---|---|
| A site engineer is refused | They have project access but not `project.manageContractRules`. Access and authority are different questions |
| A commercial director may edit | The capability actually grants it |
| Before and after land in the audit trail | "Who changed 28 to 42, and when" is what a dispute turns on |
| **An edit does not move deadlines already calculated** | Existing changes keep the deadline derived under the rules in force at capture. Rewriting them would rewrite what the company believed it owed |
| The next capture uses the new period | 1 Sep + 42 days = 13 Oct, not 29 Sep |
| Blank clears a threshold, and is not zero | Zero would mean *everything* needs that approval — the opposite of "no threshold" |
| An out-of-range notice period is refused | 0 and 400 rejected before they reach the database |

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

## What is left, 2026-09-01

Stages 1 to 3 are done: the build, the deployment, and the decision spine
(two approval gates, QS pricing, reporter edits, cancel, the chase). Stages 5
and 6 — the notice, and the money end — are done as of 2026-09-01.

**Stage 4 — n8n becomes the nervous system.** In progress.
`n8n-workflows/master.json` is built and validated: lanes A, B, C (capture in),
D, E (notify out), S (the schedules), H (errors). Not yet imported or bound.
The app side is done — `/api/integrations/n8n/run-job`, the capture inbox, and
`needs_triage` as a real event status.

**Stage 5 — the notice.** Built, 2026-09-01. The chain runs end to end:

| Step | What happens | What proves it |
|---|---|---|
| Assessed "required" | The system drafts the notice immediately, from the change and the contract rules | `notices` row, version 1, status `draft` |
| Before approval | Anyone holding `notice.draft` edits the wording | Audit `notice / updated`, old and new body |
| Two seats approve | The text FREEZES, a message is queued to the client | status `issued`, `notification_id` set, message `pending` |
| After the transaction | A PDF is filed in `08 Notices/<REF>.pdf` | `document_id` set, openable through the access-checked proxy |
| Courier reports back | Only now is it served | status `sent`, `external_message_id` recorded |
| A human sees the reply | Acknowledgement recorded with a date and their reference | status `acknowledged` |
| Rejected instead | The draft is superseded whole; a redraft opens version 2 | the rejected round is never edited or deleted |

Three deliberate limits:

- **No Arabic.** The PDF writer uses the base-14 WinAnsi fonts, so a
  non-Latin character prints as `?`. An Arabic notice needs an embedded font.
- **Acknowledgement is never inferred.** A reply landing in the capture
  mailbox is not an acknowledgement, and no classifier gets to decide that it
  is.
- **A notice with no recipient email is still approvable.** The panel says so
  in words rather than blocking the gate, because the missing thing is a
  project setting, not a decision. `notice_drafted_not_sent` catches it.

The three notice bottleneck types that have existed since the first migration
now have detection behind them: required-not-drafted (only reachable after a
rejection), drafted-not-sent, and sent-without-proof.

**Stage 6 — the money end.** Built, 2026-09-01. The lifecycle now runs past
`variation_approved` to money in the bank.

| Step | What happens |
|---|---|
| Raise | `VO-DXB-001-0001`, one per approved change, carrying the frozen price |
| Submit | A person records the date it went. The client clock runs from that date |
| The answer | Agreed in full, agreed lower, rejected, or more information |
| Apply | A monthly progress application: one percentage in, the whole build-up out |
| Issue | Figures freeze, `dueAt` freezes from today's payment terms |
| Payment | Many per invoice. The status is recomputed, never typed |

Three decisions of Osman's, 2026-09-01, are in the tables rather than the code:

- **One VO per change**, enforced by a unique index.
- **Progress applications with retention**, not one invoice per VO.
- **A partial approval leaves a visible shortfall.** Submitted and approved are
  separate columns and the lower never overwrites the higher.

The dashboard gained four figures: approved-but-unbilled, invoiced-unpaid,
overdue, and conceded. The first is the number the product exists to produce
and could not be produced before these tables existed.

Four SOPs that were "Not yet specified" stubs are now written to match what was
built: `client_vo_submission`, `invoice_tracking`, `payment_collection`,
`approved_but_unbilled`.

Not built, and stated rather than implied: **retention release** (withheld
correctly, reported as held, but the application that releases it at practical
completion does not exist), **credit notes** (an over-certification and a
payment against the wrong invoice are both refused rather than credited), and
**EOT valuation**.

**Stage 7 — AI for real.** The Claude adapter throws by design. No extraction,
no scope check against contract or BOQ, no transcription. Duplicate detection
already works on local MiniLM.

**Stage 8** — procurement and subcontractor quotations, EOT.
**Stage 9** — document RAG over drawings and specs.
**Stage 10** — ready for a second client: Redis rate limiting, 2FA, Arabic.
**Stage 11** — first real contractor.

### Corrections to the old plan

- *"Reminder and escalation workers on BullMQ"* is dead. Reminders and
  escalation were built in the app, and the schedule now belongs to n8n. Seven
  of the eight `src/workers/*` stubs should never be written.
- The Unassigned Capture Inbox moved from stage 8 to stage 4. Capture parks
  what it cannot place, and without a screen those messages fall into a hole.
- Contract rules, contacts, team and project creation now have forms. The
  "API-only" limitation above is out of date.
