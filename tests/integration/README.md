# Database-backed tests

These require a real Postgres and are the ones that prove the guarantee the
whole product rests on: **a user on Project A cannot reach Project B.**

They do not run in the default `npm test` sweep, because a green suite that
silently skipped the access-control tests is worse than a red one.

```bash
# with DATABASE_URL pointing at a database you are willing to have emptied
npm run test:db
```

Each spec builds its own fixtures and tears them down, so they can run against
a scratch schema on the same Supabase project.
