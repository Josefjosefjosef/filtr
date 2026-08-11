#!/usr/bin/env bash
# Cron/systemd entrypoint for NDIC 60s live tick.
# NODE_BIN is rewritten by install.sh to the runner's real node path.
set -euo pipefail
ENV_FILE="${IU_NDIC_LIVE_ENV_FILE:-$HOME/.config/infouzel/ndic-live-60s.env}"
LIVE_REPO="${IU_NDIC_LIVE_REPO_DIR:-$HOME/infouzel-ndic-live/repo}"
LOG_DIR="${IU_NDIC_LIVE_ROOT:-$HOME/.cache/infouzel-ndic-live}"
NODE_BIN="__IU_NODE_BIN__"
mkdir -p "$LOG_DIR"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "${NODE_BIN:-}" ] || [ ! -x "$NODE_BIN" ]; then
  echo "NODE_BIN_MISSING" >&2
  exit 127
fi
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
cd "$LIVE_REPO"
exec "$NODE_BIN" scripts/ndic-datex-v1-live-60s-run.mjs
