# n8n Integration — outbound only

The app's client for asking n8n to perform an external action.

```text
The app decides.        n8n delivers.
The app records truth.  n8n reports a delivery result.
```

Every call from here:

```text
Presents N8N_OUTBOUND_SECRET.
Carries an idempotency key.
Records the request BEFORE sending, so a lost response is recoverable.
Treats a failure as a delivery failure, never as a business-state change.
```

Never mark a notice sent, an email delivered, a client notified, an approval complete,
or an invoice issued because a call from here returned 200. Those states change only
when n8n reports back through /api/integrations/notifications/delivery-status.

Inbound n8n traffic does NOT arrive here — it arrives at /src/app/api/integrations/.
