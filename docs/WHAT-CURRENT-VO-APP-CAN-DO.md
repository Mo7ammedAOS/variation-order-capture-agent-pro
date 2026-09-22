# What the VO app can do

Checked against the code, not the plan.

| | |
|---|---|
| **Live at** | `vo.osmanflow.com` |
| **Build** | `d1ece7e`, deployed 22 September 2026 |
| **Tests** | 685 across 48 files |
| **Database** | Supabase Postgres, Singapore |
| **Files** | Google Drive |
| **AI** | Claude Sonnet 5 — reads every capture. Billed per message |
| **Voice** | ElevenLabs Scribe — live, and idle until WhatsApp media works |
| **Automation** | n8n `VO Capture & Control · MASTER`, 62 nodes, active |

Part 1 is what works. Part 2 is what does not. Read both.

---

# Part 1 · What it does

## Accounts

- **Invitation only.** No public sign-up. The set-up page closes for good once
  the first account exists.
- 11 system roles, 13 project roles, and **30 capabilities** an admin can change
  at runtime with no deploy. A missing permission is a **denial**, never a
  default allow.
- Deactivate a leaver (his name stays on his work) or delete an account added by
  mistake. Delete is refused for anyone the records still point at.
- **One WhatsApp number belongs to one person.** Moving it *takes* it, so two
  people can never hold one handset identity.

## Projects

- Code, name, client, consultant, contract number, dates, value, currency.
- **Eight tabs**, each a real link: overview, changes, contract rules, contacts,
  team, documents, tasks, activity.
- Team members get access and notification **separately** — you can watch a
  project without editing it.
- Removing someone is reversible and keeps the history, so "who could instruct
  work last March" still has an answer.
- **Client contacts carry explicit authority flags** — can request a change, can
  instruct work, can approve cost, can sign the final VO. Each set deliberately.

## Contract rules — per project, nothing hardcoded

Notice period · detailed claim period · notice recipient and delivery method ·
EOT required or not · approval thresholds · high-risk value · client response
window · follow-up on/off and its interval · QS pricing days · approval days.

Defaults are 28 and 42 days, but **the project's own numbers are what the app
uses**, everywhere.

## Getting a change in

**Four ways in:** mobile web form, WhatsApp, email, watched folder.

**It asks rather than guesses.** Which project, new or evidence for an existing
one, when, who instructed it, has work started. One question at a time. It reads
the record back before writing anything, and closes the conversation instead of
leaving it hanging.

**It standardises without overwriting.** "Yesterday" becomes a date, "the
consultants" becomes a named party — and **what the reporter typed is kept word
for word** underneath.

**A voice note becomes words** on the form and on email, filed as evidence
either way, never replacing the audio.

**Anything it cannot place goes to a triage queue** instead of into a hole.

## The record

- References like `PC-DXB-001-0004`, from a race-safe counter.
- **Seven stages in plain words:** new change → PM review → QS pricing → PM
  approval → sent to client → client decision → closed.
- Eleven statuses underneath, because the engine must tell "not assessed yet"
  from "waiting for something we asked for". Two are retired; old rows still
  read and still have a way forward.
- Transitions are gated — you cannot jump a stage.
- Cancel with a reason and reinstate with the **original capture date**. Delete
  permanently is restricted, and refused once a notice is served.
- **Duplicate detection suggests, never merges.**
- Semantic search across the project's own documents, **scoped to that project
  first**. Cross-project search is not missing, it is forbidden.

## The notice

- Deadline = event date + **the project's** notice period. Green, amber, red —
  and red at zero is not configurable.
- **One PM screen** holds the whole decision: what changed, the reporter's own
  words, the date, whether work started, the evidence, then the notice period,
  deadline and days left.
- **Three answers.** Yes drafts a notice. No needs a reason from a fixed list of
  six. Need more information needs saying what is missing, and raises a task for
  whoever reported it quoting those words.
- **QS pricing starts at the decision**, not after the notice. A notice being
  drafted, sent or acknowledged never holds up a price.
- **Deciding is not sending.** The draft opens as a preview — recipient, method,
  reference, deadline, attachments, then the words — with Edit, Save draft and
  **Send initial notice**. Nothing reaches the client until that button.
- **Seven delivery states:** not applicable · draft · pending delivery ·
  delivered · delivery failed · acknowledgement pending · acknowledged.
- **Delivered only on a callback.** Never on the strength of our own send. A
  failure goes red, offers retry, and leaves pricing running.

## Evidence

A numbered folder tree per project (contract, drawings, specs, BOQ, programme,
correspondence, changes, notices, variation orders), race-safe so two captures
cannot make two folders of one name. **Originals are never overwritten or
deleted.** Files are served through an access-checked route, never a Drive link.

## Pricing

Line items with description, quantity, unit, rate and a **rate source** —
contract BOQ → pro rata → star rate → quotation → daywork. The panel says how
many lines rest on a star rate, because that is what a consultant attacks first.
Prelims % and overhead & profit % per change. **"Not a variation" is a real
outcome.** Every figure is calculated in code; the AI never computes a number.

## Approval

- **The project manager is the only internal approver.** One gate, one seat. The
  managing director's seat came out on 22 September 2026.
- **Approving sends it.** One button raises the VO, renders the PDF, files it in
  `09 Variation Orders`, emails the contract-rules recipient and records the
  submission — which starts the client's response clock.
- A required notice that is not confirmed delivered shows a **red warning naming
  the state it is in**. It warns; it does not block.
- Seats are filled from the **capability matrix, not a job title**.
- **Approvals given before the change stand.** A variation an MD approved goes on
  showing that.

## Money

Raise a VO, record submission and the client's response, withdraw one. Client
follow-up on the project's own cadence, which **stops the moment they answer**
and can be switched off per project. Applications and invoices with retention
held automatically, retention release in moieties, credit notes, part payments.
A commercial position per project: claimed, approved, invoiced, paid, retained,
credited, outstanding. **VAT at 5% on the rounded net**, half-up — the UAE tax
invoice convention, done deliberately.

## Time

A time impact flag and estimated days. Days claimed, approved and conceded.
**A time claim cannot be submitted without a stated basis** — a bare number is
refused.

## Tasks and chasing

12 task types. **My Tasks** ordered overdue, today, upcoming. A reminder sweep
that chases **by seat, not by name**, so it survives someone leaving. Bottleneck
detection: what is blocked, who by, how long, and **the value waiting behind
it** — including approved work not yet billed and invoices past their terms.

## Notifications

Email and WhatsApp, recipients resolved by seat on the project.
**Deduplicated** — one event cannot notify twice. Delivery confirmed by
callback. An in-app screen with an unread count.

## Screens

`/dashboard` · `/my-tasks` · `/projects` (8 tabs each) · `/variations` ·
`/report-change` · `/bottlenecks` · `/notifications` · `/settings/*` ·
`/signin` · `/admin-signin`

The dashboard opens with a money funnel (agreed → invoiced → received) and two
gauges, then **26 cards ordered by urgency, not total** — overdue notices first
— in four sections: Needs attention now, The money, Retention and time,
Breakdowns. Four of the cards are the notice's own track, and they are the only
place a stalled notice surfaces now that pricing no longer waits for it.

The register has 15 columns, filters that live **in the URL** so a filtered view
is a link you can send, and cards on a phone. The project report is ordered by **notice deadline, not PC number**:
sorted by number it is a filing system, sorted by deadline it is a list of what
to deal with.

## Security

Project access is enforced **on the server**, in one choke point every service
calls. A user on one project gets **403, not an empty list**, on every route
belonging to another — search included. Row-level security in the database as a
second layer. Signed integration endpoints with idempotency. A complete audit
trail written **in the same transaction** as the change, so a gap cannot happen.
One installation per company; nothing is shared between clients.

## n8n

One workflow per client, 62 nodes, lanes A–H. **n8n decides nothing and writes
nothing to the database.** Every lane is a courier carrying a payload the app
wrote.

---

# Part 2 · The limits

## Does not work at all

| | What is true |
|---|---|
| **WhatsApp photos, voice notes, PDFs** | Text arrives, **media does not**. The lane has no download step. This one gap also idles the transcription vendor |
| **Employer forms** | No Emaar, Nakheel, DM or RTA templates. No Aconex export |
| **Arabic documents** | The interface is RTL-ready; the PDF writer has **no Arabic font**. English output only |
| **Escalation service** | A 21-line stub. Reminders and chasing are real; formal escalation levels are not written |
| **Programme link** | You can record 14 days. You cannot say which activities |
| **Drawing revisions** | Stored and searchable. Nothing compares a revision to the tendered drawing |

## Half works

- **Voice transcription** — built, paid for, and has nothing to hear until
  WhatsApp media lands.
- **Outbound WhatsApp** — the n8n lane is active, but no gateway is configured.
  Email is unaffected.
- **Weekly report lane** — mapped, not built.

## In the database with no screen

Cannot be changed without a developer: retention 5%, payment terms 30 days,
retention release 50%, defects liability 365 days, VAT 5%, company logo and
brand colours, template names, the approval and reminder rule JSON.

## Deployment and compliance

- **Data is in Singapore, not the UAE.** For government clients and some
  developers that is a procurement blocker, not a preference. Cheapest to move
  now, at this size.
- The GitHub repository is **public**. Osman's call.
- `ALLOW_JOB_TIME_TRAVEL` is off, which is right — on, a simulated run sends
  real messages to real people.
- **Two vendors bill per use** (Anthropic per message, ElevenLabs per minute)
  and **neither has a spend cap**.
- **A message the system cannot place is on no screen anybody opens.** The
  Capture Inbox left the navigation on 13 Sep. `/inbox` still reaches it if you
  type it.
- **Nothing since 12 September has been walked by a person on production.** The
  unit suite proves the logic. It proves nothing about whether a button is
  reachable or a PDF opens. `TEST-PLAN.md` exists for exactly that.

---

# The short version

**The hard half is built**: the notice clock with per-contract configuration,
the gated lifecycle, permissions through a capability matrix, a pricing build-up
with a real rate hierarchy, the money engine to payment with correct UAE VAT,
project isolation proven at the service layer, and an audit trail that cannot
have gaps. That is the part that takes months.

What is missing is three things:

1. **Forty minutes of attention** — nobody has used the new workflow on the live
   system. Cheapest item on the list, and the only one that tells you whether the
   rest is real.
2. **One n8n lane** — WhatsApp media. It gates more of the product than its size
   suggests.
3. **Three things that decide who you can sell to** — Arabic documents, employer
   forms and Aconex, and **UAE hosting**.
