# VO Capture & Control — Service Reference

A reference description of what this product is and does. Written to be handed
to an AI as context when asking for plans, strategy, positioning, pricing, or
go-to-market work. It describes capability, not implementation.

---

## In one paragraph

VO Capture & Control is a variation-order management system for fit-out and
interior contractors. It captures site-level changes the moment they happen —
from a WhatsApp message, a photograph, or an email — turns each one into a
tracked contractual record with a live deadline, drives it through internal
assessment, approval, pricing and client submission, and follows the money all
the way to payment. It exists because the commercial value of a change is
decided in the first days after it occurs, and most of that value is lost to
paperwork that nobody had time to start.

---

## The problem it addresses

On a fit-out project, changes arrive constantly and informally: a consultant
asks for a different finish, a landlord restricts access, a civil defence
officer requires an extra detail, a drawing is revised. Each one may carry a
cost and a time entitlement — but only if it is **noticed in writing, within the
contractual window**, and only if the evidence still exists when somebody
argues about it months later.

Three failures cost contractors money on almost every project:

1. **The change is never captured.** It lives in a WhatsApp thread and is
   remembered at final account, when it is too late to claim.
2. **The notice window closes.** Most contracts require written notice within a
   fixed number of days of the event. Miss it and entitlement is lost, however
   good the underlying case.
3. **The submission is never chased.** A priced variation sits unanswered with
   the client for months because nobody owns following it up.

This system is built so that all three are structurally difficult to get wrong.

---

## Who uses it

| Role | What they do in the system |
|---|---|
| **Site engineer / foreman** | Reports a change from the field, usually by WhatsApp with a photo. Never has to open the app. |
| **Project manager** | Decides whether a change needs a formal notice; approves the notice; owns scope. |
| **Quantity surveyor / commercial** | Prices the variation, raises applications and invoices, tracks payment. |
| **Commercial manager / director** | Oversees the register, approves value, watches the exposure across projects. |
| **Managing director** | Final approval authority; sees everything; can move any decision forward. |
| **Client / main contractor** | Receives notices and priced variations, and is followed up automatically. |

Authority is defined by a **capability matrix**, not by job title. Who may
approve, price, or issue a notice is a configurable permission per project, so
the system fits a company's real delegation rather than forcing an org chart.

---

## How work enters the system

### WhatsApp capture
A site engineer sends a message, a photo, a voice note, or a document to the
company's number. The system identifies the sender, works out which of their
projects it relates to, and files it. If anything is ambiguous it **asks a
question rather than guessing** — which project, whether this is a new change
or evidence for an existing one, when the event happened, how many days notice
the contract requires.

The exchange is conversational and asks one thing at a time: whether the work
has started, when it happened, who asked for it, and which drawing it came
from. It understands a short reply ("the ceiling one", "yes", "thanks"), reads
a photo caption as a strong signal, accepts several files at once, reads the
whole thing back for confirmation before anything is written, and closes the
conversation politely instead of leaving an open loop.

Answers are standardised as they arrive. "Yesterday", "last Monday", "the
15th", "23rd of August" and "a couple of weeks back" all become one calendar
date; "the consultants", "supervision consultant" and "MEP" all become one
named party. What the reporter typed is kept word for word; what the register
counts is consistent.

### Email capture
Mail sent to the project inbox is parsed the same way, with attachments
preserved as evidence. Replies land on the original thread, so a question from
the system appears where the person expects it rather than as unrelated noise.

### Direct entry
A mobile-first web form for anybody who prefers to type it in, and a full
desktop interface for the commercial team.

### Document watch
Files landing in the project's document folder are registered automatically and
indexed, so drawings, specifications and correspondence are searchable and can
be attached to a change as supporting evidence.

---

## The lifecycle of a change

```
Reported  →  Potential Change  →  Notice assessment  →  Notice issued
                                                              ↓
Payment  ←  Invoice  ←  Client approval  ←  Submitted  ←  Priced & approved
```

**1 · Potential Change.** Every report becomes a numbered record —
`PC-{PROJECT}-0001` — with the reporter's own words preserved verbatim, the
event date, evidence, and an owner. Nothing is thrown away and nothing is
edited into a summary.

**2 · The notice clock starts immediately.** The contractual notice period is
configured per project. The deadline is calculated from the event date, shown
as a live countdown, and colour-coded — green with time in hand, amber
approaching, red once breached.

**3 · Notice assessment.** The project manager decides: notice required, not
required, or more information needed. Both the project manager and the managing
director are told the moment a change is captured, so nobody discovers a
deadline on the day it expires.

**4 · The notice goes to the client** as a formal document the moment it is
approved, and the delivery is recorded as evidence of service.

**5 · Pricing.** The commercial team builds the value from line items —
labour, materials, plant, subcontract, preliminaries, overhead and profit —
with the contract's own rates and mark-ups applied.

**6 · Approval.** Value passes through configurable approval gates before it
can leave the building. Thresholds are per project, so a small variation does
not need the same signatures as a large one.

**7 · Submission and client follow-up.** The priced variation is submitted, and
the client is followed up automatically on a cadence the company sets — or not
at all, if that relationship is handled in person.

**8 · The money.** Approved variations flow into progress applications and
invoices, with retention held and released, credit notes where value comes
back, and payments recorded against what is owed.

---

## Feature summary

### Capture and evidence
- WhatsApp, email, web form, and document-folder ingestion
- Conversational follow-up that asks rather than assumes
- Photographs, voice notes, drawings and documents held as immutable evidence
- Every message deduplicated, so a retried delivery never creates a duplicate record
- The reporter's original words preserved for the life of the record

### Contractual control
- Per-project contract rules: notice period, detailed claim period, response
  periods, delivery method, named recipient
- Automatic notice deadlines with live countdown and risk colouring
- Formal notice documents generated from the record and issued to the client
- Delivery confirmed by callback, never assumed

### Commercial management
- Full variation register with filtering, search and mobile card view
- Line-item pricing with contract rates, mark-ups and preliminaries
- Approval gates by value, resolved through the permission matrix
- Progress applications and invoices, with retention held automatically
- Credit notes, retention release in contractual moieties, and payment tracking
- A live commercial position per project: claimed, approved, invoiced, paid,
  retained, credited, outstanding

### Time and extension of time
- Days claimed, days approved and days conceded recorded against each variation
- Every time claim requires a stated basis, so a bare number cannot be submitted

### Follow-up and escalation
- Daily chasing of whoever owns the next decision, by seat rather than by name
- Escalation when a decision goes unanswered
- Automatic client follow-up on submitted variations, at a company-set interval,
  which stops the moment the client answers
- Bottleneck detection: what is blocked, for how long, and how much value is
  waiting behind it

### Intelligence
- Duplicate detection — flags when a change looks like one already raised
- Semantic search across the project's commercial documents
- Automatic extraction of dates, document references, work status and the
  instructing party from a free-text report, standardised on the way in
- **Every commercial figure is calculated in code.** The AI reads, suggests and
  routes; it never computes a number and never decides anything on its own.

### Visibility
- Company dashboard: exposure, ageing, risk, value by stage
- Per-project dashboard and a personal task list
- Complete audit trail — every change to every record, with who, when, before
  and after, written in the same transaction as the change itself

### Security and isolation
- Project-level access enforced on the server, not hidden in the interface
- A user on one project cannot reach another project's data by any route,
  including search
- Row-level security in the database as a second layer
- Signed, verified integration endpoints
- Invitation-only accounts; no public sign-up

---

## Deployment model

One self-contained stack per client: their own application instance, their own
database, their own file storage, their own phone number and mailbox. Nothing
is shared between clients — not the database, not the search index, not the
message queue. Adding a client is a new deployment, not a new tenant row.

The automation layer is packaged as a single importable workflow file per
client, carrying every inbound and outbound channel, so a new deployment is one
import and a credential rebind rather than a rebuild.

---

## Design principles worth knowing

These shape what the product will and will not do, and are useful context when
planning around it.

**The system captures; people decide.** It will file a change, calculate a
deadline, and route it to whoever owns the decision. It will not decide whether
a change is a variation, what it is worth, or whether to claim it.

**It asks rather than guesses.** When it cannot tell which project a message
belongs to, or whether a photo is new evidence or a new change, it asks. A
wrong guess puts a claim on the wrong job, and that is worse than a question.

**Evidence is immutable.** Original photographs and messages are never
overwritten, never edited, and never deleted by the system. Anything the
software derives is stored beside the original, never in place of it.

**Money is arithmetic, not judgement.** Every figure is computed from stored
rates and quantities and is reproducible from the record. Issued paperwork
freezes the rates that produced it, so a document reissued a year later shows
the same numbers.

**Silence is a designed behaviour.** Not everyone is told everything. A
director copied on every decision from hour one stops reading all of them, so
the system deliberately stays quiet until a decision is actually owed.

**Cadence belongs to the company.** How hard a client is chased, what the
notice period is, what thresholds require which approval — all configurable per
project, because these are commercial postures and they differ by contract.

---

## Market position

**Who it is for:** fit-out, interior and specialist contractors running
multiple concurrent projects where changes are frequent, informal and
contractually time-bound. Initially UAE, where fit-out programmes are short,
change volume is high, and notice provisions are strictly enforced.

**What it replaces:** a spreadsheet register that is always out of date, a
WhatsApp thread nobody can search, and a commercial manager's memory.

**What makes it different from generic project management:** it is built around
the *contractual clock*, not around tasks. The deadline, the evidence, and the
chain of authority are the product. Everything else follows from them.

**The value proposition in one line:** every change captured the day it
happens, every notice served inside its window, and every submitted variation
chased until the client answers.
