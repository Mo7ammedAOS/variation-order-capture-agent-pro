# n8n Workflow Map

## Where this stands, 2026-09-01

`n8n-workflows/master.json` exists: **44 nodes, 10 sticky notes, seven lanes,
validated against the live instance** (0 errors, 0 warnings, 64 expressions
checked). It has not been imported, bound to a credential, or activated.

Phase 1 built the contract — five inbound routes, HMAC-verified and idempotent.
This file is the courier that finally uses them.

### The clock moved out of the app

The reminder sweep used to run on a `setInterval` inside the web container. It
worked and it was invisible: you could not see whether it had run, pause it for
a day, or tell a missed deploy from a broken sweep.

`POST /api/integrations/n8n/run-job` now accepts three job names, and lane S
holds the schedules. **What did not move is deciding who is owed what** — the
escalation ladder and the dedupe key stay in `reminder.service.ts`, where they
are tested. Expressed as n8n nodes they would be a diagram nobody can run twice
safely, and a retried execution would chase the same project manager again.

Set `ENABLE_SCHEDULER=false` on the app the moment lane S is active. Both
running is harmless — the dedupe key absorbs it — but two clocks with one
owner is a thing nobody remembers a year later.

### Lanes F and G are deliberately absent

Client follow-up and the weekly report both need an app endpoint that does not
exist yet. F chases a client for a response to a notice, and the app cannot yet
issue a notice. Building them now would put nodes wired to URLs that 404 into
the file — passing validation, looking finished, failing the first day anyone
relied on them.

## Packaging: one all-in-one JSON per client

```text
n8n-workflows/
├── master.json        ← the template. CLIENT_SLUG=MASTER
└── abc-fitout.json    ← a deployment. Copy of master, credentials rebound
```

One file, one import, one workflow, all eight lanes inside it — the same shape
as the SRS-AIO workflows. Node names carry the lane letter (`A: Webhook`,
`C: Download Media`, `F: Send Email`) so a failure message names the lane before
anything has to be opened.

**Trade-off, stated:** activation is all-or-nothing and the execution list mixes
lanes. Mitigated by the lane prefixes and lane-aware error routing in H.
Accepted because one file per client is the point — duplicating a deployment is
one import and one credential rebind, not eight.

## Lanes

| Lane | Direction | Trigger | Calls |
|---|---|---|---|
| **A** capture | in | WhatsApp webhook | `POST /api/integrations/whatsapp/incoming-message` |
| **B** capture | in | Email (IMAP / Graph) | `POST /api/integrations/email/incoming-email` |
| **C** document | in | Drive / SharePoint watch | `POST /api/integrations/documents/uploaded` |
| **D** notify | out | App request | Sends email → reports back |
| **E** notify | out | App request | Sends WhatsApp → reports back |
| **F** notify | out | App request | Client follow-up |
| **G** report | out | Schedule | Weekly report delivery |
| **H** error | — | Error trigger over A–G | Alerts, routed by lane letter |

D–G all report to `POST /api/integrations/notifications/delivery-status`. That
callback is the **only** thing that may mark a notification `sent`.

**Lane D also carries notices, and that raises the stakes on the callback.**
A message with `kind: notice_issued` is addressed to the CLIENT, not to a
colleague, and its `external_message_id` becomes the app's proof of service —
the thing produced months later when somebody disputes that the notice was
given. So lane D must return the real provider message id, never a generated
one, and must report a failure as a failure. A lane that fabricates an id to
make the callback tidy would be manufacturing evidence. Until the id arrives
the notice stays `issued`, the bottleneck sweep raises
`notice_drafted_not_sent`, and somebody is chased. That is the correct
behaviour, not a bug to smooth over.

### Lane B carries the attachments

The Gmail trigger downloads them (`options.downloadAttachments`), and B2
forwards each one base64 encoded in the `attachments[]` array. They become
evidence on the Potential Change, filed into its Drive `Evidence` folder.

Two details that are not optional:

**B2 reads bytes with `this.helpers.getBinaryDataBuffer(i, key)`, never off
`binary[key].data`.** This instance runs `binaryMode: separate`, so `.data` is
absent — the naive read produces an empty file and no error at all, which is
the worst possible way to lose a site photograph.

**B2 spends a 20 MB base64 budget per email and NAMES what it dropped** in the
body text it forwards. The app refuses a captured message over 32 MB outright,
so a silent overflow would bounce the whole email; a named omission at least
tells the reviewer a file existed.

### Lane D replies on the thread

`D3a · Is a Reply?` splits on `reply_to_message_id` in the app's payload:

| It carries | Node | Result |
|---|---|---|
| `gmail:<id>` | `D4b · Reply On Thread` | Gmail `message: reply` on that thread |
| nothing | `D4 · Send Email` | a fresh mail, as before |

The app sets it only when it is answering a captured email — "which project did
you mean?", "this is DXB-001, correct?". A question that arrives detached from
the mail that provoked it reads as noise from the system, people stop opening
it, and capture dies quietly. Both nodes report through the same D7/D6 pair, so
the delivery contract below is unchanged.

## Sticky notes are structural

1. **Header** — client name, slug, app base URL, which credentials this copy
   binds, and the duplication checklist.
2. **One per lane** — purpose, trigger, endpoint, where the idempotency key
   comes from, and what the lane must never do.
3. **Inline warnings** at the three things that break on import: credential
   rebinding, webhook path regeneration, base URL.

Colours are read from the live `stickyNote` schema at build time, not from
memory.

## What every lane must do

```text
Carry an idempotency key    WhatsApp message id, RFC message id, file id
Carry the attachments       base64; the app files them as evidence
Sign every request          HMAC over the raw body, timestamp within 5 min
Report delivery back        a 200 from us is not "delivered"
Never write to Postgres     the app validates, decides and audits
Never decide anything       no entitlement, no approval, no pricing, no status
```

## Per-client duplication checklist

```text
[ ] Copy master.json → <client-slug>.json
[ ] Header sticky: client name, slug, app base URL
[ ] Rebind every credential (ids do not survive an import)
[ ] Regenerate webhook paths (they are per-instance)
[ ] Set N8N_WEBHOOK_SECRET to that deployment's secret
[ ] Point every HTTP node at that client's app URL
[ ] Run lane H's health check before activating anything
[ ] Import DEACTIVATED. Activate only after the health check passes
```

## Live instance today

`https://n8n.osmanflow.com` — shared with unrelated SRS and Sales OS work,
several hundred workflows, mostly archived. It is the **development / master
template** instance, not a client deployment. Never bulk-edit, never activate
without asking.

**Re-enable the `n8n-multi-instance` skill the moment a second instance exists.**
With more than one, MCP reads misroute *silently* — in this product that is a
cross-client data leak.
