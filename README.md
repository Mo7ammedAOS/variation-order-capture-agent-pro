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
[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Documentation

Everything readable lives in **`docs/`**. Markdown is the source and is tracked;
**`docs/pdf/`** holds what is rendered from it and is gitignored, because this
repository is public.

| File | Read it for |
|---|---|
| [docs/HOW-TO-USE.md](docs/HOW-TO-USE.md) | **The user guide** — PM, QS and admin, in plain language |
| [docs/WHAT-CURRENT-VO-APP-CAN-DO.md](docs/WHAT-CURRENT-VO-APP-CAN-DO.md) | What works, and what does not |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | The manual walkthrough, 18 stages |
| [docs/VO-SERVICE.md](docs/VO-SERVICE.md) | The product, for pricing and positioning |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | Build state, gates, what is left |
| [CLAUDE.md](CLAUDE.md) | The contract: boundaries, deployment, n8n rules |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Why the app owns truth and n8n does not |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Tables, and the three the spec never listed |
| [docs/API_SPEC.md](docs/API_SPEC.md) | Both API families, payloads, the 4xx/5xx contract |
| [docs/UI_SPEC.md](docs/UI_SPEC.md) | Who holds the device, and what follows from that |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, authorisation, the integration boundary |
| [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) | Supabase, Drive, the VPS, Traefik, verification |
| [docs/N8N_WORKFLOW_MAP.md](docs/N8N_WORKFLOW_MAP.md) | The eight lanes, one file per client |
| [docs/decisions/](docs/decisions/) | Why things are the way they are |

### The printable ones — `docs/pdf/`

| File | What it is |
|---|---|
| `VO-App-User-Guide.pdf` | The user guide, 2 pages. Print it and hand it out |
| `VO-TEST-PLAN.pdf` | The test plan with tick boxes. Rebuild it below |
| `VO-CATALOG-AR.pdf` | The Arabic sales catalog |
| `VO-ROI-AED20k.pdf` | The ROI case. **Carries the setup price** |
| `VO-Client-Meeting-Guide-15min.pdf` | The 15-minute meeting script |

```bash
python3 scripts/build-test-plan-pdf.py   # rebuilds the test plan from its markdown
```

The last two are sales documents, not app documents. They stay out of the
repository on purpose: one carries what you charge and the other is how you sell
it, and neither should be readable by the client sitting across the table.

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
