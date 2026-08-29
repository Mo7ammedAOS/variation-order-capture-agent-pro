# Deployment Guide

Target: the existing VPS, as a second container behind the Caddy that already
fronts n8n.

```text
Caddy (running, auto-TLS)
├── n8n.osmanflow.com  → n8n            (existing, untouched)
└── vo.osmanflow.com   → vo-app :3100   ← new

Postgres + Auth → Supabase (hosted)
Files           → Google Drive
Embeddings      → local MiniLM, in-process, free
```

Chosen over Vercel because BullMQ workers and the local embedding model both
need a long-lived process, and the deployment model wants one self-contained
stack per client.

---

## 1. Supabase

Create a project (region close to the UAE), then from **Settings → Database**
and **Settings → API**:

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?connection_limit=6&pool_timeout=20"
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ…"
SUPABASE_SERVICE_ROLE_KEY="eyJ…"
```

- `DATABASE_URL` is the **session pooler** (port **5432**), not the transaction
  pooler. This is a deliberate reversal of the common advice, and it is worth
  understanding before someone "corrects" it back.

  The transaction pooler (6543) needs `pgbouncer=true`, because transaction-mode
  pooling cannot carry prepared statements between queries. That flag is not
  free. Measured against `ap-southeast-1` from the UAE, where one network round
  trip is **160ms**:

  | Connection | Query cost | 120 concurrent operations |
  |---|---|---|
  | Session pooler `:5432` | **159ms** — one round trip | 120/120 clean |
  | Transaction `:6543` + `pgbouncer=true` | 799ms — about five | 120/120 clean |
  | Transaction `:6543`, flag removed | — | **fails**, `26000 prepared statement "sN" does not exist` |

  So the flag costs 5x, and removing it while staying on 6543 is not an option —
  the third row is what that looks like under load. The session pooler gives each
  client a real session, so prepared statements work and a query costs the one
  round trip it should. It suits us because this app is a **long-lived
  container**: the transaction pooler exists for serverless, where thousands of
  short-lived instances each need a connection for milliseconds. We are the
  opposite shape.

  Revisit this only if you move to serverless or run enough replicas to approach
  the session-mode connection limit. Both mean going back to 6543 **with** the
  flag, and accepting the 5x.
- **The session pooler caps total clients, and the cap is low.** This project
  reports `pool_size: 15`, and it counts *idle* connections too. Exceeding it
  gives `FATAL: (EMAXCONNSESSION) max clients reached in session mode` — which
  surfaces through Prisma as `PrismaClientInitializationError` in whatever
  happened to be running, so it reads like an unrelated bug. Budget it:

  | Consumer | Connections |
  |---|---|
  | app container | 6 (`connection_limit`) |
  | worker container | 3 |
  | `migrate deploy` during a release | 1, briefly |
  | headroom for a psql session | the rest |

  Raise the ceiling in Supabase under **Settings → Database → Connection
  pooling → Pool Size** before adding replicas. Locally, do not run the dev
  server and `npm test` at once — between them they will spend the allowance.
- `connection_limit`: Prisma's docs suggest `1` for **serverless**, where many
  short-lived instances would each open a pool and exhaust the pooler. This app
  is a **long-lived container**, where a pool of 1 serialises every concurrent
  request — eight simultaneous captures would have seven time out. `10` suits one
  container; raise it in step with replicas, well under the pooler limit.
- `DIRECT_URL` is port **5432** as well, and migrations need a real session for
  the same reason. With the change above both URLs now point at the same host and
  port; they stay separate variables because Prisma requires it, and because a
  deployment that ever moves `DATABASE_URL` back to 6543 must not drag migrations
  along with it.
- **If `DIRECT_URL` fails with `P1001`**, the direct host `db.<ref>.supabase.co`
  is **IPv6-only** and your network is not. Use the **session pooler** instead:
  same pooler host, port 5432, user `postgres.<ref>`. IPv4-reachable, real
  session, migrations work. Do **not** substitute the transaction pooler.
- **Percent-encode the password.** If it contains `@`, `#`, `/`, `?` or `:`,
  paste it through URL-encoding first — `@`→`%40`, `#`→`%23`. An unencoded `@`
  splits the URI at the wrong place; an unencoded `#` starts a fragment and
  everything after it is silently discarded.
- The service role key **bypasses RLS**. Server only. Never `NEXT_PUBLIC_`.

Turn **off** public signups: Authentication → Providers → Email → disable
"Enable sign ups". Accounts are created by an admin.

## 2. Google Drive

Two modes. Which one you can use depends on the account.

### Google Workspace → service account + Shared Drive

```bash
GOOGLE_DRIVE_AUTH_MODE=service_account
GOOGLE_SERVICE_ACCOUNT_JSON='{"client_email":"…","private_key":"-----BEGIN…"}'
GOOGLE_DRIVE_ROOT_FOLDER_ID=<folder inside the Shared Drive>
```

1. Google Cloud Console → new project → enable the **Drive API**.
2. Create a service account, create a JSON key.
3. Create a **Shared Drive** and add the service account email as **Content
   manager**.
4. Create a folder inside it; the id is the tail of its URL.

> **A service account has no Drive storage quota of its own.** Uploading into a
> My Drive folder merely *shared* with it fails with `storageQuotaExceeded`. It
> must be a Shared Drive, which requires Workspace. The adapter catches this
> error and explains it rather than surfacing a raw API failure.

### Personal @gmail.com → OAuth refresh token

Shared Drives do not exist on a personal account, so use OAuth:

```bash
GOOGLE_DRIVE_AUTH_MODE=oauth
GOOGLE_OAUTH_CLIENT_ID=…
GOOGLE_OAUTH_CLIENT_SECRET=…
GOOGLE_OAUTH_REFRESH_TOKEN=…
GOOGLE_DRIVE_ROOT_FOLDER_ID=<folder in My Drive>
```

Create an OAuth client (Desktop app), then mint a refresh token once with scope
`https://www.googleapis.com/auth/drive` via the OAuth Playground (use your own
client id under the gear icon, and tick "offline access").

Files are then owned by that Google account — worth knowing before a client asks
whose Drive their evidence lives in.

**To skip Drive entirely while testing:** `STORAGE_PROVIDER=local`.

## 3. DNS

An **A record** for `vo.osmanflow.com` → the VPS IP. Confirm before Caddy tries
to issue a certificate:

```bash
dig +short vo.osmanflow.com
```

## 4. Deploy

```bash
git clone https://github.com/Mo7ammedAOS/variation-order-capture-agent-pro.git
cd variation-order-capture-agent-pro
cp .env.example .env.production   # then fill it in — never commit it
chmod 600 .env.production

./deploy/release.sh
```

`release.sh` builds, runs `prisma migrate deploy`, applies the pgvector and RLS
SQL, starts the stack, and waits for health. Migrations run **before** new code
serves traffic, or a request can hit a column that does not exist yet.

## 5. Caddy

Append `deploy/Caddyfile.snippet` to `/etc/caddy/Caddyfile`, then:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

TLS is automatic. The snippet sets HSTS and a 25 MB body limit matching the
upload cap in `document.service.ts` — keep the two in step, or Caddy rejects a
file the app would have accepted.

## 6. Seed and first sign-in

```bash
docker compose --env-file .env.production run --rm app npm run db:seed
```

Creates ABC Fit-Out with 12 users, 5 projects and 20 potential changes. It is
idempotent. Without a service role key it seeds the data but **creates no
identities**, and says so — nobody could sign in.

Then sign in, and immediately:

1. Invite your real users at `/settings/users`.
2. Deactivate the seeded accounts.
3. Change `SEED_PASSWORD` or stop using it.

## 7. Verify on a real phone, on mobile data

Not on the office wifi — that skips DNS, TLS and the mobile layout at once.

```text
[ ] TLS padlock, no warning
[ ] Sign in as a Site Engineer
[ ] + Report Change → attach a photo → submit
[ ] PC number appears, notice countdown shows a colour
[ ] Photo opens through /api/documents/… (not a Drive link)
[ ] Sign in as a Director → sees every project
[ ] Sign in as an engineer on another project → 403 on the first project
```

---

## Adding a second client

No code changes.

```bash
mkdir /srv/vo-xyz && cd /srv/vo-xyz
git clone <repo> .
cp .env.example .env.production      # new Supabase project, new Drive folder,
                                     # CLIENT_SLUG=xyz, APP_PORT=3101
./deploy/release.sh
# add a vo.xyzinteriors.ae block to the Caddyfile, reload
```

Separate database, storage, secrets, container and volume. Nothing is shared.

## Operations

```bash
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production ps
./deploy/release.sh                                   # redeploy
docker compose --env-file .env.production down        # stop
```

Backups are Supabase's (Database → Backups) — daily on the free tier, PITR on
paid. Drive keeps its own version history. **Test a restore before you need
one.**

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Refusing to start in production with placeholder values` | `.env.production` still has an `.env.example` value. Working as intended |
| `storageQuotaExceeded` | Service account against My Drive. Use a Shared Drive, or `oauth` |
| Migrations hang | Using the pooler. `DIRECT_URL` must be port 5432 |
| `Can't reach database server` | Wrong region host, or Supabase project paused |
| Cert not issued | DNS not propagated, or 80/443 blocked |
| Everyone sees every project | Check `system_role` — five roles carry company-wide reach by design |
| Embeddings fail | Migrations not fully applied — `npx prisma migrate status` |
