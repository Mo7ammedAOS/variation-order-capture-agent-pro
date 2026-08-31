# Acceptance Test — Phase 1

`https://vo.osmanflow.com` · every account's password is `ChangeMe!2026`

Work top to bottom. **Each test says what should happen. If it does, tick it. If
it does not, stop and write down what you saw** — a test that "sort of worked"
is a failure, because the thing it was checking is the thing a client will
argue about later.

Roughly 40 minutes. Sections 1 to 8 are the ones that must pass before the next
stage of the build. Section 9 lists what is deliberately not built yet, so you
do not waste time hunting for it.

---

## The cast

| Who | Email | On which projects |
|---|---|---|
| **Mohammed** — managing director, and administrator | `mohammed@osmanflow.com` | none, and **sees all four**; also adds people and permissions |
| **Osman** — quantity surveyor | `guided369@gmail.com` | all four, prices them |
| **Abdelmoneim** — project manager | `osman.constructionsystems@hotmail.com` | DXB-001, AUH-003 |
| **Hashim** — project manager | `mohammedosman2400@outlook.com` | DXB-002, DXB-004 |
| **Ahmed** — site engineer | `org3700@gmail.com` | DXB-001, DXB-002, DXB-004 — **three**, on purpose |
| **Hassan** — site engineer | `mohammedossidahmed@gmail.com` | DXB-002, AUH-003 |

These are real inboxes, so every message the system sends can actually be read.
An email to `khalid@abcfitout.example` proved nothing.

**Ahmed is on three projects deliberately.** Two would be too easy, four would
leave no project to prove a refusal with. Three lets you test both: he must be
refused AUH-003, and reporting without naming a job must make the system ask him
which of the three he meant.

⚠️ **Phone numbers are placeholders.** "Which project did you mean?" goes out on
email *and* WhatsApp. Until real numbers are set, only the email arrives.

## 1 · Sign in

- [ ] **1.1** Open the site on a laptop. Two panels: lavender on the left with
      *"Capture the change. Keep the entitlement."*, sign-in on the right.
- [ ] **1.2** Sign in as **Ahmed**. You land on Overview.
- [ ] **1.3** Sign out. Sign in with a **wrong password** — you get an error, and
      you are *not* let in.
- [ ] **1.4** Open the site on your **phone**. The lavender panel is gone and the
      password field is visible without scrolling.

---

## 2 · The administrator sets up a company

Sign in as **Mohammed**.

- [ ] **2.1** **Settings → Company** exists and shows ABC Fit-Out.
- [ ] **2.2** Change the display name to `ABC Fit-Out LLC`, save. It changes in
      the sidebar. **Change it back.**
- [ ] **2.3** Timezone reads `Asia/Dubai`, working week Monday to Friday.
- [ ] **2.4** **Projects → New project**. Enter code `TST-001`, name
      `Acceptance Test Project`, client `Test Client Ltd`. Create.
- [ ] **2.5** You land on the new project's **Team** tab, not on a list.
- [ ] **2.6** Add **Ahmed** as **Site engineer**, and tick *"tell them when a
      change is raised here"*. He appears in the table marked **Notified**.
- [ ] **2.7** Add **Abdelmoneim** as **Project manager**, and leave the tick **off**.
      He appears marked **Not notified**.
- [ ] **2.8** Click **Not notified** next to Abdelmoneim. It flips to **Notified**.
      Click again — back to **Not notified**.
- [ ] **2.9** **Contacts** tab. Add `Sara Kelly`, company `Test Client Ltd`,
      phone `+971500000111`, tick **Can request a change** and nothing else.
- [ ] **2.10** Sara shows a **Request** badge and no others. She has *not*
      silently gained approval rights.

---

## 3 · Who can see what

This is the section that matters most. It is the rule the whole product rests
on, and the one that costs you a client if it is wrong.

- [ ] **3.1** Still as **Mohammed**, open a change on **AUH-003** and copy its web
      address.
- [ ] **3.2** Sign out. Sign in as **Ahmed** (DXB-001 and DXB-004 only).
- [ ] **3.3** Projects shows **DXB-001, DXB-004 and TST-001** — three, not five.
- [ ] **3.4** Paste the AUH-003 address. You get **not found**, not the change.
- [ ] **3.5** Report a change. The project picker offers only his three.
- [ ] **3.6** Sign in as **Mohammed** (MD, member of nothing). Projects shows
      **all** of them.
- [ ] **3.7** As Mohammed, open a change on **DXB-002** — it opens, without him
      ever having been added to it.

> **3.4 is the one to be strictest about.** If Ahmed sees that page, stop
> testing and tell me. Nothing else in the app matters if this leaks.

---

## 4 · Capture, which is the product

Sign in as **Ahmed**.

- [ ] **4.1** **Report Change** on DXB-001. Fill *what changed*, *describe it*,
      *where on site*.
- [ ] **4.2** Set *How did this come to you?* to **WhatsApp**. Two more fields
      appear — where, and when you were told.
- [ ] **4.3** **Attach a real photo from your phone.** File it.
- [ ] **4.4** A `PC-DXB-001-00NN` appears with an owner, a next action, a notice
      deadline and a countdown.
- [ ] **4.5** **No amber warning about evidence.** If you see one, the photo did
      not reach storage — tell me.
- [ ] **4.6** The photo is listed. Click it — it opens. *(This proves it went to
      Google Drive and came back through the access check.)*
- [ ] **4.7** Set the *when did it happen* date to **two months ago** on a new
      change. The notice deadline moves back with it, and the risk chip turns
      **red**.

> 4.7 is the commercial heart of it: the clock runs from when it happened, not
> from when someone wrote it up.

---

## 5 · The chain of authority

- [ ] **5.1** As **Ahmed**, open his own change. There is **no** button to assess
      the notice. He captures; he does not decide.
- [ ] **5.2** Sign in as **Abdelmoneim** (PM on DXB-001). Open the same change. He can
      move it forward.
- [ ] **5.3** Sign in as **Osman** (QS). He can open it and reach the pricing
      fields; he **cannot** approve it.
- [ ] **5.4** Sign in as **Mohammed** (MD). He can approve.

> The rule underneath: whoever prices is not whoever approves, and neither is
> whoever captured it. That separation is what makes the file defensible when
> the client's QS challenges it.

---

## 6 · Permissions are yours, not mine

Sign in as **Mohammed**.

- [ ] **6.1** **Settings → Permissions**. Roles down the side, capabilities
      across the top.
- [ ] **6.2** Find **Site Engineer** under *Project roles*. **Raise a change** is
      ticked. Click it — it goes off.
- [ ] **6.3** In another browser, sign in as **Ahmed**. The Report Change button
      is gone. *(Give it up to 15 seconds.)*
- [ ] **6.4** As Mohammed, tick it back on. Ahmed can file again.
- [ ] **6.5** **Client Viewer** and **Consultant Viewer** show padlocks and
      cannot be clicked. They are people on the other side of a dispute.
- [ ] **6.6** **Settings → Users** has an **Administers** column, and Mohammed is
      the only one with it.
- [ ] **6.7** Try to remove Mohammed's own administration. It **refuses** — a
      company with no administrator cannot recover without me.

---

## 7 · Deactivating

- [ ] **7.1** As **Mohammed**, Settings → Users, deactivate **Hassan**.
- [ ] **7.2** Try to sign in as Hassan. You **cannot**.
- [ ] **7.3** Her name still appears on the changes she raised. History is not
      rewritten because someone left.
- [ ] **7.4** Reactivate her. She can sign in again.

---

## 8 · On a phone, on mobile data

Turn Wi-Fi **off**. This is how a site engineer actually uses it.

- [ ] **8.1** Sign in as Ahmed. Every page fits — **nothing scrolls sideways**.
- [ ] **8.2** The bottom bar has five items and the **Report Change** button
      floats above it.
- [ ] **8.3** File a change with a photo taken **just now**. It works.
- [ ] **8.4** Buttons are big enough to hit with a thumb, first time.

---

## 9 · Not built yet — do not test these

| | |
|---|---|
| **The notice itself** | Two approvals record "issue the notice" and **nothing leaves the building**. No letter, no client recipient, no record of what was served. The largest gap in the product. |
| **Variation orders, invoices, payments** | The lifecycle stops at `variation_approved`. No VO number, no billing, no *approved-but-unbilled* figure. |
| **Document register** | No upload panel. The Documents tab is read-only, and revisions do not supersede. |
| **Document intelligence** | Nothing reads a PDF. No drawing versions, no "not in scope" detection, no document search. |
| **AI** | A mock that matches keywords. No vision, no OCR, no real extraction. |

### Built since this plan was written — these ARE testable now

| | |
|---|---|
| **QS pricing** | Rates, prelims, overhead and profit, a real build-up, and "this is not a variation". Section 10. |
| **Bottleneck detection** | Now runs on a schedule from n8n. Its first real run found 3. |
| **Notifications** | The in-app bell works. Email and WhatsApp are recorded and wait on a mailbox decision. |
| **Capture inbox** | `/inbox`, for messages that could not be placed. Section 11. |
| **WhatsApp and email capture** | The n8n lanes exist and are built. Not activated. |

---

## 10 · The QS prices it

**As Osman**, open a change that has passed both approvals and reached pricing.

- [ ] Add a line with a **BOQ rate**, and a second with a **star rate**
- [ ] The star rate carries a warning; a BOQ rate does not
- [ ] Set prelims and overhead/profit, and check the total against your own sum
- [ ] Submit
- [ ] It reaches **Abdelmoneim** and **Mohammed** for final approval

Then, on a different change:

- [ ] Use **"This is not a variation"**, with a reason
- [ ] It ends as *Already in the contract*, and stops asking anyone anything

---

## 11 · The system asks who reported it

This is the one to test hardest, because it replaces a guess.

**As Ahmed** (on three projects), report a change **without naming a project** —
"client wants the reception wall moved 400mm".

- [ ] No Potential Change is created
- [ ] Ahmed receives **"Which project? [XXXX]"** listing his three, numbered
- [ ] It arrives by email (and WhatsApp, once real numbers are set)
- [ ] `/inbox` shows the message as *waiting for a reply*, not as a guess

Now reply:

- [ ] Reply **`2`** → the change is created on the second project listed
- [ ] It is recorded as **Ahmed's**, not the person who read the inbox
- [ ] The change carries **the original wording**, not the word "2"

Then the refusals that matter:

- [ ] Reply **"moving 2 sockets on level 2"** to a fresh question → treated as a
      **new report**, not as "project 2". Reading it as an answer would throw a
      real change away.
- [ ] Reply **`9`** → nothing happens; 9 is not on the list
- [ ] Answer the same question twice → **one** change, not two

---

## When you finish

**All of 1 to 8 pass** → tell me and I start the document register: Document
Controller uploads, revision chains that supersede, then extraction and
embedding, then the scope check, then QS pricing.

**Anything failed** → tell me the number and what you saw. Include the project
code and the person you were signed in as; both change what the answer is.

**Then delete `TST-001`** — or leave it and tell me, and I will.
