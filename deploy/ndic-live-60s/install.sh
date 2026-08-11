#!/usr/bin/env bash
# Install/update NDIC 60s live units.
# Prefer systemd --user (start-to-start OnCalendar). Fallback: user crontab + flock
# (single-flight already in node live-lock). No root/sudo required for install itself;
# linger may need a one-time root enable for reboot persistence of user systemd.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
LIVE_REPO="${IU_NDIC_LIVE_REPO_DIR:-$HOME/infouzel-ndic-live/repo}"
ENV_FILE="${HOME}/.config/infouzel/ndic-live-60s.env"
CRON_MARKER="# iu-ndic-live-60s"

echo "INSTALL_ROOT=$ROOT"
mkdir -p "$UNIT_DIR"
mkdir -p "$(dirname "$ENV_FILE")"
mkdir -p "$(dirname "$LIVE_REPO")"
mkdir -p "$HOME/.cache/infouzel-ndic-live"
mkdir -p "$HOME/.cache/infouzel-ndic-tmc-lkg"

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
  -e "s|WantedBy=multi-user.target|WantedBy=default.target|" \
  -e "s|IU_NDIC_TMC_LKG_ROOT=/home/github-runner/.cache/infouzel-ndic-tmc-lkg|IU_NDIC_TMC_LKG_ROOT=$HOME/.cache/infouzel-ndic-tmc-lkg|" \
  -e "s|IU_NDIC_LIVE_ROOT=/home/github-runner/.cache/infouzel-ndic-live|IU_NDIC_LIVE_ROOT=$HOME/.cache/infouzel-ndic-live|" \
  "$ROOT/deploy/ndic-live-60s/ndic-datex-live.service" > "$UNIT_DIR/ndic-datex-live.service"

cp "$ROOT/deploy/ndic-live-60s/ndic-datex-live.timer" "$UNIT_DIR/ndic-datex-live.timer"

install_cron_fallback() {
  echo "TIMER_BACKEND=cron"
  local line
  line="* * * * * . $ENV_FILE; cd $LIVE_REPO && /usr/bin/flock -n $HOME/.cache/infouzel-ndic-live/cron.lock /usr/bin/node scripts/ndic-datex-v1-live-60s-run.mjs >>$HOME/.cache/infouzel-ndic-live/cron.log 2>&1 $CRON_MARKER"
  local tmp
  tmp="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "$CRON_MARKER" >"$tmp" || true
  echo "$line" >>"$tmp"
  crontab "$tmp"
  rm -f "$tmp"
  echo "CRON_INSTALLED=YES"
  echo "UNITS_INSTALLED=CRON_FALLBACK"
  echo "NOTE=systemd --user unavailable; cron * * * * * + flock (start-of-minute approx)"
}

ensure_user_systemd_ok() {
  local uid
  uid="$(id -u)"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
  if [ ! -d "$XDG_RUNTIME_DIR" ]; then
    echo "USER_SYSTEMD=NO_RUNTIME_DIR"
    return 1
  fi
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"
  if [ ! -S "${XDG_RUNTIME_DIR}/bus" ] && command -v dbus-daemon >/dev/null 2>&1; then
    echo "USER_SYSTEMD=STARTING_SESSION_BUS"
    # Best-effort ephemeral session bus for this install session.
    dbus-daemon --session --address="unix:path=${XDG_RUNTIME_DIR}/bus" --fork --nopidfile || true
    sleep 1
  fi
  if [ ! -S "${XDG_RUNTIME_DIR}/bus" ]; then
    echo "USER_SYSTEMD=NO_BUS"
    return 1
  fi
  if ! systemctl --user daemon-reload >/dev/null 2>&1; then
    echo "USER_SYSTEMD=SYSTEMCTL_FAIL"
    return 1
  fi
  echo "USER_SYSTEMD=OK"
  return 0
}

if ensure_user_systemd_ok; then
  systemctl --user daemon-reload
  systemctl --user enable ndic-datex-live.timer
  systemctl --user restart ndic-datex-live.timer || systemctl --user start ndic-datex-live.timer
  echo "TIMER_BACKEND=systemd-user"
  echo "UNITS_INSTALLED=YES"
  echo "TIMER_ENABLED=$(systemctl --user is-enabled ndic-datex-live.timer || true)"
  echo "TIMER_ACTIVE=$(systemctl --user is-active ndic-datex-live.timer || true)"
  echo "NOTE=If inactive after reboot: loginctl enable-linger $(whoami)"
else
  echo "HINT=One-time root: loginctl enable-linger $(whoami)"
  install_cron_fallback
fi

echo "NEXT=status via workflow action=status"
