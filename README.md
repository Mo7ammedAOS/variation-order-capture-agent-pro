# VO Capture & Control

**Variation Notice, Capture, Approval & Bottleneck-Control System
for UAE Fit-Out and Interior Contracting Companies**

Captures, protects, prices, approves, invoices, and collects Variation Orders,
Change Orders, Notices of Claim, and project changes.

> **Read [CLAUDE.md](CLAUDE.md) before writing any code.** It is the contract:
> ownership boundaries, the deployment model, the n8n rules, and the Definition
> of Done. Nothing here overrides it.

## Status

**Phase 1 code complete.** Lint, typecheck, 51 unit tests and the production
build all pass. Nothing has run against a database yet — that needs the Supabase
and Google Drive credentials in DEPLOYMENT_GUIDE.md.

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the goal-by-goal
and test-by-test position.

## Documentation

| File | Read it for |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The contract. Ownership boundaries, deployment model, n8n rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the app owns truth and n8n does not |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Tables, and why three exist that the spec never listed |
| [API_SPEC.md](API_SPEC.md) | Both API families, payloads, the 4xx/5xx contract |
| [UI_SPEC.md](UI_SPEC.md) | Who holds the device, and what follows from that |
| [SECURITY.md](SECURITY.md) | Auth, authorisation, the integration boundary, limitations |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Supabase, Drive, VPS, Caddy, verification |
| [N8N_WORKFLOW_MAP.md](N8N_WORKFLOW_MAP.md) | The eight lanes and the one-file-per-client rule |

## Quick start

```bash
npm install
cp .env.example .env          # fill in Supabase; STORAGE_PROVIDER=local to skip Drive
npm run db:migrate
npx prisma db execute --file prisma/sql/001_vector.sql --schema prisma/schema.prisma
npx prisma db execute --file prisma/sql/002_rls.sql   --schema prisma/schema.prisma
npm run db:seed
npm run dev
```

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
