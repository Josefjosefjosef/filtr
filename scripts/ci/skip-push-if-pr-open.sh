#!/usr/bin/env bash
# On push to fix/**, if an open PR already covers this branch, skip the heavy job.
# PR workflow owns required checks; a cancelled sibling push must not be created.
# Outputs: skip=true|false (GITHUB_OUTPUT)
set -euo pipefail

EVENT_NAME="${GITHUB_EVENT_NAME:-}"
REF_NAME="${GITHUB_REF_NAME:-}"
HEAD_REF="${GITHUB_HEAD_REF:-}"

SKIP="false"

if [ "$EVENT_NAME" = "push" ] && [[ "$REF_NAME" == fix/* ]]; then
  if [ -z "${GH_TOKEN:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
    GH_TOKEN="$GITHUB_TOKEN"
    export GH_TOKEN
  fi
  COUNT="$(gh pr list --head "$REF_NAME" --state open --json number --jq 'length' 2>/dev/null || echo 0)"
  if [ "${COUNT:-0}" -gt 0 ]; then
    SKIP="true"
    echo "skip_push_if_pr_open=YES head=$REF_NAME open_prs=$COUNT"
  else
    echo "skip_push_if_pr_open=NO head=$REF_NAME (no open PR — push owns required checks)"
  fi
else
  echo "skip_push_if_pr_open=NO event=$EVENT_NAME ref=${REF_NAME:-$HEAD_REF}"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "skip=$SKIP" >> "$GITHUB_OUTPUT"
fi
echo "SKIP_PUSH_IF_PR_OPEN=$SKIP"
