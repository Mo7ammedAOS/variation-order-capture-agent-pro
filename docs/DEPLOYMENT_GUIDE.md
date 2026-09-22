# Deployment Guide

Target: the existing Hostinger VPS, as another stack behind the reverse proxy
that already fronts n8n.

**That proxy is Traefik, not Caddy.** This guide said Caddy until 2026-08-30,
when the box was finally inspected. Traefik runs in **host network mode** with
the Docker provider and `exposedbydefault=false`, so routing is declared as
labels on the container — in `docker-compose.yml` — and there is no proxy config
file to edit. Traefik reaches containers on their bridge IP, which is why the
app publishes no host port.

```text
Hostinger VPS  srv1859636  ·  187.127.210.248  ·  2 vCPU, 7.8 GB
Traefik (host network, entrypoints web:80 → websecure:443, letsencrypt)
├── n8n.osmanflow.com  → n8n container            (existing, untouched)
├── evolution-api      → WhatsApp, on loopback    (existing, untouched)
└── vo.osmanflow.com   → vo app container :3000   ← new

Postgres + Auth → Supabase (hosted, ap-southeast-1)
Files           → Google Drive, or local disk while that is undecided
Embeddings      → local MiniLM, in-process, free
```

The router, middleware and service names all derive from `TRAEFIK_ROUTER`
(default `vo`). A second client deployment on the same box sets a different
value along with `APP_HOST`, and the two cannot collide.

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

## 2. File storage

**Decision, 2026-08-30: Google Drive, OAuth mode.** Supabase Storage caps each
upload at 50 MB on the free plan with 1 GB in total, and a fit-out drawing set
exceeds that on one file. Drive gives 15 GB and no meaningful per-file limit.

The database, pgvector and Auth all stay on Supabase. Only the bytes moved.

```bash
STORAGE_PROVIDER=google_drive
GOOGLE_DRIVE_AUTH_MODE=oauth
```

`osmanflow.com` is a personal Gmail account, so **service-account mode is not
available**: Shared Drives require Workspace, and a service account has no
storage quota of its own, so uploading into a merely-shared My Drive folder
fails with `storageQuotaExceeded`. OAuth against a real user is the route.

### Connecting Drive

```bash
npm run drive:connect
```

One command, and the only one you need. It mints the refresh token on your own
machine, ensures the root folder exists in that Drive, writes all four values
into `.env.production` on the server over SSH, switches `STORAGE_PROVIDER`, and
releases. The client secret is read without echo and the token file is mode 600
and deleted on exit; neither is ever passed as a command argument, because
arguments are visible in `ps` to every user on the machine.

`npm run drive:token` is the lower-level piece, if you only want the token.

**Re-run it when the OAuth client is DELETED and recreated.** Rotating only the
client *secret* does not need a new token — a refresh token is bound to the
client id, so it survives a secret change. Deleting the client does not, and the
failure reads `deleted_client`.

Runs on localhost, prompts for the client id and secret, opens consent, and
prints the four lines to paste into `.env.production`. It also names the account
it authorised and its remaining storage, so a token minted while signed in to
the wrong Google account is caught then rather than in production.

Three things that make this fail, all of them silently:

- **The consent screen left in "Testing"** — Google expires those refresh tokens
  after 7 days and the app then dies at every Drive call. **Publish it.**
- **Consenting a second time without revoking** — a refresh token is returned
  only on first consent for a client. The script passes `prompt=consent` to
  force it, and tells you to revoke at myaccount.google.com/permissions if it
  still comes back empty.
- **A trailing slash on the redirect URI.** It must be exactly
  `http://localhost:53682/callback`.

### What this means in practice

Evidence is owned by that personal Google account and counts against its 15 GB,
shared with Gmail and Photos. Fine now, and worth revisiting before a client
asks whose Drive their evidence sits in. Moving to Workspace later is a
`GOOGLE_DRIVE_AUTH_MODE` change plus a folder copy, not a code change.

Files are never linked directly. `sourceUrl` holds Drive's `webViewLink` but the
UI never renders it — reads go through `/api/documents/[id]/content`, which
checks project access first. A `webViewLink` in the HTML routes around every
access rule in the system.

### Alternate: Supabase Storage

`STORAGE_PROVIDER=supabase` with a **private** bucket named in
`SUPABASE_STORAGE_BUCKET`. One vendor for bytes and index, one backup regime,
and no OAuth token to keep alive. Ruled out here only on the 50 MB cap; on a
paid plan that limit rises to 50 GB and this becomes the simpler option again.

### Alternate: Google Drive on Workspace

If the account ever moves to Workspace, service-account mode is better: files
are owned by the organisation rather than a person, and no refresh token has to
be kept alive.

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

### Alternate: local disk

`STORAGE_PROVIDER=local` with `LOCAL_STORAGE_ROOT=/data/uploads`. Correct for
tests and local development. In production it is the one store nothing backs
up — the database rows survive a lost volume and point at files that no longer
exist, which reads as "evidence exists" when it does not.

## 3. DNS

**Domain settled 2026-08-30: `vo.osmanflow.com`**, and the A record was added
the same day. It resolves to `187.127.210.248` on every public resolver.

**DNS for `osmanflow.com` is at Squarespace, not Hostinger.** The nameservers are
`nsb1`–`nsb4.squarespacedns.com`, so records are added in Squarespace's DNS
panel. Anything entered into Hostinger's DNS zone editor saves happily and has
no effect, because nobody asks Hostinger for this domain's records.

| Type | Name | Value |
|---|---|---|
| A | `vo` | 187.127.210.248 |

Confirm before starting the container, not after:

```bash
dig +short vo.osmanflow.com      # must return the VPS IP
```

Traefik asks Let's Encrypt for a certificate the moment a labelled container
appears, and a challenge against a hostname that does not resolve counts toward
Let's Encrypt's failed-validation rate limit. Enough failures and the domain is
locked out for an hour.

The apex `osmanflow.com` points at Squarespace addresses, not the VPS. Adding
the `vo` subdomain does not disturb that.

## 4. Deploy

```bash
mkdir -p /docker/vo && cd /docker/vo    # sits beside /docker/n8n-3jqr, /docker/traefik
git clone https://github.com/Mo7ammedAOS/variation-order-capture-agent-pro.git .
cp .env.example .env.production   # then fill it in — never commit it
chmod 600 .env.production

./deploy/release.sh
```

`release.sh` builds, runs `prisma migrate deploy` — which now includes the
pgvector indexes and the RLS policies — starts the stack, and waits for health.
Migrations run **before** new code serves traffic, or a request can hit a column
that does not exist yet.

## 5. Routing

There is nothing to edit. Traefik discovers the container from the labels in
`docker-compose.yml` and requests the certificate itself; the existing n8n route
is never touched, so **n8n stays up throughout**. That is the main reason this
is safer than the Caddy plan it replaced: no shared config file to reload, so no
way for a mistake here to take n8n down with it.

Watch it happen:

```bash
docker logs -f traefik-traefik-1        # certificate issuance
curl -sI https://vo.osmanflow.com/login  # expect 200 and a valid chain
```

Upload size is enforced in `document.service.ts` at 25 MB. No proxy-level cap is
set: Traefik's buffering middleware would hold the whole body to enforce one,
and buffering 25 MB photographs to satisfy a limit the app already applies costs
memory for nothing.

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
mkdir /docker/vo-xyz && cd /docker/vo-xyz
git clone <repo> .
cp .env.example .env.production      # new Supabase project, new Drive folder,
                                     # CLIENT_SLUG=xyz
                                     # APP_HOST=vo.xyzinteriors.ae
                                     # TRAEFIK_ROUTER=vo-xyz   ← must be unique
./deploy/release.sh
```

No proxy edit. Traefik picks up the new labels on its own. `TRAEFIK_ROUTER` must
differ per deployment: two stacks sharing a router name would have one silently
overwrite the other's route.

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

## Outgrowing Supabase

Supabase is the right answer at this size and the wrong answer at some larger
one. Both halves move independently, and neither touches application code.

**Files → S3 or any S3-compatible store** (AWS S3, Cloudflare R2, Hetzner
Object Storage, Backblaze B2). Write one adapter against `StorageProvider` in
`src/integrations/storage/`, the same four methods the Supabase one implements,
then copy the bucket across and switch `STORAGE_PROVIDER`. `project_documents`
holds the object key, so a migration is a copy plus a key rewrite, and the
proxy route is unchanged. R2 is worth a look first — no egress charges, which
matters when the expensive traffic is a QS pulling drawing sets.

**Database and vectors → self-hosted Postgres with pgvector.** The vector store
is already plain pgvector with an HNSW index and `vector_cosine_ops`; nothing
about it is Supabase-specific. Moving means standing up Postgres 17 with the
`vector` extension, `pg_dump | pg_restore`, and repointing `DATABASE_URL` and
`DIRECT_URL`. The only genuinely Supabase-shaped dependency is **Auth**, so a
move either keeps Supabase for auth alone or swaps the `AuthProvider` adapter —
which is why auth sits behind an interface.

**What would actually trigger this:** Supabase Storage egress costs, a client
contractually requiring data residency in the UAE, or a database large enough
that connection-pooler limits start biting. None of those are true today, and
migrating before they are would be paying now to solve a problem you may never
have.

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
