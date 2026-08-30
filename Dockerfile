# syntax=docker/dockerfile:1

# VO Capture & Control — production image.
#
# Multi-stage: deps -> build -> runner. The runner carries no source, no dev
# dependencies and no package manager, and runs as a non-root user.
#
# The MiniLM embedding weights are baked in at build time. A container start
# must never reach out to download a model: it would make the first capture on
# a fresh deploy depend on huggingface.co being reachable from the VPS.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts \
    && npx prisma generate

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next build needs the env contract satisfied. These are BUILD-TIME placeholders
# only — the real values arrive as runtime environment. Nothing secret is baked
# into the image, and src/lib/env.ts refuses to start in production against a
# placeholder, so a misconfigured deploy fails loudly instead of running blind.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    NEXT_PUBLIC_SUPABASE_URL="https://build.supabase.co" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="build" \
    SUPABASE_SERVICE_ROLE_KEY="build" \
    N8N_WEBHOOK_SECRET="build-time-only-secret"

RUN npx prisma generate && npm run build

# Pre-download the embedding model into the image, at a path both stages agree
# on. Transformers.js otherwise caches inside its own package directory, which
# the runner does not carry verbatim.
ENV TRANSFORMERS_CACHE_DIR=/app/.model-cache
RUN node -e "\
  import('@huggingface/transformers') \
    .then(async ({ pipeline, env }) => { \
      env.cacheDir = '/app/.model-cache'; \
      await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'); \
    }) \
    .then(() => console.log('embedding model cached')) \
    .catch((e) => { console.error('model cache failed:', e.message); process.exit(1); })" \
    && du -sh /app/.model-cache

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TRANSFORMERS_CACHE_DIR=/app/.model-cache \
    TRANSFORMERS_OFFLINE=1

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/.model-cache /app/.model-cache

# Prisma CLI and the migration engine, for `migrate deploy` on release.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin

# Evidence lives here when STORAGE_PROVIDER=local, and a named volume is mounted
# over it. Creating it in the image, owned by the app user, is what makes that
# work: Docker seeds a fresh named volume from the image directory including its
# ownership, so the non-root process can write to it. Without this the volume
# arrives root-owned and every upload fails with EACCES.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["node", "server.js"]
