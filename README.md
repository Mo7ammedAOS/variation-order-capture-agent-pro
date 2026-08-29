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
✅  Folder structure (full WAT tree)
✅  28 workflow SOP stubs        W — all sections unspecified
✅  12 agent specs + prompts dir A — all sections unspecified
✅  14 service stubs             T
✅   8 worker stubs              T
✅  n8n integration API routes scaffolded
✅  n8n MCP servers wired, instance verified reachable
✅  n8n skills pack installed (18 skills)
✅  .gitignore, .env.example, prisma/schema.prisma (datasource only)
✅  ADR 0001 — background job engine (PROPOSED)
⬜  Next.js install and any application code
⬜  Any Prisma model
⬜  Any n8n workflow
⬜  Any prompt
```

## Architecture in one line

```text
The custom application owns the truth.
n8n moves information between external systems.
AI understands, extracts, summarises, and drafts.
Humans approve commercial and contractual actions.
```

## Layout

The repository is laid out as **WAT** — Workflows, Agents, Tools.

```text
CLAUDE.md            The contract. Read first.

W  workflows/        28 business SOPs. Source of truth for behaviour.
A  agents/           12 agent specs + prompts/. The AI reasoning layer.
T  src/              The custom application. Deterministic. Owns commercial truth.
   ├── app/api/integrations/   the ONLY surface n8n may write through
   ├── services/               14 — own the registers, enforce permissions
   ├── workers/                 8 — own commercial timing, not n8n's job
   └── integrations/claude/     the AI-provider abstraction

n8n-workflows/       Committed n8n exports. Integration only.
prisma/              Database schema and migrations.
docs/decisions/      Architecture decision records.
.claude/skills/      n8n skills pack (18 skills).
.mcp.json            MCP servers. Placeholders only, never secrets.
.env.example         Every variable the app needs.
```

**Every stub says "Not yet specified". That is a stop sign, not a gap to fill in.**
Ask before writing commercial logic that no SOP or agent spec describes.

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
