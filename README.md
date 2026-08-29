# VO Capture & Control

**Variation Notice, Capture, Approval & Bottleneck-Control System
for UAE Fit-Out and Interior Contracting Companies**

Captures, protects, prices, approves, invoices, and collects Variation Orders,
Change Orders, Notices of Claim, and project changes.

> **Read [CLAUDE.md](CLAUDE.md) before writing any code.** It is the contract:
> ownership boundaries, the deployment model, the n8n rules, and the Definition
> of Done. Nothing here overrides it.

## Status

**Scaffolded, not built.** Folder structure, documentation skeleton, and n8n
tooling are in place. No application code, no database schema, no workflows.

```text
✅  Folder structure
✅  28 workflow SOP stubs (all sections unspecified)
✅  n8n MCP servers wired and instance verified reachable
✅  n8n skills pack installed
✅  .gitignore and .env.example
✅  ADR 0001 — background job engine (PROPOSED)
⬜  Next.js application
⬜  Prisma schema
⬜  Any n8n workflow
```

## Architecture in one line

```text
The custom application owns the truth.
n8n moves information between external systems.
AI understands, extracts, summarises, and drafts.
Humans approve commercial and contractual actions.
```

## Layout

```text
CLAUDE.md            The contract. Read first.
workflows/           28 business SOPs. Source of truth for behaviour.
src/                 The custom application. Owns commercial truth.
n8n-workflows/       Committed n8n exports. Integration only.
prisma/              Database schema and migrations.
docs/decisions/      Architecture decision records.
.claude/skills/      n8n skills pack (18 skills).
.mcp.json            MCP servers. Placeholders only, never secrets.
.env.example         Every variable the app needs.
```

## Getting started

```bash
cp .env.example .env    # then fill it in. Never commit .env.
```

The application itself is not scaffolded yet. See CLAUDE.md for the stack and the
implementation order.

## Deployment model

This is **not** multi-tenant SaaS. Each fit-out company gets a separate installation
with its own database, storage, n8n workspace, credentials, users, and branding.
Client A and Client B share nothing. This repository is the reusable master template.

## Security

```text
This repository must stay PRIVATE.
Client contracts, BOQs, pricing, and correspondence never enter source control.
Secrets live in .env or a secret manager. Never in a commit, never in .mcp.json.
```
