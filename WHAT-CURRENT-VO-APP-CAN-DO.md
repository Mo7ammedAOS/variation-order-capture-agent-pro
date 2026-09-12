# What the current VO app can do

An honest inventory of the deployed system, written by reading the code rather
than the plan. Every line below was checked against the source, the database
schema, and the live server's configuration.

| | |
|---|---|
| **Live at** | `vo.osmanflow.com` |
| **Build** | `4908660` |
| **Checked** | 12 September 2026 |
| **Tests passing** | 578 across 40 files |
| **Database** | Supabase Postgres, **Singapore** (`ap-southeast-1`) |
| **File storage** | Google Drive, OAuth mode |
| **AI provider** | **`mock`** — returns fixtures, not real analysis |
| **Automation** | n8n `VO Capture & Control · MASTER`, 62 nodes, **active** |

Read the two halves together. Part 1 is what works. Part 2 is what does not, and
both are equally load-bearing when you are deciding what to sell.

---

# Part 1 · What it can do

## 1. Accounts, roles and authority

- **Invitation only.** There is no public sign-up. An account exists because an
  administrator created it. Creating one sends no email and hits no rate limit.
- **Two front doors.** `/signin` for everybody, `/admin-signin` for whoever
  stands the company up. The set-up button only appears while the company has
  **zero** users, and the first account closes it permanently.
- **Set a password directly** (instant, no email) or **email a reset link**. No
  minimum length of ours; the identity provider's own floor still applies.
- **11 system roles** — company owner, company admin, managing director,
  operations director, commercial director, commercial manager, contract
  administrator, finance manager, procurement manager, standard user, viewer.
- **13 project roles** — project manager, quantity surveyor, site engineer,
  foreman, commercial manager, contract administrator, procurement officer,
  planning engineer, finance officer, document controller, project viewer,
  client viewer, consultant viewer.
- **Company administration is a separate flag**, not a role — because whoever
  runs the app is usually doing another job. The system refuses to leave the
  company with zero administrators.
- **30 capabilities** in a matrix an administrator can edit at runtime without a
  deploy. A missing row is a denial, never a default allow.
- **Deactivate** a leaver (keeps their name on their work) or **delete** an
  account added by mistake. Delete is refused for anyone the record still points
  at, and it removes the sign-in before the profile row.
- **WhatsApp number per user**, movable between people — the number is *taken*,
  not copied, so two people can never hold one handset identity.

## 2. Projects

- Create, edit and list projects with code, name, client, consultant, location,
  contract number, start and completion dates, original contract value, currency
  and status.
- **Eight tabs per project**, each a real link so it is shareable and Back works:
  overview, potential changes, contract rules, contacts & authority, team,
  documents, tasks, activity.
- **Team assignment** by project role, with **notification separate from
  access** — someone can watch a project without editing it, and work on one
  without being messaged about every change.
- **Remove from a project** marks the membership inactive rather than deleting
  it, so who was entitled to instruct work last March can still be answered.
- **Client contacts with explicit authority flags**: authority verified, can
  request change, can issue technical instruction, can instruct work, can
  approve cost, can approve time, can sign final VO. Each is set deliberately
  rather than inferred from the contact type.

## 3. Contract rules — configurable per project

Everything below is set per project, not hardcoded:

| Rule | Default |
|---|---|
| Notice period (days) | 28 |
| Detailed claim period (days) | 42 |
| Notice delivery method, recipient name, email, company | — |
| Notice + variation proposal template names | — |
| EOT assessment required | yes |
| Approval threshold — PM / CM / Commercial Director / MD | — |
| High-risk VO value | — |
| Client response window (days) | 14 |
| Client follow-up enabled | yes |
| Client follow-up interval (days) | 7 |
| QS pricing due (days) | 7 |
| PM scope review due (days) | 3 |
| Internal approval due (days) | 5 |

## 4. Capture — getting a change into the system

**Four routes in.**

- **Mobile web form** (`/report-change`) — required fields only, everything else
  behind a disclosure. Attaches photos, audio, PDF, Office files, and CAD/BIM
  formats. The floating button is on every screen in the app.
- **WhatsApp** — signed webhook, sender identified by number, project matched,
  idempotent so a retried delivery never doubles a record.
- **Email** — parsed the same way; replies land on the original thread.
- **Watched document folder** — files arriving are registered and indexed.

**The conversation, when something is unclear.** The system asks rather than
guesses — which project, is this new or evidence for an existing change, when
did it happen, who instructed it, has work started, which drawing. It asks one
thing at a time, reads a photo caption as a strong signal, understands a short
reply ("the ceiling one", "yes"), reads the record back for confirmation before
writing anything, and closes the conversation instead of leaving it open. Stale
questions expire. It counts how many times it has asked and stops rather than
badgering.

**Standardisation on the way in.** "Yesterday", "last Monday", "the 15th" and "a
couple of weeks back" all become one calendar date. "The consultants",
"supervision consultant" and "MEP" become one named party. **What the reporter
typed is kept word for word** — the standardised value is what the register
counts.

**A triage queue** for anything that could not be placed, so an unplaceable
message sits on a screen instead of falling into a hole. It can be filed to a
project or dismissed.

**Recorded on every change:** the source type, where and when it was *raised*
(which is not where and when it *happened*), the sender's name and number, their
authority status, and how the instruction arrived — verbal, site instruction,
drawing, email, WhatsApp, meeting.

## 5. The record and its lifecycle

- **Race-safe numbering** — `PC-DXB-001-0004`, from an atomic counter.
- **11 statuses**: new potential change → notice assessment → notice required →
  needs evidence → PM scope review → QS pricing → CM review → internal approval
  → **variation approved** *or* **included scope** (the QS found it was already
  in the contract) *or* cancelled.
- **Transitions are gated.** You cannot jump a stage, and the allowed next
  statuses are computed rather than listed in the UI.
- Cancel with a reason, then reinstate with the **original capture date**
  intact. Delete permanently (restricted, and refused once a notice is served).
- Reopen a closed change.
- **Duplicate detection** — vector similarity flags "this looks like one already
  raised" as a suggestion with no action attached. Never merges, never closes.
- **Semantic search across the project's own documents** — contracts, BOQs,
  drawings, specifications — and scope matching against them.
- **Every vector query is scoped to the project first.** Cross-project semantic
  search is not a missing feature, it is a rule.

## 6. The notice clock

- Deadline = **event date + notice period**, calendar days, per project.
- Live countdown with RAG colour: green above the amber threshold (7 days by
  default, company-configurable), amber inside it, **red at zero or breached and
  not configurable** — a passed deadline is not a preference.
- **Notice assessment** by the project manager: required, not required, or needs
  more information. Each outcome routes differently.
- Deadlines **recalculate** if the event date is corrected.
- **Notice documents**: draft, edit, supersede a draft, approve, issue, file to
  the project's Drive folder, mark delivered, record acknowledgement. Generated
  as a **PDF letter** built from the record itself — same dates, same words,
  same evidence.
- Delivery is **confirmed by callback**, never assumed. Until n8n reports back it
  is `pending`, and on failure `failed` with a retry — never "notice sent".

## 7. Evidence

- A **folder tree per project**, numbered so it sorts: contract, drawings,
  specifications, BOQ, programme, correspondence, potential changes, notices,
  variation orders. Each change gets `Evidence/` and `Drafts/` beneath it.
- Folder creation is **race-safe** — two simultaneous captures cannot produce two
  folders of the same name.
- **Originals are never overwritten and never deleted by the app.**
- Files are served through an **access-checked route**, never a Drive link — a
  shareable link would route around every permission in the system.
- The document library is **indexed for meaning**, with an honest status when a
  file has no readable text (a scanned contract is kept and served, just not
  searchable, and the screen says so).

## 8. Pricing

- **Line items**: description, quantity, unit, rate, and a **rate source** —
  `contract_boq` → `pro_rata` → `star_rate` → `quotation` → `daywork`.
- The panel reports **how many lines rest on a star rate**, because that is the
  number a consultant attacks first.
- **Prelims percent** and **overhead & profit percent** applied per change.
- **"Not a variation"** is a first-class outcome — the QS can record that the
  work was already in scope, and it closes differently from an approval.
- Submit pricing, which advances the stage and creates the next task.
- **Every commercial figure is calculated in code.** The AI never computes a
  number.

## 9. Approvals

- **Value thresholds per project** for PM, CM, Commercial Director and MD.
- A **gate** opens with the seats it requires; the system works out who may fill
  each seat from the capability matrix, **not from a job title**.
- Decisions record the approver, the timestamp and their comments.
- A project manager cannot approve above his threshold regardless of whose
  laptop he is holding.

## 10. Variation orders and the money

- **Raise a VO** from an approved change, record submission, record the client's
  response, withdraw one.
- **Client follow-up** on the project's own cadence, which **stops the moment the
  client answers** — and can be switched off entirely per project.
- **Progress applications and invoices**, with retention held automatically.
- **Retention release** drafting, in contractual moieties.
- **Credit notes** — draft, issue, cancel — with settlement refreshed against the
  invoice.
- **Payments** recorded against what is owed, part payments included.
- **Commercial position** per project: claimed, approved, invoiced, paid,
  retained, credited, outstanding.
- **VAT at 5%**, charged on the **rounded net** rather than an unrounded
  intermediate, rounding half-up away from zero — the UAE tax invoice
  convention, implemented deliberately rather than by accident.

## 11. Time

- Potential time impact flag and estimated days on the change.
- Days claimed, approved and conceded held against the variation.
- **A time claim cannot be submitted without a stated basis** — a bare number is
  refused.
- EOT assessment can be required or not, per project.

## 12. Tasks, reminders and bottlenecks

- **12 task types**: notice assessment, PM scope review, QS pricing, procurement
  quotation, subcontractor quotation, EOT assessment, CM review, internal
  approval, evidence collection, client follow-up, document request, other.
- **My Tasks** — overdue, then due today, then upcoming.
- **Reminder sweep** chases whoever owns the next decision, **by seat rather than
  by name**, so it survives someone leaving the company.
- **Approval chase** for decisions sitting unanswered.
- **Bottleneck detection** — what is blocked, who by, how long, and the value
  waiting behind it, including unbilled approved work and invoices past their
  payment terms.
- Bottlenecks can be resolved, and detection runs as a sweep.

## 13. Notifications

- **Email and WhatsApp** channels, chosen by what is configured.
- Recipients resolved **by seat on the project**, plus direct notifications.
- **Deduplicated** — the same event cannot notify twice.
- Delivery status reported back by callback; pending until confirmed.
- An **in-app notification screen** with unread count, mark one read, mark all
  read.

## 14. Screens

`/dashboard` · `/my-tasks` · `/projects` · `/projects/[id]` (8 tabs) ·
`/projects/new` · `/projects/[id]/report` · `/variations` · `/variations/[id]` ·
`/report-change` · `/bottlenecks` · `/inbox` · `/notifications` ·
`/settings/company` · `/settings/users` · `/settings/permissions` · `/signin` ·
`/admin-signin` · `/set-password`

- **Dashboard**: 18 stat cards ordered by **urgency, not by total** — overdue
  notices first — plus four charts (by project, by status, by risk, overdue
  tasks by role).
- **Register**: 15 columns, filters that live in the **URL** so a filtered view
  is a link you send, card view on a phone.
- **Project report**: a printable document ordered by **notice deadline rather
  than PC number** — sorted by number it is a filing system, sorted by deadline
  it is a list of what to deal with. Prints through the browser, so Save as PDF
  gives selectable text.
- **Command palette** searching changes and projects.
- Light and dark themes, RTL-ready structure, mobile layouts throughout, a 404,
  loading states, and a skip link.

## 15. Security

- **Project access enforced on the server**, in a single choke point every
  service calls. A user on one project gets **403, not an empty list**, on every
  route belonging to another — search included.
- **Row-level security** in the database as a second layer.
- **Signed (HMAC) integration endpoints** with idempotency on every inbound
  event.
- **Complete audit trail** — who, when, before and after — written in the **same
  transaction** as the change, so an audit gap cannot happen.
- Session cookies `httpOnly` + `secure` + `sameSite=lax`; the service-role key
  never leaves the server.
- One installation per company. Nothing shared between clients — not the
  database, not the search index, not the file storage.

## 16. Automation (n8n)

One all-in-one workflow per client, **active**, 62 nodes. Lanes A–H: WhatsApp in,
email in, document watch, email out, WhatsApp out, client follow-up, weekly
report, error trigger. Plus scheduled jobs the app owns — `reminder_sweep`,
`bottleneck_sweep`, `notification_dispatch`, `client_followup` — and a manual
"run now" lane so any time-based behaviour can be tested on demand.

**n8n decides nothing and writes nothing to the database.** Every lane is a
courier carrying a payload the app authored.

---

# Part 2 · The limits

## Things that do not work at all

| | What is actually true |
|---|---|
| **WhatsApp photos, voice notes, PDFs** | Text arrives. **Media does not.** The capture lane has no download step and `media: []` is hard-coded, so a photo arrives as a message with no file attached. |
| **Voice note transcription** | Not implemented. The function has no callers and the real provider throws, because the model in use has no speech-to-text. Needs a second vendor. |
| **Verbal-instruction chase** | `verbal` is captured, stored and labelled — and **nothing branches on it.** No red flag, no risk elevation, no confirmation-letter generation. Under UAE Civil Code Art. 887 this is the single biggest commercial gap in the product. |
| **Client-ready VO document** | There is a **notice letter** PDF. There is **no variation order PDF**. |
| **Excel / Google Sheets export** | Nothing exports. The register prints; it does not download as CSV or XLSX. |
| **Employer-specific forms** | No Emaar, Nakheel, DM or RTA templates. No Aconex export. If the QS retypes it into Aconex, the integration has sold nothing. |
| **Arabic documents** | The interface is structurally RTL-ready and each user has a language preference, but the PDF generator has **no Arabic font embedded**. English output only. |
| **Escalation service** | An empty stub. Reminders and chasing exist; formal escalation levels do not. |
| **Original scope vs changed scope** | One description field. No tendered-scope / revised-scope pair for a side-by-side. |
| **Affected programme activities** | No programme link. You can record 14 days; you cannot say which activities. |
| **Drawing revision comparison** | Documents are stored and searchable. Nothing compares a revision against the tendered drawing. |
| **Auto-assembled evidence pack** | Everything is attached and traceable. There is no "produce the pack" output. |

## Things that half work

- **AI extraction.** Every field, prompt and route exists and is tested, but the
  live server runs `AI_PROVIDER=mock`, so what you see on screen today is a
  fixture. Switching it on is a configuration change, not a build.
- **Outbound WhatsApp.** The notification path is wired and the n8n lane is
  active, but the gateway URL on the app side is empty, so app-initiated
  WhatsApp has nowhere to go.
- **Dashboard money.** 18 cards, ageing and risk are there. The figures a
  commercial manager shows a board are not: **total pending VO value**,
  **approved value**, and — most importantly — **work started without
  approval**. The `workStatus` field exists on every change and the approval
  state exists; nothing crosses them. That is one query away.
- **Weekly report lane.** Defined in the workflow map, not built.

## In the database but with no screen

These are real, used by the engine, and **cannot be changed without a developer**:

| Field | Stuck at |
|---|---|
| Retention percent | 5% |
| Payment terms | 30 days |
| Retention release at practical completion | 50% |
| Defects liability period | 365 days |
| VAT percent | 5% |
| Company logo, brand colours, default language | unset / defaults |
| Notice and VO template names | unset |
| Approval matrix JSON, reminder rules JSON, escalation rules JSON | unset |

## Deployment and compliance

- **Data is hosted in Singapore** (`ap-southeast-1`), not the UAE. For
  government clients and some developers this is a procurement blocker rather
  than a preference. It is cheapest to move now, at 7 users and 4 projects.
- The GitHub repository is **public**.
- `ALLOW_JOB_TIME_TRAVEL` is off, which is correct — turning it on makes
  simulated runs send real messages to real people.

## Smaller known gaps

- **The company's name appears nowhere in the app shell.** It is in Settings and
  on the printed report only.
- **The projects page accepts a search parameter that nothing produces.** Dead
  wiring; search from the top bar instead.
- `DXB-001`'s stored project name contains a **ligature character** (`ﬃ`), so
  searching "Office" does not match it. Its client is still literally
  "Client 1".
- Background images are heavy — 510 KB light, 400 KB dark, at 2000×1116.

---

# The short version

The **hard half is built**: the notice clock with per-contract configuration,
the eleven-stage lifecycle with gated transitions, approval thresholds resolved
through a capability matrix, a pricing build-up with a real rate hierarchy, the
money engine through to payment with correct UAE VAT rounding, project isolation
proven at the service layer, and an audit trail that cannot have gaps. That is
the part that takes months.

What is missing falls into three groups:

**Days of work, high value** — the verbal-instruction flag and confirmation
letter, the "work started without approval" card, a CSV export of the register.

**Weeks** — a client-ready VO PDF, scope before and after, the money roll-up on
the dashboard, turning the AI provider on and testing it.

**Real projects, and two of them decide which customers you can sell to at
all** — WhatsApp media, voice transcription, **Arabic documents**, employer
forms and Aconex, and **UAE hosting**.
