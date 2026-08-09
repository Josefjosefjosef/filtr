# NDIC automatic schedule operation

`TARGET_OPERATION_MODE=AUTOMATIC_SCHEDULED_NDIC_SYNC_WITH_CONTINUOUS_SELF_HOSTED_RUNNER`

The NDIC DATEX v1 sync can run unattended on a cron schedule. It stays **disarmed until an
operator explicitly enables it**, and every scheduled run re-earns its right to touch the
NDIC network through an inline preflight in the same run.

## Operating model

| Aspect | Value |
| --- | --- |
| Workflow | `.github/workflows/update-ndic-datex-v1.yml` |
| Cron | `7,22,37,52 * * * *` (staggered 15-minute cadence) |
| Arming | repository variable `NDIC_AUTOMATION_ENABLED` must be exactly `true` |
| Scheduled mode | `active` (only after an armed preflight PASS) |
| Runner | continuous self-hosted `infouzel-ndic-cz-vps4204` (`self-hosted+Linux+X64+ndic-cz-egress`) |
| Manual break-glass | `workflow_dispatch` with mode `off`/`shadow`/`active` |

No authoritative minimum NDIC poll interval is published, so the cadence is deliberately
conservative and offset from the top of the hour to avoid synchronising with other pollers.

## Job graph

```
schedule (cron)                       workflow_dispatch (break-glass)
      |                                            |
  schedule-gate            (ubuntu-latest)         |
  - NDIC_AUTOMATION_ENABLED == 'true'?             |
  - another run of this workflow in_progress?      |
  - outputs armed / proceed / skip_reason          |
      | proceed == 'true'                          |
  scheduled-preflight      (ubuntu-latest)         |
  - offline fixture + product guard suite          |
  - publishes HEAD-bound attestation for github.sha|
      |                                            |
      +---------------> ndic-prep <----------------+   (self-hosted CZ)
                        - runner identity first, before checkout/secrets
                        - verifies attestation for exact github.sha
                        - IU_NDIC_* secrets, NDIC network, builds candidate
                        - concurrency: ndic-datex-v1-internal-staging (cancel false)
                                |  resolved_mode == 'active' && candidate_ready
                        ndic-shared-write                        (self-hosted CZ)
                        - concurrency: info-events-data-writers, queue: max
                        - live re-read, commit, data PR
```

`ndic-prep` uses `if: !cancelled() && ...` (never `always()`), so the dispatch path still
runs while the two scheduled jobs are skipped, without swallowing their failures.

## Arming and disarming

Arming is a repository **variable**, not a secret, and it is not set by this change:

```powershell
gh variable set NDIC_AUTOMATION_ENABLED --body "true"    # arm
gh variable set NDIC_AUTOMATION_ENABLED --body "false"   # disarm
gh variable delete NDIC_AUTOMATION_ENABLED               # disarm (default state)
```

`scripts/ndic-schedule-arming.mjs` accepts only the exact literal `true` (trimmed,
case-insensitive). `1`, `yes`, `on` and `enabled` do **not** arm automation. A missing
variable, a `false` value, or an unreadable run list all resolve to *skip with success*:
the run ends green without reaching the NDIC network.

## Duplicate-run suppression

Two independent guards, no whole-workflow lock:

1. `schedule-gate` queries the GitHub API for other `in_progress` runs of
   `update-ndic-datex-v1.yml` (excluding itself) and skips with `DUPLICATE_RUN_IN_PROGRESS`.
2. `ndic-prep` holds the NDIC-only concurrency group `ndic-datex-v1-internal-staging` with
   `cancel-in-progress: false`, so a manual dispatch overlapping a scheduled run queues
   instead of producing a second concurrent NDIC network job.

A workflow-level `concurrency` block is deliberately **absent**: it would queue the gate
job itself and defeat the early skip, and it must never be the shared
`info-events-data-writers` group, which would block CHMI and info-events writers behind
NDIC network work.

## Inline preflight and attestation

The scheduled path cannot reuse the standalone `NDIC staging preflight` workflow, because a
cron run has no operator to dispatch it first. `scheduled-preflight` therefore runs the same
offline suite on `ubuntu-latest` with **no `IU_NDIC_*` secrets and no NDIC network**, then
publishes the HEAD-bound short-lived attestation for `github.sha` from within the same run.

`scripts/ndic-verify-preflight-attestation.mjs` accepts attestations published by either
workflow name:

- `NDIC staging preflight` (standalone phase 1, manual path)
- `Update NDIC DATEX v1` (inline scheduled preflight)

Everything else about the trust model is unchanged: exact HEAD binding, TTL expiry, run
conclusion check, and verification strictly before any NDIC secret is exposed.

## Runner expectations

The Czech egress runner is expected to be **continuously online**. There is no ephemeral
VPS start/stop step in normal scheduled operation, and there is no GitHub-hosted fallback:
if the runner is offline, `ndic-prep` simply waits and eventually times out. `runs-on` is a
static label list — a dynamic `runs-on` expression that could fall back to `ubuntu-latest`
is rejected by the fixtures.

## Manual break-glass

`workflow_dispatch` is unchanged and remains the operator path:

- `mode: off | shadow | active` (default `off`)
- `preflight_attestation_id`: optional exact `aid=...`; empty accepts the newest valid
  attestation for HEAD

For a manual `active` run, dispatch `NDIC staging preflight` for the exact HEAD first, then
dispatch this workflow.

## Guards

| Script | Purpose |
| --- | --- |
| `scripts/ndic-automatic-schedule-fixtures.mjs` | Scenarios A–L: arming, inline preflight, HEAD binding, runner binding, duplicate skip, writer-lock scope, data PR contract |
| `scripts/ndic-automatic-schedule-meta-fixtures.mjs` | Mutation tests: removing the arming gate, removing the inline preflight, adding NDIC secrets to the GitHub-hosted preflight, `cancel-in-progress: true`, ubuntu on `ndic-prep`, etc. must all FAIL |
| `scripts/ndic-staging-preflight-architecture-fixtures.mjs` | Trigger allowlist, cron value, ubuntu-only-on-schedule-jobs, job graph |
| `scripts/ndic-datex-v1-concurrency-fixtures.mjs` | Safe schedule contract + narrow shared writer lock |
| `scripts/ndic-self-hosted-runner-contract-guard.mjs` | GitHub-hosted jobs may never hold NDIC capability |
