# n8n Workflow Exports

Committed exports of the n8n workflow this product depends on.

**This directory is the source of truth for workflow definitions, not the n8n
instance.** The instance is where they run; this is where they are versioned.

## Nothing is here yet

Phase 1 built the *contract* — the five inbound routes — and no workflow. See
`N8N_WORKFLOW_MAP.md`.

Placeholder JSON is deliberately **not** created. An empty or fabricated export
looks importable and is not, which is worse than an absent one.

## Packaging: one file per client

```text
n8n-workflows/
├── master.json        ← the template. CLIENT_SLUG=MASTER
└── abc-fitout.json    ← a deployment. Copy of master, credentials rebound
```

One file, one import, one workflow, all eight lanes (A–H) inside it, separated
by sticky notes. Node names carry the lane letter: `A: Webhook`,
`C: Download Media`, `F: Send Email`.

## Export procedure

1. Build and verify on the instance (Build Checklist in CLAUDE.md).
2. Export — `n8n_get_workflow` with `mode: "full"`, or Download in the UI.
3. **Scrub it.** Not optional. See below.
4. Save as `<client-slug>.json`.
5. Commit alongside the `/workflows/*.md` SOP change that motivated it.

## Scrubbing rules

Before any export is committed, remove or blank:

```text
credentials[].id and credentials[].name   → the receiving instance rebinds these
webhookId                                  → regenerated per instance
Any hardcoded URL containing a client domain
Any hardcoded email address, phone number, or WhatsApp ID
Any token, key, or bearer string in a parameter
pinData                                    → may contain real client messages
Any node notes containing client names or commercial values
```

A committed export must import into a fresh client instance and reveal nothing
about any other client.

## Per-client deployment

`master.json` is the template. Deploying for a client means copying it, working
the duplication checklist in `N8N_WORKFLOW_MAP.md`, and importing it
**deactivated** into that client's own n8n workspace.
