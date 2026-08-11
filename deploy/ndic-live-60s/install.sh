#!/usr/bin/env bash
# Install/update NDIC 60s live systemd USER units (no root/sudo required).
# Runner user: github-runner. Requires: loginctl enable-linger (one-time, may need root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
LIVE_REPO="${IU_NDIC_LIVE_REPO_DIR:-$HOME/infouzel-ndic-live/repo}"
ENV_FILE="${HOME}/.config/infouzel/ndic-live-60s.env"

echo "INSTALL_ROOT=$ROOT"
mkdir -p "$UNIT_DIR"
mkdir -p "$(dirname "$ENV_FILE")"
mkdir -p "$(dirname "$LIVE_REPO")"

if [ ! -d "$LIVE_REPO/.git" ]; then
  echo "SYNC_REPO=clone"
  git clone --depth 1 "https://github.com/Josefjosefjosef/filtr.git" "$LIVE_REPO"
else
  echo "SYNC_REPO=fetch"
  git -C "$LIVE_REPO" fetch --depth 1 origin main
  git -C "$LIVE_REPO" checkout -f FETCH_HEAD
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/deploy/ndic-live-60s/ndic-live-60s.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "ENV_CREATED=$ENV_FILE"
fi

# Adapt unit for user systemd + home paths
sed \
  -e "s|WorkingDirectory=.*|WorkingDirectory=$LIVE_REPO|" \
  -e "s|EnvironmentFile=.*|EnvironmentFile=-$ENV_FILE|" \
  -e "s|User=github-runner|# User= (user unit)|" \
  -e "s|Group=github-runner|# Group= (user unit)|" \
  -e "s|IU_NDIC_TMC_LKG_ROOT=/home/github-runner/.cache/infouzel-ndic-tmc-lkg|IU_NDIC_TMC_LKG_ROOT=$HOME/.cache/infouzel-ndic-tmc-lkg|" \
  -e "s|IU_NDIC_LIVE_ROOT=/home/github-runner/.cache/infouzel-ndic-live|IU_NDIC_LIVE_ROOT=$HOME/.cache/infouzel-ndic-live|" \
  "$ROOT/deploy/ndic-live-60s/ndic-datex-live.service" > "$UNIT_DIR/ndic-datex-live.service"

cp "$ROOT/deploy/ndic-live-60s/ndic-datex-live.timer" "$UNIT_DIR/ndic-datex-live.timer"

systemctl --user daemon-reload
systemctl --user enable ndic-datex-live.timer
echo "UNITS_INSTALLED=YES"
echo "TIMER_ENABLED=$(systemctl --user is-enabled ndic-datex-live.timer || true)"
echo "NOTE=If timer inactive after reboot, ensure: loginctl enable-linger $(whoami)"
echo "NEXT=systemctl --user start ndic-datex-live.timer"
