# Security

## Threat model in one line

The app is on the public internet so site engineers and PMs can reach it from
their phones. Everything below follows from that.

## Authentication

- **Supabase Auth.** Our `users.id` is the `auth.users` UUID.
- **No public signup.** Accounts exist only because an admin created one.
  Invited people set their own password from a Supabase link — this application
  never sees or stores a password.
- **Deactivation, not deletion.** A leaver keeps their identity so the audit
  trail still resolves to a real person; `active: false` revokes access. A valid
  Supabase session for a deactivated person is **not** a session, and that check
  is in `src/lib/auth/session.ts`, in one place.
- **Login rate limiting.** 8 attempts per email per 15 minutes.
- **Uniform failure message.** Wrong password and unknown address return the
  same text. Distinguishing them enumerates which addresses are real.

## Authorisation

Two independent layers; conflating them is the classic bug.

| | Governs | Source |
|---|---|---|
| **System role** (11) | Company-wide reach and admin powers | `users.system_role` |
| **Project role** (13) | What you may do on one project | `project_members` |

A membership row **is** the grant. There is no deny record, so there is no deny
record to forget to write — absence is denial.

**Every project-scoped query goes through `project-access.service.ts`.** See
ARCHITECTURE.md for why RLS is defence in depth rather than the gate.

## The integration boundary

`/api/integrations/*` is the only surface n8n may write through, and each route
runs in this order — rearranging it breaks something:

```text
1. verify HMAC over the RAW body   (before parsing: don't let an
                                    unauthenticated caller probe the schema)
2. rate limit
3. Zod validation
4. idempotency insert              (before business rules: a retry must not
                                    create a second commercial record)
5. business rules
```

- **HMAC-SHA256** over `timestamp.rawBody`, constant-time compared. A bearer
  token proves someone knows a secret; an HMAC also proves the body is unaltered.
- **±5 minute timestamp window.** A signature is valid forever unless bound to a
  time. Without this, a captured request replays months later.
- **Idempotency is enforced by a unique index**, not by a pre-check. The
  pre-check is an optimisation; the index is the guarantee, and a genuine race
  falls back to the winner's stored result.

## Files

**Never hand the browser a Drive link.** Files are served only through
`/api/documents/[id]/content`, which checks project access and *then* streams
bytes. A `webViewLink` in the HTML would route around every access rule
permanently, for anyone with the URL.

- Upload cap 25 MB; allowlisted MIME types.
- `X-Content-Type-Options: nosniff` so an upload cannot talk a browser into
  executing it.
- `Cache-Control: private, no-store` — commercial evidence must not sit in a
  shared cache.
- The app **trashes, never purges**. Evidence is not destroyed by software.

## Secrets

| Variable | Where it may appear |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. **Never** `NEXT_PUBLIC_`. Bypasses RLS |
| `N8N_WEBHOOK_SECRET` | Server only |
| `GOOGLE_*` | Server only, inside the container |
| `DATABASE_URL` / `DIRECT_URL` | Server only |

`src/lib/env.ts` **refuses to start in production** against a placeholder value,
so a half-configured deploy fails loudly rather than running blind.

`.gitignore` excludes `.env*` (except `.env.example`), keys, client commercial
data, and unscrubbed n8n exports.

## Audit

Append only. Never updated, never deleted. Written **in the same transaction**
as the change it describes, so an audit gap cannot happen — either both land or
neither does. Each entry records user, project, record type, record id, action,
old value, new value, source, timestamp, metadata.

## Known limitations

- **Rate limiting is in-process.** It protects one container. Scaling past one
  replica requires moving the counter to Redis. It is not silently broken — it is
  just not shared.
- **No 2FA.** Supabase supports it; not wired up in Phase 1.
- **RLS covers reads only.** No INSERT/UPDATE/DELETE policies exist, deliberately:
  writes must go through the application so they get validation, authority checks
  and an audit event. A direct write would skip all three.
- **No CSRF token** beyond `SameSite=Lax` cookies and Server Actions' built-in
  origin check.
- **The repo is public.** Stated because it is true, not because it is advisable.

## If a key leaks

1. Rotate in Supabase (Settings → API) or Google Cloud Console.
2. Update `.env.production` on the VPS.
3. `./deploy/release.sh`.
4. Read `activity_logs` and `integration_events` for the exposure window.
