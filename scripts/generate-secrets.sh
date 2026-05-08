#!/bin/sh
# Generate the random secrets needed by the app and print them as KEY=value lines.
#
# Usage:
#   ./scripts/generate-secrets.sh                  # print to stdout
#   ./scripts/generate-secrets.sh >> .env          # append to .env (CAREFUL: don't double-append)
#   ./scripts/generate-secrets.sh | pbcopy         # macOS clipboard
#   ./scripts/generate-secrets.sh | xclip          # Linux clipboard
#
# Each value is freshly generated. Run this once during initial setup, copy
# values into .env, and don't run it again unless you're rotating secrets.

set -e

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl not found in PATH. Install openssl and re-run." >&2
  exit 1
fi

cat <<EOF
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ") by scripts/generate-secrets.sh
# Copy these into your .env file.

AUTH_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
METRICS_TOKEN=$(openssl rand -hex 32)
EOF
