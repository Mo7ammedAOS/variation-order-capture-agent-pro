# Implementation Status

**Phase 1 — DEPLOYED and live at https://vo.osmanflow.com.**
Last updated 2026-09-08.

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

- **The integration tests fail until the next deploy.** They run against the
  shared Supabase, which does not have `20260902100000_credit_notes_and_retention_release`
  yet. Unit tests, lint, typecheck and build are all clean.
- **Contract rules are read-only in the UI.** Seeded and displayed; no edit
  form — which now also covers the retention release split and the defects
  liability period.
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
(two approval gates, QS pricing, reporter edits, cancel, the chase). Stages 5,
6 and 7 — the notice, the money end, and real capture extraction — are done as
of 2026-09-01.

**Stage 4 — n8n becomes the nervous system.** In progress.
`n8n-workflows/master.json` is built, validated, imported and ACTIVE on the
live instance as `TkHAKIIHVt2n6fV4`: lanes A, B, C (capture in), D, E (notify
out), S (the schedules), H (errors). The app side is done —
`/api/integrations/n8n/run-job`, the capture inbox, and `needs_triage` as a
real event status.

Still unbound: `N8N_NOTIFY_EMAIL_URL` and `N8N_NOTIFY_WHATSAPP_URL` are blank
in `.env.production`, so every question and reminder is recorded in-app and
**nothing is sent**. Lane D exists and will reply the moment the URL is set.
That is one line and a redeploy, and it starts sending real email to real
people, which is why it is not set.

**Stage 4b — capture understands the message.** Built, 2026-09-01.

| Situation | What happens |
|---|---|
| Sender on one live project | Filed there, no question |
| Text names a code or the client, one job fits | "This is DXB-001, correct?" — one word files it |
| Text names two of their jobs | Asked, from those two only |
| Text names none | Asked, from their full list |
| Text names a job they are NOT on | Parked, saying exactly that |
| Unknown sender, or on no live project | Parked for triage |

The matcher is `src/lib/project-match.ts` — pure, no model, no network. It
proposes and never decides: nothing is written until the reporter answers.
Codes match however they are typed (`DXB-001`, `dxb001`, `DXB - 001`); a client
name matches on its leading distinctive word, because nobody writes "Miral
Asset Management" in a WhatsApp. Generic words — `contracting`, `properties`,
`office` — identify nobody and are stripped, or every message would match every
job.

The confirmation is sent as a **reply on the original email thread** (lane D's
`D3a`/`D4b` branch, driven by `notification_logs.reply_to_message_id`).

**The dispatcher must not overwrite the delivery callback.** Lane D's webhook
uses `responseMode: lastNode`, so n8n holds the app's request open until the
lane finishes — and the lane's last act is calling back to say the message was
delivered. That callback lands BEFORE the dispatcher gets its 200, so an
unconditional write stamped `queued` over a row that already said `sent` and
carried the provider's message id. Both of the first two messages this system
delivered ended up looking undelivered. `dispatchPendingNotifications` now
writes only `WHERE status = 'pending'`, on both the success and the failure
path. For a notice, `sent` is the proof of service and the bottleneck sweep
chases `notice_drafted_not_sent` — so the old behaviour would have chased a
delivered notice for ever, then served it twice.

**The exchange is a conversation, not a queue.** A question goes out on the
same request that created it (`dispatchNow`), not on the next sweep — a two to
thirty minute pause in the middle of a fifteen second exchange makes a site
engineer assume the thing is broken and go back to WhatsApping his PM directly.
The scheduled sweep stays, unchanged, as the safety net for anything that call
could not deliver.

Answers are read the way people type them: `DXB-004`, `dxb004`, `dxb 004` and
`DXB - 004` are one answer; so are `2`, `#2`, `no 2` and `project 2`. A
token-less reply settles the MOST RECENT open question within a 12 hour window,
because that is how a conversation works — the old rule refused whenever two
were outstanding, which was safe and useless. What makes the looser rule
survivable is that the acknowledgement **quotes the report it filed**, so
answering the wrong question is visible in seconds rather than silent for ever.
Prose is still refused outright: "moving 2 sockets on level 2" is a report, and
reading it as an answer would throw that report away.

The conversation ends one of two ways. **Confirmed** — "Filed as
PC-DXB-002-0007", with the report quoted back. **Cancelled** — `cancel`,
`ignore`, `forget it`, `my mistake` close the question, mark the event
`ignored`, and answer "nothing has been recorded". A withdrawn report left
sitting in the inbox is worse than no report: somebody spends time on it and
finds there was nothing there.

**The email is taken apart from the report inside it.** `src/lib/email-cleanup.ts`
strips the signature (`-- `), quoted history ("On … wrote:", Outlook's
`From:/Sent:/To:` block, `>` lines), mail client footers and confidentiality
disclaimers. It runs BEFORE project matching, which is the point: a signature
reading "Site Engineer | Al Futtaim Contracting" matches a client name and
would have the system propose a job the message was never about. It only ever
deletes, never rewrites, and if cleaning would empty a message it returns the
original — an untidy description beats a lost variation.

**`description` and `summary` are different things on purpose.** `description`
is the reporter's own words, cleaned, and is printed verbatim under WHAT
HAPPENED in a notice. `summary` is the model's standardised restatement, shown
above it in the UI with the original one click away. Convenience may be wrong;
evidence may not. Nothing contractual reads `summary`, and it is left null when
the model merely echoed the message back — the keyword fallback does exactly
that, and storing a copy as if it were a reading would be a lie in the one
place a reviewer trusts.

**Attachments are evidence.** Lane B downloads them and forwards them base64;
the app files them into the change's Drive `Evidence` folder with a
`project_documents` row each. They ride along in `integration_events.
payload_json` while a message waits for its answer, so a report parked two days
still has its photographs when the reply lands. `storeCaptureEvidence` cannot
throw — a rejected file loses the file, never the change, because the notice
clock is already running on the change.

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

**Stage 6b — the three holes in the money loop.** Built, 2026-09-02.

- **Credit notes.** The system used to refuse every correction: completion
  could not go backwards, an invoice with money against it could not be
  cancelled, a receipt above the invoice was rejected. Each refusal is right
  alone; together they meant a wrong figure that reached the client could never
  be put right. A credit is now its own document, with its own series, reason
  and narrative. It mirrors the application it reverses — including the
  retention, so crediting 10,000 returns 9,975 and stops holding the 500. An
  issued credit frees the work to be applied for again, which is why the
  "cannot go backwards" guard is now measured in money rather than in the
  percentage on the paper.
- **Retention release.** `invoices.kind` separates an application from a
  release. A release carries no work value and no percentage — the money was
  earned months ago — and names its moiety, so practical completion cannot be
  released twice. Half at practical completion and the rest at the end of the
  defects liability period, both from the contract rules.
- **Extension of time**, recorded and never valued, per Osman's decision of
  2026-09-02. The days and the client's answer were already stored; what was
  missing was the **basis**. A claim with days and no stated critical path is
  now refused, and claimed / approved / conceded days are totalled on the
  dashboard beside the money.

Not built, and stated rather than implied: **prolongation cost** — an EOT
carries days and a basis, no money. Valuing one needs an agreed daily prelims
rate per project and a rule for who agrees it.

**Stage 7 — AI for real.** Built, 2026-09-01, for capture extraction.

`AI_PROVIDER=claude` now runs a real adapter on `claude-sonnet-5` at `effort:
low`. It reads a captured WhatsApp or email message and proposes a title, a
location, a trade, and — most usefully — a list of what the message does not
say.

Four things about it are worth stating, because they are the reasons it is safe
to point at a live instance:

- **The schema is the wall, not the prompt.** No field accepts a cost, a rate,
  a quantity, a number of days, or a notice decision. A prompt asking a model
  not to price things is a request; a schema with nowhere to put a price is
  structural.
- **A failure never loses a report.** Rate limit, expired key, refusal,
  truncated output, malformed shape, missing prompt file — every one falls back
  to the keyword extractor, and the change is created identically. The audit
  event records `readBy`, so a suggestion is never attributed to a model that
  did not run.
- **The prompt is a file**, `agents/prompts/capture-extraction.prompt.md`, read
  at runtime and copied into the image explicitly. Editing it needs no deploy.
- **The message is fenced as data.** A WhatsApp message is untrusted input; the
  instruction reminder sits after the payload, not before it.

Cost, per captured message: one call, ~2k output cap, with the instructions as
a cached prefix billed at a tenth on every message after the first.

Still mock or absent: **voice transcription** (Claude has no speech-to-text —
it throws rather than inventing a transcript), scope checking against contract
and BOQ (that is the pgvector path, already built and separate), notice
drafting assistance, and impact assessment. Duplicate detection continues to
run on local MiniLM and costs nothing.

**`AI_PROVIDER` still defaults to `mock`.** Nothing calls Anthropic until an
`ANTHROPIC_API_KEY` is set and the provider switched — deliberately, so the
first paid call is a decision rather than a side effect of a deploy.

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

---

## Since 2026-09-01

Seven days that were mostly about the front door and the frame, plus one fault
that had made the whole application unreachable.

### The way in existed on paper only

Every account in this system is created by somebody else, so every person
arrives through a link in an email. That link went to `/login`, and `/login`
had no way to read it — a recovery token arrives in the URL **fragment**, which
browsers never send to a server, so no server component could have used it even
if it had tried. **No account this system created could be opened by the person
it was created for.** Not the first owner, and not any of the staff a
deployment invites.

`/set-password` is that missing screen. It accepts all four link shapes
Supabase emits depending on project settings, clears the token out of the
address bar the moment it reads it, and treats an expired link as routine
rather than a dead end — they time out, and some mail clients spend them by
prefetching every URL in a message.

Alongside it, the front door split in two. `/signin` for everybody;
`/admin-signin` for whoever stands the company up, carrying **Set up the
company**. That button is safe on a public URL for one reason: set-up is open
only while the company has **no users at all**, and the first account closes it
permanently. The count is checked twice — once to show the button, once inside
the transaction that writes the row, holding an advisory lock — so two people
opening the page on a fresh deployment cannot both become owner. The Supabase
identity is created outside that transaction and deleted again if the
transaction finds it lost the race, because an identity with no profile row
behind it is the one state this system cannot tolerate.

Set-up also lays down the permission matrix when none exists. A wiped database
has no `role_permissions` rows, and a missing row is a denial, so without it the
first owner signs in successfully and can then do nothing whatever — including
grant themselves the permission that would fix it.

`/login` remains as a redirect. The old address is in sent invitations and
bookmarks, and a dead front door is a support call.

### The fault that 500'd every page

The shell imported `NAV_LINKS` — an array — from `nav.tsx`, a `'use client'`
module. In a production build React replaces such an export with a
client-reference proxy, so the layout called `.map` on an object without one.
`tsc`, ESLint, `next build` and `next dev` were all happy; it failed only in a
production build.

The data moved to `nav-links.ts`, which carries no directive. The guard is
`tests/unit/client-boundary.test.ts`, which walks `src/app` for server files
reading named bindings out of client modules. Its first version did not catch
the bug it was written for — it treated any leading capital as a component, and
`NAV_LINKS` has one. It now demands real PascalCase, verified by putting the
bug back and watching it fail.

### The clock can be moved

Almost everything contractual here is a function of dates, so "run now" proved
nothing on the day the data was entered — the honest answer from every sweep was
"nothing is due yet". `run-job` now takes an optional `as_of`; the sweep reads
the world as it will be on that date and decides for itself. Gated on
`ALLOW_JOB_TIME_TRAVEL`, capped at 400 days, echoed back as `ran_as_of` /
`simulated`.

n8n gained **lane M** — a manual trigger over one Code node holding the job and
the date — and **lane S4**, the schedule `client_followup` never had. It was
reachable from `run-job` and nothing ever called it, so the only chase a client
received was one somebody sent by hand.

### The interface was rebuilt

Osman's work, over three passes: a photographic ground with frosted-glass
surfaces, light and dark as two different photographs rather than one palette
inverted, the brand moved to lime so it can never be confused with the RAG
scale, and the sidebar replaced by a floating icon rail beside a top bar
carrying search, theme and sign-out. `UI_SPEC.md` is the authority on all of it.

Three absences were filled in the same work: a **404** — there was none, so a
bookmark to a deleted variation got unstyled Helvetica; a **loading state** —
without one Next had no boundary to suspend at, so the browser sat on the
previous page for the length of the query; and a **skip link**, past a shell
that puts eleven controls ahead of every page's first heading.

One real bug went with it: the phone bar rendered `NAV_LINKS.slice(0, 4)` — the
raw list, ignoring the permission filter the shell had already computed. An
administrator who may reach nine pages got the same four as a site engineer,
and **sign-out lived only in the desktop rail, so there was no way out of the
app on a phone at all.**

### Removing people, 2026-09-08

Both halves existed at the service layer and neither had a button.

**Off a project** — `removeMember` was written, tested by nothing, and reachable
from no screen, so a team could be built and never corrected. It is now a
**Remove** on the Team tab, asking once and naming the person. It stays a soft
removal: the membership row is marked inactive rather than deleted, so a claim
that turns on who was entitled to instruct work in March can still be answered,
and re-adding somebody reactivates the same row instead of starting a second
unrelated stint.

**Out of the company** — new, and deliberately conditional. `deleteUser` refuses
anyone the commercial record still points at, listing what points at them, and
tells the administrator to deactivate instead. The reasoning is that deleting a
`users` row does not delete their work; every reference is `onDelete: SetNull`,
so the changes, notices, prices and approvals all survive with an empty column
where the person used to be. A change that said who reported it would say
nobody. Delete is therefore for an account added by mistake, deactivate is for a
person who has left, and the service decides which one it is looking at by
counting rather than asking.

The order of the two deletes is the safety argument: the **Supabase identity
goes first**, then the row. The other way round leaves an identity that can
authenticate with no profile behind it — the state that bricked this deployment
on 2026-09-05 — whereas a failure after the first step leaves an inert row that
pressing the button again finishes off. It is two operations rather than one
transaction on purpose: a network call does not belong inside a database
transaction, and rolling Postgres back would not bring the identity back.

`tests/unit/user-delete.test.ts` locks down the ordering, the refusals, and that
a refusal touches nothing at all. TEST-PLAN Stage 20b walks both by hand.

### Open

- **Company name is absent from the app shell.** It was at the top of the old
  sidebar; the new one does not carry it. Signed in, the client's name appears
  on no screen but Settings and the printed report — for a product deployed one
  stack per client under the client's own domain, that wants a decision.
- **WhatsApp media never arrives.** Lane A is webhook → shape → sign → post,
  with no download step, and `A2` hard-codes `media: []`. Photographs and voice
  notes both reach the app as a message with no file attached. The sign-in
  screen promises "evidence, filed where it belongs"; over WhatsApp that is not
  yet true.
- **Voice notes are not transcribed and cannot be.** `transcribeVoiceNote` has
  no callers, the mock returns a fake, and the real provider throws because
  Claude has no speech-to-text. Making it true needs a second vendor.
- **Backgrounds are heavy** — 510 KB light, 400 KB dark, 2000×1116. They are
  blurred behind glass and would survive being resized.
- `N8N_NOTIFY_EMAIL_URL` and `N8N_NOTIFY_WHATSAPP_URL` are still blank, so
  nothing is sent. `AI_PROVIDER` is still `mock`.

