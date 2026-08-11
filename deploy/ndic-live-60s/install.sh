#!/usr/bin/env bash
# Install/update NDIC 60s live systemd units on Czech VPS (run as root).
# Does NOT enable active production mode — leaves IU_NDIC_LIVE_MODE from env file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR=/etc/systemd/system
LIVE_REPO="${IU_NDIC_LIVE_REPO_DIR:-/home/github-runner/infouzel-ndic-live/repo}"
ENV_FILE=/etc/infouzel/ndic-live-60s.env

echo "INSTALL_ROOT=$ROOT"
mkdir -p /etc/infouzel
mkdir -p "$(dirname "$LIVE_REPO")"

if [ ! -d "$LIVE_REPO/.git" ]; then
  echo "SYNC_REPO=clone"
  git clone --depth 1 "https://github.com/Josefjosefjosef/filtr.git" "$LIVE_REPO"
else
  echo "SYNC_REPO=fetch"
  git -C "$LIVE_REPO" fetch --depth 1 origin main
  git -C "$LIVE_REPO" checkout -f origin/main
fi

chown -R github-runner:github-runner "$(dirname "$LIVE_REPO")" || true

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/deploy/ndic-live-60s/ndic-live-60s.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "ENV_CREATED=$ENV_FILE (fill secrets; mode stays shadow)"
fi

install -m 0644 "$ROOT/deploy/ndic-live-60s/ndic-datex-live.service" "$UNIT_DIR/ndic-datex-live.service"
install -m 0644 "$ROOT/deploy/ndic-live-60s/ndic-datex-live.timer" "$UNIT_DIR/ndic-datex-live.timer"

# Point WorkingDirectory at synced repo
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$LIVE_REPO|" "$UNIT_DIR/ndic-datex-live.service"

systemctl daemon-reload
systemctl enable ndic-datex-live.timer
# Do not start active production here — caller decides shadow vs enable timer start.
echo "UNITS_INSTALLED=YES"
echo "TIMER_ENABLED=$(systemctl is-enabled ndic-datex-live.timer || true)"
echo "NEXT=systemctl start ndic-datex-live.timer   # after secrets + LIVE_MODE set"
