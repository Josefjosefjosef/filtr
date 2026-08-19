#!/usr/bin/env bash
# Post (or intentionally skip) a required commit status.
# Args: CONTEXT
# Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_EVENT_NAME,
#      JOB_STATUS, PULL_REQUEST_HEAD_SHA (optional), TARGET_URL
set -euo pipefail

CONTEXT="${1:?context required}"
JOB_STATUS="${JOB_STATUS:?JOB_STATUS required}"
EVENT_NAME="${GITHUB_EVENT_NAME:-}"
GITHUB_SHA_VAL="${GITHUB_SHA:-}"
HEAD_SHA="${PULL_REQUEST_HEAD_SHA:-}"
TARGET_URL="${TARGET_URL:-}"

if [ "$JOB_STATUS" = "cancelled" ] || [ "$JOB_STATUS" = "skipped" ]; then
  echo "status_post_skip=job_${JOB_STATUS} context=${CONTEXT}"
  exit 0
fi

STATE="success"
if [ "$JOB_STATUS" != "success" ]; then
  STATE="failure"
fi

SHA="$GITHUB_SHA_VAL"
if [ "$EVENT_NAME" = "pull_request" ] || [ "$EVENT_NAME" = "pull_request_target" ]; then
  if [ -z "$HEAD_SHA" ]; then
    echo "status_post_skip=missing_pull_request_head_sha context=${CONTEXT}"
    exit 1
  fi
  SHA="$HEAD_SHA"
fi

if [ -z "$SHA" ]; then
  echo "status_post_skip=missing_sha context=${CONTEXT}"
  exit 1
fi

# Stale-run safety: cancelled siblings used to post FAILURE after a valid SUCCESS.
# Do not clobber an existing SUCCESS with FAILURE from a superseded/zombie job.
if [ "$STATE" = "failure" ]; then
  EXISTING="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${SHA}/status" --jq ".statuses[] | select(.context==\"${CONTEXT}\") | .state" 2>/dev/null | head -n 1 || true)"
  if [ "$EXISTING" = "success" ]; then
    echo "status_post_skip=preserve_existing_success context=${CONTEXT} sha=${SHA}"
    exit 0
  fi
fi

for attempt in 1 2 3 4 5 6; do
  if gh api --method POST "repos/${GITHUB_REPOSITORY}/statuses/${SHA}" \
    -f state="$STATE" \
    -f context="$CONTEXT" \
    -f description="Required status context (${CONTEXT})" \
    -f target_url="$TARGET_URL"; then
    echo "status_post_ok context=${CONTEXT} state=${STATE} sha=${SHA}"
    exit 0
  fi
  echo "status_post_retry=$attempt"
  sleep $((attempt * 5))
done
exit 1
