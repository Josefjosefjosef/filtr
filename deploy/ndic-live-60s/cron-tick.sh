#!/usr/bin/env bash
# Cron/systemd entrypoint for NDIC 60s live tick.
# Sources env safely then runs oneshot (lock inside node).
set -euo pipefail
ENV_FILE="${IU_NDIC_LIVE_ENV_FILE:-$HOME/.config/infouzel/ndic-live-60s.env}"
LIVE_REPO="${IU_NDIC_LIVE_REPO_DIR:-$HOME/infouzel-ndic-live/repo}"
LOG_DIR="${IU_NDIC_LIVE_ROOT:-$HOME/.cache/infouzel-ndic-live}"
mkdir -p "$LOG_DIR"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi
cd "$LIVE_REPO"
exec /usr/bin/node scripts/ndic-datex-v1-live-60s-run.mjs
