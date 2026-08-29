# n8n Workflow Exports

Committed JSON exports of every n8n workflow this product depends on.

**This directory is the source of truth for workflow definitions, not the n8n
instance.** The instance is where they run; this is where they are versioned.

## Nothing is here yet

No workflows have been built. The files named in CLAUDE.md are the *planned* set:

```text
whatsapp-capture.json
email-capture.json
document-upload.json
whatsapp-notification.json
email-notification.json
client-followup.json
weekly-report-delivery.json
integration-error-alert.json
```

Placeholder files are deliberately **not** created. An empty or fabricated JSON
export is worse than an absent one — it looks importable and is not.

## Export procedure

1. Build and verify the workflow on the instance (see the Build Checklist in CLAUDE.md).
2. Export it — `n8n_get_workflow` with `mode: "full"`, or Download from the n8n UI.
3. **Scrub it.** See below. This is not optional.
4. Save as `<lane>-<name>.json` in this directory.
5. Commit alongside the `/workflows/*.md` SOP change that motivated it.

## Scrubbing rules

Before any export is committed, remove or blank:

```text
credentials[].id and credentials[].name   → the receiving instance rebinds these
webhookId                                  → regenerated per instance
Any hardcoded URL containing a client domain
Any hardcoded email address, phone number, or WhatsApp ID
Any token, key, or bearer string in a parameter
pinData                                    → may contain real client message content
Any node notes containing client names or commercial values
```

A committed export must be importable into a fresh client instance and reveal
nothing about any other client.

## Per-client deployment

These exports are the **master template**. Deploying for a client means importing
them into that client's own n8n workspace and binding that client's own credentials.
Client instances are never edited from this repository's tooling by default —
see the multi-instance warning in CLAUDE.md.
