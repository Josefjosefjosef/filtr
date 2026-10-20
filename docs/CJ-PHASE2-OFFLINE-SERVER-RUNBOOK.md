# CJ Phase 2 — offline server runbook (NOT activated)

Planning only. No production cron, IMAP, CJ HTTP, signing, or trusted adapter in this phase.

## Current offline stack

- `iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs` — lock, audit JSONL, mock product feed, optional mock FORPSI ingest.
- `iu-cj-affiliate-phase2-github-actions-ingest-*.mjs` — mock IMAP → MIME → pipeline → mock D1.
- `.github/workflows/cj-affiliate-offline-import-dispatch.yml` — **workflow_dispatch only**.

## Future activation checklist (requires explicit GO)

1. Infra secrets: `IU_CJ_PAT`, `IU_CJ_PUBLISHER_CID`, `IU_CJ_WEBSITE_PID`, `IU_FORPSI_IMAP_*` via platform store (`IU_CJ_CREDENTIAL_SOURCE=infra`).
2. Multi-gate live: `IU_CJ_LIVE_INGEST_APPROVED=1`, `IU_FORPSI_IMAP_CONNECT_APPROVED=1`, worker D1 backend + ingest token.
3. Scheduler: add `schedule` only after gates tested in staging; never silent fallback to mock D1.
4. Monitoring: audit JSONL shipping, 401/403 alerts, zero-feed alerts, lock contention metrics.
5. Publication: `PRODUCTION_SIGNING_ENABLED` + trusted archive adapter — separate approval.
6. Rollback: disable workflow schedule, revoke PAT, set `IU_CJ_UNATTENDED_IMPORT_OFFLINE=1`.

## Emergency stop

Set all of: `IU_CJ_EMAIL_INGEST_OFFLINE=1`, `IU_CJ_UNATTENDED_IMPORT_OFFLINE=1`, `ADS_PUBLIC_DELIVERY_ENABLED=false`, disable workflow.
