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
| **Noura Al Blooshi** — administrator | `noura.alblooshi@abcfitout.example` | none, and administers everything |
| **Khalid Al Suwaidi** — managing director | `khalid.alsuwaidi@abcfitout.example` | none, and **sees all four** |
| **Suresh Iyer** — quantity surveyor | `suresh.iyer@abcfitout.example` | all four, prices them |
| **Daniel Okafor** — project manager | `daniel.okafor@abcfitout.example` | DXB-001, AUH-003 |
| **Mariam Al Zaabi** — project manager | `mariam.alzaabi@abcfitout.example` | DXB-002, DXB-004 |
| **Ahmed Rashid** — site engineer | `ahmed.rashid@abcfitout.example` | DXB-001, DXB-004 |
| **Grace Mensah** — site engineer | `grace.mensah@abcfitout.example` | DXB-002, AUH-003 |

Four projects: **DXB-001** DIFC office · **DXB-002** Dubai Hills retail ·
**AUH-003** Al Maryah clinic · **DXB-004** Business Bay apartments.

> The MD being on **no** project is the point, not an oversight. He sees
> everything through a company-wide permission rather than a membership row,
> which is what section 3 checks.

---

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

Sign in as **Noura**.

- [ ] **2.1** **Settings → Company** exists and shows ABC Fit-Out.
- [ ] **2.2** Change the display name to `ABC Fit-Out LLC`, save. It changes in
      the sidebar. **Change it back.**
- [ ] **2.3** Timezone reads `Asia/Dubai`, working week Monday to Friday.
- [ ] **2.4** **Projects → New project**. Enter code `TST-001`, name
      `Acceptance Test Project`, client `Test Client Ltd`. Create.
- [ ] **2.5** You land on the new project's **Team** tab, not on a list.
- [ ] **2.6** Add **Ahmed** as **Site engineer**, and tick *"tell them when a
      change is raised here"*. He appears in the table marked **Notified**.
- [ ] **2.7** Add **Daniel** as **Project manager**, and leave the tick **off**.
      He appears marked **Not notified**.
- [ ] **2.8** Click **Not notified** next to Daniel. It flips to **Notified**.
      Click again — back to **Not notified**.
- [ ] **2.9** **Contacts** tab. Add `Sara Kelly`, company `Test Client Ltd`,
      phone `+971500000111`, tick **Can request a change** and nothing else.
- [ ] **2.10** Sara shows a **Request** badge and no others. She has *not*
      silently gained approval rights.

---

## 3 · Who can see what

This is the section that matters most. It is the rule the whole product rests
on, and the one that costs you a client if it is wrong.

- [ ] **3.1** Still as **Noura**, open a change on **AUH-003** and copy its web
      address.
- [ ] **3.2** Sign out. Sign in as **Ahmed** (DXB-001 and DXB-004 only).
- [ ] **3.3** Projects shows **DXB-001, DXB-004 and TST-001** — three, not five.
- [ ] **3.4** Paste the AUH-003 address. You get **not found**, not the change.
- [ ] **3.5** Report a change. The project picker offers only his three.
- [ ] **3.6** Sign in as **Khalid** (MD, member of nothing). Projects shows
      **all** of them.
- [ ] **3.7** As Khalid, open a change on **DXB-002** — it opens, without him
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
- [ ] **5.2** Sign in as **Daniel** (PM on DXB-001). Open the same change. He can
      move it forward.
- [ ] **5.3** Sign in as **Suresh** (QS). He can open it and reach the pricing
      fields; he **cannot** approve it.
- [ ] **5.4** Sign in as **Khalid** (MD). He can approve.

> The rule underneath: whoever prices is not whoever approves, and neither is
> whoever captured it. That separation is what makes the file defensible when
> the client's QS challenges it.

---

## 6 · Permissions are yours, not mine

Sign in as **Noura**.

- [ ] **6.1** **Settings → Permissions**. Roles down the side, capabilities
      across the top.
- [ ] **6.2** Find **Site Engineer** under *Project roles*. **Raise a change** is
      ticked. Click it — it goes off.
- [ ] **6.3** In another browser, sign in as **Ahmed**. The Report Change button
      is gone. *(Give it up to 15 seconds.)*
- [ ] **6.4** As Noura, tick it back on. Ahmed can file again.
- [ ] **6.5** **Client Viewer** and **Consultant Viewer** show padlocks and
      cannot be clicked. They are people on the other side of a dispute.
- [ ] **6.6** **Settings → Users** has an **Administers** column, and Noura is
      the only one with it.
- [ ] **6.7** Try to remove Noura's own administration. It **refuses** — a
      company with no administrator cannot recover without me.

---

## 7 · Deactivating

- [ ] **7.1** As **Noura**, Settings → Users, deactivate **Grace**.
- [ ] **7.2** Try to sign in as Grace. You **cannot**.
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

So you are not hunting for things that do not exist:

| | |
|---|---|
| **Document register** | No upload panel yet. The Documents tab is read-only, and revisions do not supersede. |
| **Document intelligence** | Nothing reads a PDF. No drawing versions, no "not in scope" detection, no document search. |
| **QS pricing** | `estimatedValue` only. No rates, no build-up, no valuation record. |
| **WhatsApp and email capture** | The app's five receiving routes exist and are tested. **No n8n workflow calls them.** |
| **Notifications** | The notify flag is recorded and nothing sends yet. |
| **Bottleneck detection** | The logic is written and **nothing schedules it**. What you see is seed data. |

---

## When you finish

**All of 1 to 8 pass** → tell me and I start the document register: Document
Controller uploads, revision chains that supersede, then extraction and
embedding, then the scope check, then QS pricing.

**Anything failed** → tell me the number and what you saw. Include the project
code and the person you were signed in as; both change what the answer is.

**Then delete `TST-001`** — or leave it and tell me, and I will.
