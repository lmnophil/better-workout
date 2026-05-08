#!/bin/sh
# Container entrypoint.
# Runs migrations on every start (Prisma migrate deploy is idempotent — safe
# to call when there's nothing to apply). Then exec's the Next.js server so
# signals propagate cleanly.

set -e

echo "→ Applying database migrations..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "→ Starting Next.js server..."
exec node server.js
