# /api/integrations/*

The **only** surface n8n is allowed to write through. n8n never touches the database.

```text
POST /api/integrations/whatsapp/incoming-message
POST /api/integrations/email/incoming-email
POST /api/integrations/documents/uploaded
POST /api/integrations/notifications/delivery-status
```

Every route here must, in this order:

```text
1. Verify the shared secret (N8N_WEBHOOK_SECRET). Reject without it. 401.
2. Require an idempotency key — WhatsApp message ID, email message ID, document ID,
   webhook event ID. A retried webhook must NEVER create a second Potential Change.
3. Validate the payload with Zod. Reject unknown shapes. 400.
4. Resolve the sender to a user, and the user to a project. Never guess a project —
   an unclear project goes to the Unassigned Capture Inbox.
5. Call the owning service, which enforces permissions and writes the audit event.
6. Return a result n8n can act on.
```

Response codes follow the error-handling rules in CLAUDE.md: 4xx for a caller fault
that retrying will not fix, 5xx for our fault, which n8n should retry.
