# VO Capture & Control — Test Plan

Eighteen stages, in order. Do not skip: each one uses what the last one made.

**Nothing is created for you.** The database starts empty. You build every
person, project and change through the app, so what you test is what a client
does on day one.

---

## The cast — six staff, two clients

| Role | Name | Email |
|---|---|---|
| Admin / Owner | Aryia | `sumunit2@gmail.com` |
| Project Manager 1 | Abdelmoneim | `osman.constructionsystems@hotmail.com` |
| Project Manager 2 | Hashim | `mohammedosman2400@outlook.com` |
| Quantity Surveyor | Osman | `guided369@gmail.com` |
| Site Engineer 1 | Ahmed | `org3700@gmail.com` |
| Site Engineer 2 | Hassan | `mohammedossidahmed@gmail.com` |
| **Client 1** (contact) | Mohammed Hassan | `mo@mohammedosman.studio` |
| **Client 2** (contact) | Mohammed Yasseen | `mohammed@osmansidahmed.com` |

Clients are **contacts, not users**. They never sign in. They get emails.

No managing director in this plan. He holds no approval seat any more, so he is
not on the path. He still gets late-work escalations; that is Stage 15.

## The two projects

| Code | Project | Client | PM | Engineer |
|---|---|---|---|---|
| **DXB-001** | DIFC Office Fit-Out | Client 1 | Abdelmoneim | Ahmed |
| **AUH-003** | Al Maryah Clinic | Client 2 | Hashim | Hassan |

One project each. That is the smallest shape that proves a person on one
project cannot reach the other.

## The one handset

One WhatsApp number, held by **one person at a time**. Whoever holds it is the
name on every report from it. The plan moves it once (Stage 17), and the move
is itself a test.

## Moving the clock

Most of this system is dates. On the day you type the data, nothing is due yet,
so every sweep honestly says "nothing to do". Two levers instead of waiting:

**Run a job now.** n8n → `VO Capture & Control · MASTER` → **Lane M** → node
`M2` → set `JOB` → **Test workflow**.

| `JOB` | What it does |
|---|---|
| `reminder_sweep` | Chases whoever owes a decision; escalates what is late |
| `bottleneck_sweep` | Finds what is stuck, puts it on **Blocked** |
| `client_followup` | Chases the client on a submitted variation |
| `notification_dispatch` | Pushes anything pending, files unfiled notices |

**Run it as another day.** In the same node set `AS_OF = '2026-10-20'`. Needs
`ALLOW_JOB_TIME_TRAVEL=true` on the server. **Turn it off when you finish** —
left on, one mistyped date emails a real client about a deadline six months out.

---

# Stage 0 · Empty it and get in

```bash
ssh root@187.127.210.248 'cd /docker/vo && git pull && ./deploy/release.sh'
```

Then `WIPE=yes npm run db:wipe`, open `/admin-signin` → **Set up the company**,
and create Aryia.

### Pass when
- [ ] The set-up button appears only while the company has zero users
- [ ] After Aryia exists, `/admin-signup` refuses for good
- [ ] `/login` redirects to `/signin`

---

# Stage 1 · Company and the five other accounts

As Aryia: company settings, then `Settings` → `Users` → invite PM1, PM2, QS,
SE1, SE2 with the roles above. Set passwords directly for two, email a reset
link for the rest.

### Pass when
- [ ] All six sign in
- [ ] A reset link lands on `/set-password` and works once
- [ ] Nobody sees a project yet — no team membership, no access

---

# Stage 2 · Two projects and their contract rules

Create DXB-001 and AUH-003. Then set contract rules **differently on purpose**:

| Rule | DXB-001 | AUH-003 |
|---|---|---|
| Notice period | **21 days** | **28 days** |
| Retention | 5% | **10%** |
| Client follow-up | on, every 7 days | **off** |
| Client response window | 14 days | 14 days |

### Pass when
- [ ] Both save and read back exactly
- [ ] Nothing in the app shows 28 days for DXB-001 anywhere, at any later stage

> The different notice periods are the point. A notice deadline that says 28 on
> DXB-001 means the period is hardcoded somewhere, and that is a fail.

---

# Stage 3 · Teams and client contacts

Assign Abdelmoneim + Ahmed + Osman to DXB-001; Hashim + Hassan + Osman to
AUH-003. Add Client 1 to DXB-001 and Client 2 to AUH-003 as contacts, with
authority flags set deliberately. Set each project's **notice recipient** to its
client's email.

### Pass when
- [ ] The QS is on both, the PMs and engineers on one each
- [ ] Notification can be switched on for someone without giving them edit rights
- [ ] Authority flags are chosen one by one, not inferred from contact type

---

# Stage 4 · Who sees what

Sign in as each person and look at the register, the dashboard and search.

### Pass when
- [ ] Abdelmoneim sees DXB-001 only, Hashim AUH-003 only
- [ ] Ahmed pasting an AUH-003 URL gets **403**, not an empty page
- [ ] Osman (QS) sees both
- [ ] Aryia can administer without being on a project team

---

# Stage 5 · Capture from the handset

Give the number to **Ahmed** (`Users` → Ahmed → WhatsApp number). From the
handset: `I want to report a change`. Answer the questions it asks. Be vague on
one answer so it has to ask again.

### Pass when
- [ ] It asks one thing at a time, and never guesses
- [ ] It reads the record back before writing anything
- [ ] It closes the conversation rather than leaving it open
- [ ] "Yesterday" or "last Monday" becomes a real date
- [ ] **What Ahmed typed is kept word for word**
- [ ] The reference reads `PC-DXB-001-0001`

Also report one through `/report-change` on a phone, with a photo and a voice
note, so you have a second and third change to use later.

---

# Stage 6 · What it produced, and who was told

### Pass when
- [ ] Title is a sentence a QS would write, not the first six words
- [ ] Location and trade filled from the text; nothing invented
- [ ] Missing information lists what it could not find
- [ ] The record says **Claude** read it, not the keyword extractor
- [ ] The voice note is transcribed **under** the typed text, attributed, and
      the audio is still there, playable
- [ ] **Abdelmoneim (PM)** has the review task. Hashim has nothing
- [ ] Ahmed, who reported it, has no task

---

# Stage 7 · The PM review — Yes

As **Abdelmoneim**, open the change.

### Pass when
- [ ] One card, **Review change**, holds the whole question: reference, project,
      location, what changed, Ahmed's original words, who reported it, the
      instruction date, work started, evidence
- [ ] Under **Initial notice**: **21 days** (DXB-001's own rule), the deadline
      and days remaining, coloured
- [ ] Three buttons: Yes · No — not required · Need more information

Press **Yes**.

- [ ] **Nothing goes to the client**, and the screen says so
- [ ] A notice **draft** appears
- [ ] **Osman's QS pricing task exists immediately** — check his list before the
      notice is sent. This is the whole point of the change

---

# Stage 8 · No, and Need more information

On the second change answer **No**. On the third, **Need more information**.

### Pass when
- [ ] **No** cannot be recorded without a reason, chosen from the six
- [ ] The reason shows on the change and in the activity trail
- [ ] **No** still creates the QS task, and drafts no notice
- [ ] **Need more information** cannot be recorded without saying what is missing
- [ ] It raises a task for **Ahmed**, quoting the PM's words, not a paraphrase
- [ ] Box unticked → no QS task. Box ticked → QS task created, and the change
      still reads as waiting for the missing information, not "QS pricing"

---

# Stage 9 · Read it, then send it

As **Abdelmoneim**, open the notice from Stage 7.

1. It opens as a **preview**, not a form
2. **Edit notice** → change a line → **Save draft**
3. **Send initial notice**

### Pass when
- [ ] It quotes Ahmed's own words and reads like a letter
- [ ] Your edit survives into the sent PDF
- [ ] Nobody else's approval is needed or offered
- [ ] Stage 7 sent nothing — **only this button sends**
- [ ] The PDF opens, is laid out properly, addressed to Mohammed Hassan at the
      contract-rules address
- [ ] It reads **Pending delivery**, not Delivered
- [ ] After the delivery callback: **Acknowledgement pending**, Delivered under it
- [ ] As **Aryia** you can neither draft nor send a notice

---

# Stage 10 · A delivery that fails

Post a delivery callback with `status: failed`.

### Pass when
- [ ] The notice says **Delivery failed**, in red
- [ ] A **Retry delivery** button appears
- [ ] The QS pricing task is untouched and pricing carries on
- [ ] The dashboard action queue has a **red** row reading **Retry delivery**
- [ ] Retry queues a new message; the notice is not re-issued

---

# Stage 11 · Pricing

As **Osman (QS)**: labour, materials, plant, subcontract, then prelims % and
overhead & profit %. Submit.

### Pass when
- [ ] The total is calculated, never typed
- [ ] Changing one line changes the total
- [ ] The percentages apply to the whole build-up, not single lines
- [ ] The panel says how many lines rest on a **star rate**
- [ ] As Ahmed, you cannot price anything

---

# Stage 12 · Final approval, which is the sending

As **Abdelmoneim**, open the priced change.

### Pass when
- [ ] **One screen** holds: reference, project, original and changed scope,
      instruction source and date, work started, the notice and its delivery
      state, the recipient, acknowledgement, the value, time impact, evidence
- [ ] The submitted value is **frozen** — reprice after and it does not move
- [ ] **No managing director seat is opened.** Nothing appears for anyone else
- [ ] The PM's approval alone carries it
- [ ] **Approve and send final VO to client** raises the VO, files the PDF in
      `09 Variation Orders`, emails the contract-rules recipient, records the
      submission
- [ ] **Return it to the QS** needs a reason and sends it back to pricing
- [ ] The activity trail names who approved, and when

Repeat on a change whose notice is required and still **Pending delivery**:

- [ ] A red warning names the state the notice is actually in
- [ ] The approve button is **still there** — it warns, it does not block
- [ ] Approving anyway is recorded

---

# Stage 13 · History still reads

Open a change a managing director approved before 22 September 2026.

### Pass when
- [ ] His name, his approval and his timestamp are still shown
- [ ] Nothing suggests it was made by somebody else

---

# Stage 14 · The client answers, or does not

Lane M → `JOB = 'client_followup'`. Run with `AS_OF` empty, then with `AS_OF`
past DXB-001's response window.

### Pass when
- [ ] `mo@mohammedosman.studio` received the variation
- [ ] `AS_OF` empty writes **nothing** — it is not due, and that is a pass
- [ ] `AS_OF` past the window sends the chase
- [ ] It states facts and asks a question. No pressure, no threats
- [ ] **Running it twice on the same `AS_OF` sends once**
- [ ] Recording the client's response stops the chasing at once
- [ ] **AUH-003 never chases** — follow-up is off there

---

# Stage 15 · The clock, every timed step

Lane M, one row at a time. Read the answer on `M4`.

| `JOB` | `AS_OF` | Should happen |
|---|---|---|
| `reminder_sweep` | *(empty)* | Almost nothing |
| `reminder_sweep` | day before the notice deadline | The owner is chased |
| `reminder_sweep` | a week after it | It escalates **above** them |
| `bottleneck_sweep` | a week after it | On **Blocked**, with value at risk |

### Pass when
- [ ] It chases the person who owes the decision, not everybody
- [ ] Escalation goes above them and names why
- [ ] **Repeating a row sends nothing the second time.** This matters most: a
      system that double-chases gets muted, and a muted system is worth nothing
      on the day a notice is actually due
- [ ] Every response carries `ran_as_of` and `simulated: true`
- [ ] With time travel off, `AS_OF` is **refused with a reason**, not ignored

---

# Stage 16 · Money, register and documents

Raise an application, an invoice, a part payment, a credit note. Then open the
register and the three documents.

### Pass when
- [ ] Retention is **10% on AUH-003**, 5% on DXB-001
- [ ] The invoice due date follows the project's payment terms
- [ ] Claimed, approved, invoiced, paid, retained, outstanding all update
- [ ] The VO PDF is headed **VARIATION ORDER**, not NOTICE, and prints the
      build-up line by line with the basis of each rate
- [ ] The CSV holds **only the filtered rows**, and opens in Excel with Arabic
      intact
- [ ] The evidence ZIP opens by double-click, has `00 Contents.txt`, and names
      **anything left out**
- [ ] On a phone the register becomes cards, not a sideways-scrolling table

---

# Stage 17 · Isolation — move the handset

**A.** As Aryia: `Users` → **Hassan** → add the same WhatsApp number → Save
**B.** From the handset: `I want to report a change`
**C.** As **Ahmed**, paste an AUH-003 change URL

### Pass when
- [ ] The save message says the number was **taken from Ahmed**
- [ ] Ahmed's profile no longer shows a number
- [ ] WhatsApp now offers **AUH-003** — Hassan's project, not Ahmed's
- [ ] The report files under **Hassan**
- [ ] Ahmed gets **403**, and his register never lists an AUH-003 change

> If any screen or search shows Ahmed something from AUH-003, stop. That is the
> one failure this product cannot have.

---

# Stage 18 · Correcting, cancelling, removing

**A.** As Ahmed: correct his own report, then try to edit one he did not report
**B.** As Abdelmoneim: cancel a change with a reason, then reinstate it
**C.** As Aryia: delete a made-up account, then look for Delete on Ahmed's row
**D.** As Aryia: remove Hassan from AUH-003, then add him back

### Pass when
- [ ] Ahmed fixes his own and not somebody else's
- [ ] Cancelling closes the open tasks and keeps the record, reason and name
- [ ] Reinstating keeps the **original capture date**
- [ ] Deleting a change whose notice was **served** is refused
- [ ] Ahmed shows **no Delete** — instead a line naming what still points at him.
      Deactivate is the answer for a leaver
- [ ] Removing Hassan is reversible: re-adding restores the same role, and
      Activity shows both events
- [ ] Deleting the last administrator is refused, with a reason

---

# Stage 19 · The dashboard

**Goal** — a PM opens it and knows which change to handle first, without
reading a chart.

Do this last, when the projects above have produced real rows.

### Do

Open **Overview** as Abdelmoneim (PM), then as Osman (QS), then as Ahmed
(engineer), then as Aryia (admin).

### Pass when

- [ ] **Four** KPI cards at most, never more
- [ ] **Needs Action Today** is a table, not a wall of cards
- [ ] Every row names the **next action** in words — "Send initial notice",
      "Submit pricing", "Approve final VO" — not a status
- [ ] Every row shows priority, reference, project, owner, value and the date
- [ ] Clicking a row opens that change. A notice row lands **on the notice**,
      not at the top of the page
- [ ] The filters **All · Mine · Notices · QS pricing · PM approval · Client ·
      Red only** each change the list, and the URL
- [ ] Sorting by **Highest value** puts the big one first even if it is green
- [ ] Sorting by **Nearest deadline** puts rows with no deadline **last**
- [ ] The workflow pipeline shows six stages with count, value and the oldest
      wait, and each one opens a filtered register
- [ ] The project table is sorted with the **most unapproved work at the top**

### As each person

- [ ] **Ahmed (engineer)**: no money cards at all, no project table, and
      `/reports` refuses him — a 403, not a blank page
- [ ] **Osman (QS)**: pricing rows, no notice rows
- [ ] **Abdelmoneim (PM)**: every notice state, pricing, approvals, client
- [ ] **Aryia (admin)**: all four cards and the project table

### The two that matter most

- [ ] Start work on a change before it is approved → a **red** card *Work
      started without approval* with the value, and a red row saying
      **Approve it or stop the work**
- [ ] Make a notice delivery fail → a **red** row saying **Retry delivery**,
      and pricing carries on beside it

---

## What to record

Pass or fail per stage. On a fail: what you did, what you expected, what
happened, plus a screenshot of anything visual. **A stage that half-works is a
fail.** Note it and carry on — later stages still tell you something.

## Commands

```bash
# Deploy
ssh root@187.127.210.248 'cd /docker/vo && git pull && ./deploy/release.sh'

# Empty everything (irreversible)
WIPE=yes npm run db:wipe
```

## Addresses

| Address | What it is |
|---|---|
| `/signin` | Everybody signs in here |
| `/admin-signin` | The same, plus set-up while the company is empty |
| `/set-password` | Where an invitation or reset link lands |

## Known gaps — not failures

- **WhatsApp media.** Photos and voice notes do not arrive; the capture lane has
  no download step. The form and email carry them fine.
- **Arabic PDFs.** The interface is RTL-ready; the PDF writer has no Arabic font.
- **Outbound WhatsApp.** The n8n lane is active but has no gateway configured.
  Email notification is unaffected.
