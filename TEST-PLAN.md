# VO Capture & Control — Full Test Plan

Twenty-two stages, in order. Each builds on the last, so do not skip.
By the end, every part of the system has been exercised by hand, with real
inboxes and one real handset.

**Nothing is created for you.** The database is empty on purpose. Every person,
project, contact and change below is made by you, through the app — so what you
are testing is exactly what a client does on their first day.

---

## The cast

Nine people. Seven work for the company, two are clients. Every address is a
real inbox, so every message the system sends can actually be read.

| # | Role | Name | Email |
|---|---|---|---|
| 1 | Company Owner / Administrator | Aryia | `sumunit2@gmail.com` |
| 2 | Managing Director | Mohammed | `mohammed@osmanflow.com` |
| 3 | Quantity Surveyor | Osman | `guided369@gmail.com` |
| 4 | Project Manager 1 | Abdelmoneim | `osman.constructionsystems@hotmail.com` |
| 5 | Project Manager 2 | Hashim | `mohammedosman2400@outlook.com` |
| 6 | Site Engineer 1 | Ahmed | `org3700@gmail.com` |
| 7 | Site Engineer 2 | Hassan | `mohammedossidahmed@gmail.com` |
| 8 | **Client 1** | Mohammed Hassan | `mo@mohammedosman.studio` |
| 9 | **Client 2** | Mohammed Yasseen | `mohammed@osmansidahmed.com` |

Clients are **contacts**, not users. They never sign in. They receive notices
and priced variations by email.

## The four projects

| Code | Project | Client | PM | Site Engineer |
|---|---|---|---|---|
| DXB-001 | DIFC Gate Avenue Office Fit-Out | Client 1 | Abdelmoneim | Ahmed |
| DXB-002 | Dubai Hills Mall Flagship Retail | Client 1 | Abdelmoneim | Ahmed |
| AUH-003 | Al Maryah Clinic Interior Works | Client 2 | Hashim | Hassan |
| DXB-004 | Business Bay Serviced Apartments | Client 2 | Hashim | Hassan |

Each PM carries two. Each site engineer carries two. Each client owns two.
That shape is deliberate: it is the smallest arrangement that can prove a
person on one project cannot reach another.

## The one handset

You have a single WhatsApp number, and it belongs to **one person at a time**.
Whoever holds it is the name on every report from it. The plan moves it twice,
and each move is itself a test.

Throughout, **the number** means your real WhatsApp number.

---

# Stage 0 · Empty the system and get in

**Goal** — a system with nothing in it, and one account that can start.

The database has already been emptied. That included the permission matrix, so
right now **nobody can do anything at all, including an administrator**. A
missing permission is a denial by design, so that a right somebody revoked
cannot quietly come back on the next deploy.

### Do

```bash
# 1 — put the latest build on the server
ssh root@187.127.210.248 'cd /docker/vo && git pull && ./deploy/release.sh'

# 2 — restore the matrix, the company, and one account
npm run db:bootstrap -- \
  --email sumunit2@gmail.com \
  --name "Aryia" \
  --company "Osman Contracting"
```

Run step 2 wherever your `.env` points at the live database.

It restores the permission matrix from the code defaults, creates the company
record, and creates **one** account. Nothing else.

The password is never printed anywhere. A set-password email is sent instead.

### Expect

- `permissions restored: ~200`
- `company settings created: Osman Contracting`
- `owner created: Aryia <sumunit2@gmail.com>`
- An email arrives at that address. Follow it, set a password, sign in.

### Pass when

- [ ] You are signed in at `https://vo.osmanflow.com` as Aryia
- [ ] The sidebar shows **Overview, My Tasks, Variations, Held Up, Capture Inbox, Projects, Company, Users, Permissions**
- [ ] Overview is empty — no changes, no value, no tasks

> If the email never arrives, run the command again with a different `--email`.
> It reuses an existing identity rather than creating a second one.

---

# Stage 1 · Company settings

**Goal** — the details that appear on every notice and every email.

### Do

`Company` in the sidebar. Set the legal and display name, currency **AED**,
timezone **Asia/Dubai**, the email sender name and address, and the WhatsApp
business number. Leave the amber threshold at **7 days**.

### Pass when

- [ ] The company name appears at the top of the sidebar
- [ ] Reloading keeps every value

---

# Stage 2 · Create the seven staff accounts

**Goal** — everybody who works for the company, with the right authority.

### Do

`Users` → `Invite`. Create these six — you are already the seventh.

| Name | Email | System role |
|---|---|---|
| Mohammed | `mohammed@osmanflow.com` | Managing Director |
| Osman | `guided369@gmail.com` | Standard User |
| Abdelmoneim | `osman.constructionsystems@hotmail.com` | Standard User |
| Hashim | `mohammedosman2400@outlook.com` | Standard User |
| Ahmed | `org3700@gmail.com` | Standard User |
| Hassan | `mohammedossidahmed@gmail.com` | Standard User |

**Leave every phone number empty.** The handset is given out in Stage 8.

> Why Standard User for a project manager: authority on a job comes from the
> **project role**, granted in Stage 5. A system role is what somebody can do
> company-wide, and a PM should be able to do nothing company-wide.

### Pass when

- [ ] Seven accounts listed, all Active
- [ ] Each person receives an invitation email
- [ ] At least two of them set a password and sign in

---

# Stage 3 · Create the four projects

**Goal** — four live jobs.

### Do

`Projects` → `New project`, four times, using the codes and names above. For
each: client name, consultant, location, contract number, contract start and
completion, original contract value, currency AED, status **Active**.

### Pass when

- [ ] Four projects listed, all Active
- [ ] Opening one shows eight tabs: Overview, Potential Changes, Contract Rules, Contacts, Team, Documents, Tasks, Activity

---

# Stage 4 · Contract rules on every project

**Goal** — the contractual clock, per job. **This is the most important
configuration in the system.** Get it wrong and every deadline is wrong.

### Do

For each project, `Contract Rules`. Use different numbers on purpose — a single
value everywhere proves nothing.

| Field | DXB-001 | DXB-002 | AUH-003 | DXB-004 |
|---|---|---|---|---|
| Notice period (days) | 28 | **14** | 28 | 21 |
| Detailed claim period | 42 | 28 | 42 | 42 |
| Client response days | 14 | 14 | 21 | 14 |
| Follow-up interval | 7 | 7 | 7 | 7 |
| Chase the client | On | On | On | **Off** |
| Retention % | 5 | 5 | **10** | 5 |
| Payment terms (days) | 30 | 30 | 45 | 30 |

Leave the notice recipient blank for now — Stage 6 fills it.

### Pass when

- [ ] Each project keeps its own numbers
- [ ] DXB-002 shows a 14-day notice period

---

# Stage 5 · Teams

**Goal** — who is on which job, and with what authority.

| Project | Members |
|---|---|
| DXB-001 | Abdelmoneim (Project Manager) · Ahmed (Site Engineer) · Osman (Quantity Surveyor) |
| DXB-002 | Abdelmoneim (Project Manager) · Ahmed (Site Engineer) · Osman (Quantity Surveyor) |
| AUH-003 | Hashim (Project Manager) · Hassan (Site Engineer) · Osman (Quantity Surveyor) |
| DXB-004 | Hashim (Project Manager) · Hassan (Site Engineer) · Osman (Quantity Surveyor) |

**Do not add Mohammed (MD) to any project.** He is company-wide and must reach
everything without being a member of anything. That is a test in itself.

### Pass when

- [ ] Ahmed is on DXB-001 and DXB-002 only
- [ ] Hassan is on AUH-003 and DXB-004 only
- [ ] Mohammed is on no project

---

# Stage 6 · Client contacts and notice recipients

**Goal** — where a notice actually goes.

### Do

**A.** On each project, `Contacts` → `Add contact`. Add the contact **on each
project separately** — a contact belongs to one job.

| Projects | Name | Email | Type | Authority |
|---|---|---|---|---|
| DXB-001, DXB-002 | Mohammed Hassan | `mo@mohammedosman.studio` | Client | Request change · Approve cost |
| AUH-003, DXB-004 | Mohammed Yasseen | `mohammed@osmansidahmed.com` | Client | Request change · Approve cost |

**B.** Back in `Contract Rules` on each project, set the **notice recipient**
name, email and company to the matching client.

> Two different places on purpose. The contact list is who you deal with; the
> notice recipient is the contractual address for service, and on a real
> contract those are often not the same person.

### Pass when

- [ ] Each project lists exactly one client contact
- [ ] Each project's contract rules name that client as the notice recipient

---

# Stage 7 · Who sees what

**Goal** — prove the menu and the pages agree.

### Do

Sign in as each person and look at the sidebar.

| Signed in as | Should see |
|---|---|
| Aryia (Owner) | All nine items |
| Mohammed (MD) | All except **Capture Inbox** |
| Abdelmoneim (PM) | Overview · My Tasks · Variations · Held Up · **Projects** |
| Ahmed (SE) | Overview · My Tasks · Variations · Held Up — **four only** |
| Osman (QS) | Overview · My Tasks · Variations · Held Up — **four only** |

Then, still signed in as **Ahmed**, type these into the browser bar directly:
`/settings/permissions`, `/settings/users`, `/inbox`.

### Pass when

- [ ] Each person sees exactly the rows above
- [ ] Ahmed is refused all three pages, with a page that explains rather than a crash

> Hiding a link is not the enforcement. If any of those three opened for Ahmed,
> stop and report it.

---

# Stage 8 · Give the handset to Site Engineer 1

**Goal** — the number belongs to Ahmed.

### Do

As Aryia: `Users` → Ahmed → **Add WhatsApp number** → the number → Save.

### Pass when

- [ ] The message says reports from that handset are now filed as Ahmed
- [ ] Nobody else shows a number

---

# Stage 9 · The capture conversation

**Goal** — the heart of the product. One message becomes a tracked contractual
record without anybody opening the app.

### Do

From the handset, send to the company WhatsApp number, **one message at a
time**, waiting for each reply:

| # | You send |
|---|---|
| 1 | `I want to report a variation` |
| 2 | `dxb 2` |
| 3 | `consultant wants the reception ceiling 300mm lower` |
| 4 | `no` |
| 5 | `last monday` |
| 6 | `the consultant` |
| 7 | `1` |
| 8 | `OK` |

### Expect at each step

| Step | What must happen |
|---|---|
| 1 | It asks **which project** and nothing else, listing your two, numbered. It must **not** file "I want to report a variation" as the change. |
| 2 | `dxb 2` resolves to DXB-002. It then asks **what happened** — one question. |
| 3 | It asks whether the work has started. One question per message, always. |
| 4 | `no` is read as "not started". It does **not** ask which project again. |
| 5 | `last monday` becomes a real calendar date. |
| 6 | It may **skip** this — it can read "consultant" out of step 3. That is correct, not a miss. |
| 7 | A numbered list of seven routes. `1` is Verbal on site. Words work too. |
| 8 | A summary: Project, Change, Happened, Work, Asked by, Came by. Then a PC number and a notice due date. |

### Pass when

- [ ] Never two questions in one message
- [ ] "Which project?" is asked **once**
- [ ] No `[XXXX]` reference codes appear anywhere in the WhatsApp text
- [ ] The date shown is the real Monday, not today
- [ ] The final message gives `PC-DXB-002-0001` and a notice due date **14 days** after the event
- [ ] **No email arrives at Ahmed's address for any of these questions**

> That last one matters. A conversation stays on the channel it started on.
> If the same questions also arrived by email, stop and report it.

---

# Stage 10 · Correct something before it is filed

**Goal** — the read-back is real, not decoration.

### Do

Send a second report and, at the summary, reply with a correction instead of
`OK`:

| # | You send |
|---|---|
| 1 | `landlord closed the loading bay so we cannot get the joinery in` |
| 2 | `dxb 1` |
| 3 | *answer the questions* |
| 4 | at the summary: `no it was the 2nd of september not yesterday` |

### Pass when

- [ ] The correction is **not** filed as a separate change
- [ ] It reads back again with the corrected date
- [ ] Only after `OK` does a PC number appear

---

# Stage 11 · What the capture actually produced

**Goal** — the record matches the conversation.

Sign in as Abdelmoneim and open `Variations` → the new change.

### Pass when

- [ ] **Reported by** Ahmed
- [ ] **Asked by** Consultant
- [ ] **Event date** the Monday you named, not the day you sent it
- [ ] **Notice due** = event date + 14 days, with a live countdown and a colour
- [ ] The description is **your exact words**, not a tidied version
- [ ] The Activity tab shows the capture with a timestamp

---

# Stage 12 · Who was told, and how

**Goal** — the right people, on the right channel, immediately.

### Pass when

- [ ] **Abdelmoneim** (PM) has an email: a notice assessment is needed
- [ ] **Mohammed** (MD) has the same email — **even though he is on no project**
- [ ] Both have the task in `My Tasks`, with a due date
- [ ] The notification bell shows a count for both
- [ ] **Neither received a WhatsApp** about it
- [ ] Ahmed, who reported it, has **no** task

> The MD is a member of nothing. If he was not told, the company-wide lookup is
> broken, and that is the most important failure on this page.

---

# Stage 13 · Notice assessment

**Goal** — the decision, and that it clears for everybody.

Sign in as **Mohammed (MD)** — not the PM — and assess it: `Notice required`,
with a short reason.

### Pass when

- [ ] The status moves off `notice_assessment`
- [ ] **Abdelmoneim's task disappears too**, without him doing anything
- [ ] The change now shows a notice section

> Two people, one decision. Whoever acts first clears it for both.

---

# Stage 14 · Draft, approve and issue the notice

**Goal** — a formal document leaves the building.

### Do

1. As **Abdelmoneim**, open the notice draft and read the AI-written narrative
2. Edit a line of it, and save
3. Approve as the project manager seat
4. Sign in as **Mohammed**, approve as the managing director seat
5. Issue it

### Pass when

- [ ] The draft quotes the reporter's own words and reads like a letter
- [ ] Your edit survives into the issued PDF
- [ ] It takes **both** seats before it can be issued
- [ ] The PDF opens, is laid out properly, and is addressed to Mohammed Hassan
- [ ] The address used is the one from contract rules
- [ ] Delivery is recorded, and shows **pending** until the send is confirmed
- [ ] As **Aryia**, you can neither draft nor approve a notice

> An administrator sets the system up. A notice is a contractual act, served in
> the company's name, and the person who signs it must be the one who assessed
> it.

---

# Stage 15 · Pricing

**Goal** — a value built from line items, not typed in.

As **Osman (QS)**, price the change: labour, materials, plant, subcontract.
Then add preliminaries % and overhead & profit %.

### Pass when

- [ ] The total is calculated, not entered
- [ ] Changing one line changes the total
- [ ] The percentages apply to the whole build-up, not to single lines
- [ ] As Ahmed, you **cannot** price it

---

# Stage 16 · Approval gates

**Goal** — value cannot leave the building unapproved.

Submit the priced variation. Approve as PM, then as MD.

### Pass when

- [ ] The submitted value is **frozen** — reprice afterwards and the submitted figure does not move
- [ ] Approving as MD alone carries the money gate
- [ ] The activity trail names who approved, and when

---

# Stage 17 · Submission and chasing the client

**Goal** — the only thing the system sends to somebody outside the company.

Submit to the client. To test the chase without waiting two weeks, temporarily
set DXB-002's **client response days** to `0` and run the follow-up sweep.

### Pass when

- [ ] `mo@mohammedosman.studio` receives the submission
- [ ] A chase goes out **only after** the response period has passed
- [ ] It states facts and asks a question — no pressure, no threats
- [ ] Running the sweep twice in a day sends **once**
- [ ] Marking the client as having responded stops the chasing immediately
- [ ] DXB-004, where chasing is switched off, sends **nothing** ever

---

# Stage 18 · The money

**Goal** — from approved variation to cash.

Raise an application, then an invoice, record a part payment, then a credit
note.

### Pass when

- [ ] Retention is held at the project's own percentage — **10% on AUH-003**, 5% elsewhere
- [ ] The invoice due date follows the project's payment terms
- [ ] The commercial position updates: claimed, approved, invoiced, paid, retained, outstanding
- [ ] A credit note reduces the outstanding figure

---

# Stage 19 · Held Up

**Goal** — what is blocked, who owns it, and how much is waiting on it.

Leave one change untouched, or set its next-action date into the past, then
open `Held Up`.

### Pass when

- [ ] The stuck change is listed with an owner and a number of days
- [ ] The value waiting behind it is shown
- [ ] Acting on it removes it from the list

---

# Stage 20 · Correcting, cancelling, deleting

**Goal** — three different things, and only one of them destroys anything.

### Do

**A.** As **Ahmed**, correct the description on a change he reported. Then try
to edit one he did not report.

**B.** As **Abdelmoneim**, cancel a change with a reason. Then reinstate it.

**C.** As **Aryia**, delete a test change permanently.

### Pass when

- [ ] Ahmed can fix his own report and **not** somebody else's
- [ ] Cancelling closes the open tasks and keeps the record, the reason and the name
- [ ] Reinstating brings it back with its **original capture date**
- [ ] The red **Delete permanently** button shows for Aryia and Mohammed only — **never** for Abdelmoneim, Osman or Ahmed
- [ ] Deleting asks once, then removes it and returns you to the register
- [ ] Deleting a change whose notice has been **served** is refused
- [ ] The deletion appears in the activity trail, with who did it

---

# Stage 21 · Isolation — move the handset

**Goal** — the sharpest test in the plan. A person on one project cannot reach
another, by any route.

### Do

**A.** As Aryia: `Users` → **Hassan** → add the same WhatsApp number → Save

**B.** From the handset: `I want to report a change`

**C.** Sign in as **Ahmed** and paste the URL of an AUH-003 change directly

### Pass when

- [ ] The save message says the number was **taken from Ahmed**
- [ ] Ahmed's profile no longer shows a number
- [ ] The WhatsApp reply now offers **AUH-003 and DXB-004** — Hassan's projects — not Ahmed's
- [ ] The report is filed under **Hassan**
- [ ] Ahmed gets **403** on the AUH-003 change, not an empty page
- [ ] Ahmed's register never lists an AUH-003 or DXB-004 change

> If a search or a register anywhere shows Ahmed something from Hassan's
> projects, stop. That is the one failure this product cannot have.

---

# Stage 22 · Reports and the register

**Goal** — what a commercial manager looks at on a Monday morning.

Open `Overview` as Mohammed, then the per-project report from a project page.

### Pass when

- [ ] Overview totals match what you created — no more, no fewer
- [ ] Charts render and are readable
- [ ] The register filters by project, status, risk and search
- [ ] On a phone the register becomes cards, not a sideways-scrolling table
- [ ] The project report prints to PDF cleanly

---

## What to record

For each stage: **Pass / Fail**. If failed — what you did, what you expected,
what happened, and a screenshot of anything visual.

A stage that half-works is a **fail**. Note it and carry on; later stages still
tell you something.

## The commands, in one place

```bash
# Deploy the latest build
ssh root@187.127.210.248 'cd /docker/vo && git pull && ./deploy/release.sh'

# Empty everything (irreversible)
WIPE=yes npm run db:wipe

# Restore permissions + company + one owner account
npm run db:bootstrap -- --email you@company.com --name "Your Name" --company "Your Company"
```
