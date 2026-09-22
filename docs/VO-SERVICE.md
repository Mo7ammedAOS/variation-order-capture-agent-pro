# VO Capture & Control — Service Reference

What this product is and does. Hand it to an AI as context for plans, pricing,
positioning or go-to-market. It describes capability, not code.

---

## In one paragraph

VO Capture & Control is a variation-order system for fit-out and interior
contractors. It captures a site change the moment it happens — WhatsApp, photo,
email or form — turns it into a numbered contractual record with a live
deadline, drives it through the PM's notice decision, pricing, approval and
client submission, and follows the money to payment. It exists because the
value of a change is decided in the first days after it occurs, and most of that
value is lost to paperwork nobody had time to start.

---

## The problem

Three failures cost fit-out contractors money on almost every project:

1. **The change is never captured.** It lives in a WhatsApp thread and is
   remembered at final account, too late to claim.
2. **The notice window closes.** Most contracts require written notice within a
   fixed number of days. Miss it and entitlement is lost, however good the case.
3. **The submission is never chased.** A priced variation sits unanswered for
   months because nobody owns following it up.

The system is built so all three are structurally hard to get wrong.

---

## Who uses it

| Role | What they do |
|---|---|
| **Site engineer** | Reports a change from the field, usually by WhatsApp with a photo. Never has to open the app |
| **Project manager** | Decides whether a change needs a notice, sends it, and approves the final priced variation. The only internal approver |
| **Quantity surveyor** | Prices the variation, raises applications and invoices, tracks payment |
| **Commercial manager** | Watches the register and the exposure across projects |
| **Managing director** | Sees everything, and is told about anything three working days late. **Holds no approval seat** — a second signature on every change was a person who could be on a plane |
| **Client** | Receives notices and priced variations, and is chased automatically |

Authority comes from a **capability matrix, not a job title**. Who may approve,
price or issue a notice is configurable per project, so the system fits the
company's real delegation.

---

## How work gets in

**WhatsApp** — the engineer sends a message. The system identifies the sender,
works out the project, and **asks a question rather than guessing** when
anything is unclear. One thing at a time. It reads the record back before
writing, and closes the conversation instead of leaving it open.

**Email** — parsed the same way, attachments kept as evidence, replies landing
on the original thread.

**Web form** — mobile-first for the field, full desktop for the commercial team.

**Document watch** — files landing in the project folder are registered and
indexed, so drawings and specs are searchable and attachable as evidence.

Answers are standardised on the way in — "last Monday" becomes a date, "the
consultants" becomes a named party — and **what the reporter typed is kept word
for word underneath**.

---

## The life of a change

```
Reported → PM review → QS pricing → PM approval → Sent to client → Client decision → Closed
              │
              └── Initial notice runs beside it, on its own track
```

**1 · The record.** `PC-DXB-001-0001`, the reporter's own words, the event date,
evidence, an owner. Nothing is thrown away or edited into a summary.

**2 · The clock starts at once.** The deadline is the event date plus **the
project's own** notice period. Live countdown, green to red.

**3 · The PM decides, on one screen.** Notice required, not required, or more
information needed. "No" requires a reason. "More information" requires saying
what is missing, and raises a task for whoever reported it.

**4 · Pricing starts at that decision**, not after the notice clears. The notice
never holds up a price.

**5 · The notice goes out on one deliberate act.** The PM reads the draft, edits
it, and presses send. Delivery is confirmed by callback, never assumed.

**6 · Approval is the sending.** The PM approves the priced variation, and that
one act raises the VO, renders the PDF, files it, emails the client and records
the submission.

**7 · Follow-up.** The client is chased on the company's own cadence, which
stops the moment they answer, and can be switched off per project.

**8 · The money.** Applications, invoices, retention, credit notes and payments,
with a live commercial position per project.

---

## What it does

**Capture and evidence** — four channels, conversational follow-up, immutable
photographs and voice notes, deduplicated so a retried delivery never doubles a
record.

**Contractual control** — per-project notice and claim periods, live deadlines
with risk colouring, formal notice documents generated from the record,
**delivery confirmed by callback and never assumed**.

**Commercial** — a full register with URL-based filters, line-item pricing with
a real rate hierarchy, approval through the permission matrix, applications and
invoices with retention held automatically, credit notes, retention release in
moieties, payment tracking, and a live position: claimed, approved, invoiced,
paid, retained, credited, outstanding. UAE VAT done correctly.

**Time** — days claimed, approved and conceded. **A time claim cannot be
submitted without a stated basis.**

**Chasing** — daily chasing of whoever owns the next decision, **by seat rather
than by name**, so it survives someone leaving. Bottleneck detection showing
what is blocked, for how long, and **the value waiting behind it**.

**Intelligence** — duplicate detection that suggests and never merges, semantic
search across the project's own documents, and extraction of dates, references
and the instructing party from free text. **Every commercial figure is
calculated in code.** The AI reads, suggests and routes. It never computes a
number and never decides anything.

**Security** — project access enforced on the server, not hidden in the
interface. A user on one project cannot reach another's data by any route,
search included. Row-level security as a second layer. A complete audit trail
written in the same transaction as the change.

---

## Deployment model

One self-contained stack per client: their own app, database, file storage,
phone number and mailbox. **Nothing is shared between clients.** Adding a client
is a new deployment, not a new tenant row. The automation layer is one
importable workflow file per client, so a new deployment is an import and a
credential rebind rather than a rebuild.

---

## Principles worth knowing

**The system captures; people decide.** It files the change, calculates the
deadline, and routes it to whoever owns the decision. It does not decide whether
a change is a variation, what it is worth, or whether to claim it.

**It asks rather than guesses.** A wrong guess puts a claim on the wrong job,
and that is worse than a question.

**Evidence is immutable.** Originals are never overwritten, edited or deleted.
Anything derived is stored beside the original, never in place of it.

**Money is arithmetic, not judgement.** Every figure is reproducible from the
record, and issued paperwork freezes the rates that produced it.

**Silence is designed.** A director copied on everything from hour one stops
reading any of it, so the system stays quiet until a decision is actually owed.

**Cadence belongs to the company.** Notice periods, chasing intervals and
thresholds are commercial postures, and they differ by contract.

---

## Market position

**For** fit-out, interior and specialist contractors running several projects
where changes are frequent, informal and time-bound. UAE first, where programmes
are short, change volume is high, and notice provisions are enforced.

**It replaces** a register that is always out of date, a WhatsApp thread nobody
can search, and a commercial manager's memory.

**It is not generic project management.** It is built around the *contractual
clock*. The deadline, the evidence and the chain of authority are the product.

**In one line:** every change captured the day it happens, every notice served
inside its window, and every submitted variation chased until the client answers.
