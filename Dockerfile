# syntax=docker/dockerfile:1.7
# Multi-stage build for Next.js standalone output.
# Final image is ~200MB and runs as a non-root user.

# ============================================================
# Stage 1: install dependencies
# ============================================================
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ============================================================
# Stage 2a: install production-only dependencies
# ============================================================
# Used by the runtime image. The Prisma CLI (run by entrypoint.sh on every
# container start) and its config loader pull in transitive deps like `effect`
# that aren't part of Next.js's standalone trace. Installing the full prod
# tree here is simpler and more durable than enumerating every transitive
# package by hand.
FROM node:22-alpine AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# ============================================================
# Stage 2b: build the app
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client (committed types)
RUN npx prisma generate

# Pre-compile the seed script with esbuild so it runs in the runtime image
# without needing tsx. Bundles lib/exercises-data.ts, lib/scalar-list.ts, and
# the generated Prisma client (pure JS in v7) into one file. node_modules
# packages stay external — @prisma/adapter-libsql, libsql (a prebuilt native
# module; no compile step), and friends are already in the runtime image.
# Output is ESM because package.json sets "type": "module".
RUN npx esbuild prisma/seed.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --format=esm \
    --packages=external \
    --outfile=prisma/seed.js

# `next build` collects page data by importing every route module. The auth
# route (/api/auth/[...nextauth]) pulls in lib/db.ts, which constructs the
# Prisma client at import time and throws if DATABASE_URL is unset. The build
# never opens a connection — it only reads route config — so a throwaway file:
# URL is enough to satisfy the check. The real database URL is injected at
# runtime by docker-compose; this placeholder never reaches the runner stage.
ENV DATABASE_URL="file:/tmp/build.db"

# Build Next.js — produces the standalone server in .next/standalone
RUN npm run build

# ============================================================
# Stage 3: minimal runtime image
# ============================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# SQLite lives on a mounted volume at /app/data. Create the directory owned by
# the app user so a fresh named volume inherits that ownership on first run
# (Docker seeds a new empty volume from the image dir, owner included) and the
# non-root process can create + write the database file.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy the Next.js standalone server (includes only what's needed at runtime)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Production-only node_modules from the prod-deps stage. Overlays onto the
# standalone trace so that the Prisma CLI (used by entrypoint.sh) and the
# bundled seed have all their transitive deps available. Same versions as
# standalone's traced subset, so any path collisions are no-ops.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Prisma source artefacts: schema, migrations, the compiled seed.js, and the
# generated client at prisma/generated/prisma/. Prisma 7 emits the client into
# the project tree rather than node_modules/.prisma, so this dir carries it.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Entrypoint runs migrations then starts the server
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

# Docker HEALTHCHECK probe — small Node script that hits /api/healthz
COPY --chown=nextjs:nodejs healthcheck.cjs ./healthcheck.cjs

USER nextjs
EXPOSE 3000

# HEALTHCHECK lives in compose for orchestrator-friendliness, but we mirror it
# here so `docker run` outside compose also gets health status.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node healthcheck.cjs

ENTRYPOINT ["./entrypoint.sh"]
