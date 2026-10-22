#!/usr/bin/env bash
# Patch only [[env.staging.d1_databases]] database_id from wrangler d1 list (fail-closed).
set -euo pipefail
D1_NAME="${1:-iu-cj-email-ingest-staging}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}/cloudflare/cj-email-ingest-d1-worker"
JSON="$(npx --yes wrangler@4 d1 list --json)"
echo "$JSON" | node "${ROOT}/scripts/iu-cj-affiliate-staging-d1-resolve-v1.mjs" \
  --patch wrangler.toml \
  --expect-name "${D1_NAME}" 1>&2
echo "CJ_ARM_D1_RESOLVE=PASS"
