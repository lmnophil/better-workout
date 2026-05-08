# syntax=docker/dockerfile:1.7
# Multi-stage build for Next.js standalone output.
# Final image is ~200MB and runs as a non-root user.

# ============================================================
# Stage 1: install dependencies
# ============================================================
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ============================================================
# Stage 2: build the app
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Generate Prisma client (committed types)
RUN npx prisma generate

# Pre-compile the seed script with esbuild so it runs in the runtime image
# without needing tsx. Bundles lib/exercises-data.ts and other TS imports.
# @prisma/client stays external — it's already in the runtime image.
RUN npx esbuild prisma/seed.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile=prisma/seed.js \
    --external:@prisma/client

# Build Next.js — produces the standalone server in .next/standalone
RUN npm run build

# ============================================================
# Stage 3: minimal runtime image
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Copy the Next.js standalone server (includes only what's needed at runtime)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma client + CLI for migrate-on-start
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Entrypoint runs migrations then starts the server
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

# Docker HEALTHCHECK probe — small Node script that hits /api/healthz
COPY --chown=nextjs:nodejs healthcheck.js ./healthcheck.js

USER nextjs
EXPOSE 3000

# HEALTHCHECK lives in compose for orchestrator-friendliness, but we mirror it
# here so `docker run` outside compose also gets health status.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node healthcheck.js

ENTRYPOINT ["./entrypoint.sh"]
