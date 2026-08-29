# n8n Workflow Map

## Phase 1: nothing runs on n8n

```text
Workflows created ......... 0
Credentials touched ....... 0
Activations ............... 0
Runtime calls from the app  0
```

Every n8n variable in `.env` is blank and the app still runs, migrates, seeds,
tests and builds. That is the spec's own rule: *"Do not use n8n for Phase 1 core
logic."*

What Phase 1 built is the **contract** — the five inbound routes (HMAC-verified,
idempotent, tested against mock payloads) and an outbound client wired to blank
URLs. `n8n-workflows/` holds no fabricated JSON: an export that looks importable
and is not is worse than none.

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
