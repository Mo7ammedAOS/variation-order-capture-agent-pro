# n8n workflows

One file per client. `master.json` is the template; a client deployment is a
copy of it with the credentials, webhook paths and environment rebound.

```
n8n-workflows/
├── README.md
├── master.json        ← the template. Client slug MASTER
└── <client-slug>.json ← a deployment. Copy of master, rebound
```

## What is in master.json

44 nodes and 10 sticky notes. Validated against the live instance: 0 errors,
0 warnings, 37 connections, 64 expressions checked.

| Lane | Direction | Does | App endpoint |
|---|---|---|---|
| **A** | in | Evolution posts a WhatsApp message | `/api/integrations/whatsapp/incoming-message` |
| **B** | in | Gmail, unread in the VO mailbox | `/api/integrations/email/incoming-email` |
| **C** | in | A file lands in a project's Drive folder | `/api/integrations/documents/uploaded` |
| **D** | out | Sends an email, reports delivery back | `/api/integrations/notifications/delivery-status` |
| **E** | out | Sends a WhatsApp via Evolution, reports back | same |
| **S** | clock | The three schedules | `/api/integrations/n8n/run-job` |
| **H** | — | Error trigger, names the lane that failed | — |
| ~~F~~ | out | Client follow-up — **not built** | needs the notice, stage 5 |
| ~~G~~ | out | Weekly report — **not built** | needs the report, stage 6 |

Node names carry their lane letter, so a failed execution names the lane before
anything has to be opened. That is what makes one file per client bearable: the
execution list mixes eight lanes together, and lane H reads the letter back.

## Signing, and why the body is sent raw

Every call to the app carries `x-vo-timestamp` and `x-vo-signature`: an
HMAC-SHA256 over `timestamp.rawBody` — the exact bytes, not the object.

So every HTTP node sends **`contentType: raw`**, never `json`. On JSON body the
node re-serialises the object; key order or spacing can differ by one byte from
what was hashed, and every request then fails verification with an error about
the signature that says nothing about the cause. The Code node builds the
string, the Crypto node signs that string, the HTTP node sends that same string.

Lanes D and E do it in reverse — they recompute the HMAC over the raw body and
compare — so the app is the only thing that can make this workflow send a
message to anyone.

## No secret is in this file

Every secret is read from the n8n container's environment, never typed into a
node. **This repository is public**; a secret in a parameter is a published
secret.

```
VO_APP_URL                 https://vo.osmanflow.com
VO_WEBHOOK_SECRET          must equal the app's N8N_WEBHOOK_SECRET
VO_OUTBOUND_SECRET         must equal the app's N8N_OUTBOUND_SECRET
VO_EVOLUTION_URL           http://evolution-api:8080 over the shared Docker network
VO_EVOLUTION_INSTANCE      a VO-only instance — see the warning below
VO_EVOLUTION_API_KEY       Evolution's AUTHENTICATION_API_KEY
VO_DRIVE_ROOT_FOLDER_ID    the Drive folder lane C watches
```

⚠️ **Use a separate Evolution instance from the Sales OS outreach number.**
Cold outreach on Baileys carries a real ban risk and a ban is permanent. Sharing
one number means the day outreach gets it banned is the day the product stops
telling anyone their notice deadline is tomorrow.

## Duplication checklist — before this is a client's workflow

1. **Rebind every credential.** Gmail, Google Drive. Credentials do not travel
   with an export; the fields look filled and are not.
2. **Regenerate every webhook path.** Two clients sharing `vo/whatsapp` means
   one contractor's site photos land in another's register.
3. **Set the six environment variables** on the n8n container.
4. **Point Evolution's webhook** at lane A's production URL, `MESSAGES_UPSERT`
   only.
5. **Set the workflow as its own Error Workflow** in Settings, or lane H never
   fires.
6. **Import deactivated. Test each lane. Then activate.**

Activation is all-or-nothing — the cost of one file per client, accepted so that
duplicating a deployment is one import and one credential rebind, not eight.
