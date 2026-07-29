# Article Pipeline Phase Status — Phase 3B Report

## Problem (current state before Phase 3B)

A single `update-articles` workflow run can report **FAIL** even when ingest and aggregate completed successfully. The release job runs publish locally, then executes many release guards (including the pre-existing **Hry** freshness guard and `continuous-update-guard` pipeline streak). When a guard fails, the entire run looks like a pipeline failure — obscuring that RSS ingest, aggregate, and the clean article pool were produced correctly.

This is incorrect for future architecture: ingest success and release failure are different outcomes and must be visible separately.

## New phase status model

Additive telemetry manifest:

`projects/data/staging/article_pipeline_phase_status.json`

### Canonical status tokens

| Field | Values |
| --- | --- |
| `ingest_status` | `INGEST_OK`, `INGEST_FAIL` |
| `aggregate_status` | `AGGREGATE_OK`, `AGGREGATE_FAIL` |
| `clean_pool_status` | `CLEAN_POOL_CREATED`, `CLEAN_POOL_MISSING` |
| `release_status` | `RELEASE_OK`, `RELEASE_BLOCKED`, `RELEASE_FAIL` |
| `publish_status` | `PUBLISH_OK`, `PUBLISH_SKIPPED`, `PUBLISH_FAILED` |

### Manifest fields

- `generatedAt`, `pipelineRunId`, `commitSha`, `branch`
- Phase statuses above
- `release_blocked_by`, `release_blocked_reason`, `guard_name`, `guard_exit_code`
- `clean_pool_count`, `articles_full_count`, `articles_final_count`, `ready_for_release_count`
- `was_publish_attempted`, `was_pr_created`

## What changes

1. **`scripts/iu_article_pipeline_phase_status.py`** — build, merge, read, write phase status; CLI `finalize-release` for release job.
2. **`scripts/build_articles.py`** — additive hooks after ingest, aggregate, and publish attempt (no change to `_publish_article_outputs` body).
3. **`scripts/pipeline_handoff_git.py`** — handoff carries `article_pipeline_phase_status.json` and `article_pool_manifest.json` across jobs.
4. **`.github/workflows/update-artarticles.yml`** — `if: always()` step records release outcome and appends GitHub summary table; **does not change guard exit codes**.
5. **`scripts/article_pipeline_phase_status_proof.py`** — automated proof.
6. This report.

## What does NOT change

- Publish output (`articles.json`, bootstrap, index)
- Release guard logic or exit codes
- Freshness / Hry guard behavior
- Dedupe, event dedupe, section classification
- Homepage selection
- Scheduler rotation
- Manual edits to articles data

`INGEST_PUBLISH_DECOUPLING_ACTIVE=NO` — this is reporting foundation only, not full workflow decoupling.

## Example: release blocked, pool preserved

When ingest + aggregate + clean pool succeed but the Hry freshness guard fails:

```json
{
  "ingest_status": "INGEST_OK",
  "aggregate_status": "AGGREGATE_OK",
  "clean_pool_status": "CLEAN_POOL_CREATED",
  "release_status": "RELEASE_BLOCKED",
  "publish_status": "PUBLISH_SKIPPED",
  "release_blocked_by": "release_guard",
  "guard_name": "Articles aggregator freshness guard (bundle + main sections)",
  "guard_exit_code": 1,
  "release_blocked_reason": "section Hry stale >168h",
  "clean_pool_count": 142,
  "was_publish_attempted": true,
  "was_pr_created": false
}
```

GitHub summary (short labels):

| Phase | Status |
| --- | --- |
| INGEST | OK |
| AGGREGATE | OK |
| POOL | CREATED |
| RELEASE | BLOCKED |
| PUBLISH | SKIPPED |

The release job still **fails** (guard exit code unchanged). Phase status makes the partial success explicit.

## Why this is the foundation for Phase 3C

Phase 3C can use the phase status manifest as the contract for:

- Promoting clean pool to release independently of guard timing
- Alerting on `RELEASE_BLOCKED` without treating ingest as failed
- Metrics on guard block rate vs ingest health

Phase 3B does not implement decoupled release — only observable separation.

## Proofs

Run:

```bash
py -3 scripts/article_pipeline_phase_status_proof.py
```

Also run the full Phase 3B proof battery (smoke, rotation, pool manifest, etc.) before merge.

## Risks

| Risk | Mitigation |
| --- | --- |
| Stale phase status on handoff race | Same CAS handoff as pool manifest; aggregate overlays local telemetry |
| Mis-read as “publish failed” when guard blocked | `PUBLISH_SKIPPED` + `was_publish_attempted` distinguish local publish vs production release |
| Accidental guard bypass | `finalize-release` runs with `if: always()` after guards; never alters guard steps |
| Workflow summary noise | Summary is additive table only |

## Verdict flags (expected after proof)

```
ARTICLE_PIPELINE_PHASE_STATUS=PASS
PHASE_STATUS_MANIFEST_CREATED=YES
INGEST_RELEASE_STATUS_SEPARATED=YES
INGEST_PUBLISH_DECOUPLING_ACTIVE=NO
PUBLISH_OUTPUT_CHANGE=NO
RELEASE_GUARD_CHANGE=NO
FRESHNESS_GUARD_BYPASSED=NO
HRE_GUARD_BYPASSED=NO
SAFE_FOR_PHASE3C=YES
```
