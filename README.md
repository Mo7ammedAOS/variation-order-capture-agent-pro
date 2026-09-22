# VO Capture & Control

**Variation notice, capture, approval and bottleneck control for UAE fit-out and
interior contractors.**

Captures, protects, prices, approves, invoices and collects variation orders,
change orders, notices of claim and project changes.

> **Read [CLAUDE.md](CLAUDE.md) before writing any code.** It is the contract:
> ownership boundaries, deployment model, n8n rules, Definition of Done.

## Status

**Live at https://vo.osmanflow.com**, build `d1ece7e`. Lint, typecheck, 685 unit
tests and the production build all pass. See
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Documentation

| File | Read it for |
|---|---|
| [HOW-TO-USE.md](HOW-TO-USE.md) | **The user guide** — PM, QS and admin, in plain language |
| [WHAT-CURRENT-VO-APP-CAN-DO.md](WHAT-CURRENT-VO-APP-CAN-DO.md) | What works, and what does not |
| [TEST-PLAN.md](TEST-PLAN.md) | The manual walkthrough, 18 stages |
| [VO-SERVICE.md](VO-SERVICE.md) | The product, for pricing and positioning |
| [CLAUDE.md](CLAUDE.md) | The contract: boundaries, deployment, n8n rules |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the app owns truth and n8n does not |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Tables, and the three the spec never listed |
| [API_SPEC.md](API_SPEC.md) | Both API families, payloads, the 4xx/5xx contract |
| [UI_SPEC.md](UI_SPEC.md) | Who holds the device, and what follows from that |
| [SECURITY.md](SECURITY.md) | Auth, authorisation, the integration boundary |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Supabase, Drive, the VPS, Traefik, verification |
| [N8N_WORKFLOW_MAP.md](N8N_WORKFLOW_MAP.md) | The eight lanes, one file per client |

## Quick start

```bash
npm install
cp .env.example .env          # Supabase; STORAGE_PROVIDER=local to skip Drive
npm run db:migrate            # includes pgvector indexes and RLS policies
npm run db:seed
npm run dev
```

## Deploy

```bash
ssh root@187.127.210.248 'cd /docker/vo && git pull && ./deploy/release.sh'
```

Migrations run before the new code serves traffic. The script builds the
`migrate` service **by name**, because a plain build skips it and ships today's
code against yesterday's schema.

## Deployment model

**Not multi-tenant SaaS.** Each company gets a separate installation with its own
database, storage, n8n workspace, credentials, users and branding. Client A and
Client B share nothing. This repository is the reusable master template.

## What never enters source control

```text
Client contracts, BOQs, pricing and correspondence.
Secrets — .env or a secret manager, never a commit, never .mcp.json.
```
