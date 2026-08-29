# API Specification

Two families, with different authentication.

| Family | Auth | Caller |
|---|---|---|
| `/api/integrations/*` | HMAC-SHA256 | n8n |
| everything else | Supabase session cookie | the browser |

Errors are uniform:

```json
{ "error": { "code": "FORBIDDEN", "message": "…", "details": {} } }
```

| Status | Meaning | n8n behaviour |
|---|---|---|
| 400 | Malformed payload | Do not retry |
| 401 | Bad or missing signature / not signed in | Do not retry |
| 403 | No access to that project | Do not retry |
| 404 | Not found | Do not retry |
| 409 | Conflict | Do not retry |
| 429 | Rate limited | Back off |
| 5xx | Our fault | **Retry** |

The 4xx/5xx split is operational. Returning 500 for a bad payload would have a
courier retry a body that can never succeed, forever.

**A signed-out `/api/*` call gets the 401 above, never a redirect to `/login`.**
Application *pages* redirect, because a browser wants the login screen; API
routes must not, because a redirected `fetch` receives login HTML with status
200 — `res.ok` is true and `res.json()` then fails on `<!DOCTYPE`, turning an
expired session into a parse error. The split lives in `src/middleware.ts` and
is covered by `tests/unit/middleware.test.ts`.

---

## Integration routes

Every request needs both headers:

```text
x-vo-timestamp:  epoch milliseconds
x-vo-signature:  hex HMAC-SHA256 of `${timestamp}.${rawBody}` with N8N_WEBHOOK_SECRET
```

The signature covers the **raw** body. Parse-and-re-serialise changes the bytes
and fails. Requests more than 5 minutes out of step are rejected.

Every payload carries `idempotency_key`. It is required. A retry returns the
**first** delivery's result with `duplicate: true` and HTTP 200.

### `POST /api/integrations/whatsapp/incoming-message`

```json
{
  "idempotency_key": "wamid.HBgLOTcxNTAxMjM0NTY3",
  "received_at": "2026-08-29T11:04:22Z",
  "sender": { "phone": "+971501234567", "display_name": "Ahmed Rashid" },
  "message": {
    "type": "text",
    "text": "Client wants marble on the reception wall instead of paint",
    "media": [{ "external_id": "m1", "mime_type": "image/jpeg" }]
  },
  "project_code": "DXB-001"
}
```

`project_code` is a **hint**. It can only narrow the sender's real memberships,
never widen them.

**Project identification.** One active project → use it. Several, or none, or an
unknown sender → parked for triage. It never guesses: a change filed against the
wrong project is worse than one in a queue, because it looks handled.

```json
201 { "duplicate": false, "event_id": "…",
      "result": { "kind": "created", "pcNumber": "PC-DXB-001-0021", … } }
200 { "duplicate": true,  "event_id": "…", "result": { … the first result … } }
201 { "result": { "kind": "needs_triage", "reason": "Ahmed is on 3 active projects" } }
```

### `POST /api/integrations/email/incoming-email`

Same shape. `idempotency_key` is the RFC message id; sender is `from.address`.

### `POST /api/integrations/documents/uploaded`

Registers **metadata**. Bytes stay where they are — copying every watched file
would duplicate the client's document control and immediately drift from it.

```json
{ "idempotency_key": "file-abc", "project_code": "DXB-001",
  "document_name": "Ceiling RCP Rev C.pdf", "document_type": "drawing",
  "document_number": "AR-201", "revision_number": "C",
  "source_url": "https://…", "external_file_id": "1AbC…" }
```

### `POST /api/integrations/notifications/delivery-status`

**The only thing that may mark a notification `sent`.**

```json
{ "idempotency_key": "delivery-1",
  "notification_id": "3f2504e0-…", "status": "sent",
  "external_message_id": "<msg-id@server>", "failure_reason": null }
```

`sent` or `delivered` without `external_message_id` is **rejected**.

### `POST /api/integrations/n8n/health-check`

Signed, so it is not a free liveness probe for anyone scanning. Returns
`client_slug`, database reachability and the storage provider.

---

## Application routes

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects` | `?q=` search |
| GET/PATCH | `/api/projects/[id]` | |
| GET/POST | `/api/projects/[id]/members` | Project id from the **URL**, never the body |
| GET/POST | `/api/projects/[id]/contacts` | |
| GET/PATCH | `/api/projects/[id]/contract-rules` | PATCH needs `project.manageContractRules`, not merely project access. Every field change is audited with its before and after value. Not retroactive: deadlines already calculated on existing changes do not move |
| GET/POST | `/api/potential-changes` | Filters: `projectId, status, riskLevel, ownerUserId, trade, q, noticeDueWithinDays` |
| GET/PATCH | `/api/potential-changes/[id]` | Editing `eventDate` recalculates the notice deadline |
| POST | `/api/potential-changes/[id]/notice-assessment` | `{ outcome, notes }`. Needs `potentialChange.assessNotice` |
| GET | `/api/potential-changes/[id]/similar` | Suggestions, scoped to that project |
| GET/POST | `/api/tasks`, PATCH `/api/tasks/[id]` | |
| GET | `/api/bottlenecks` | |
| GET | `/api/dashboard/overview` | |
| GET | `/api/documents/[id]/content` | Access checked, **then** bytes streamed |

The project id always comes from the URL. Taking it from the body would let a
caller grant themselves membership of a project they cannot see.

## Phase 2

Outbound webhooks the app will call — all blank in Phase 1, so nothing fires:

```text
N8N_NOTIFY_EMAIL_URL      N8N_DOCUMENT_MOVE_URL
N8N_NOTIFY_WHATSAPP_URL   N8N_REPORT_DELIVERY_URL
```

Signed with `signOutboundRequest()`. A 200 means a courier accepted the parcel —
nothing more.
