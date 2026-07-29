# Article Pipeline Decoupled Artifact — Phase 3C Report

## Why Phase 3C exists

Phase 3B introduced **observable** separation of ingest/aggregate success from release/publish outcomes via `article_pipeline_phase_status.json`. However, when a release guard (e.g. Hry freshness) failed, operators still had to infer whether the clean pool survived — the workflow run showed **FAIL** with no durable, downloadable bundle of ingest+aggregate success independent of the release job.

Phase 3C makes ingest+aggregate success **durable and retrievable** even when the release job fails on a guard.

## What changes

1. **`scripts/iu_article_pipeline_decoupled_artifact.py`**
   - Builds `ingest-aggregate-success` artifact tree: pool manifest, phase status, ingest/aggregate summaries, bundle manifest with `pipelineRunId`, `commitSha`, `branch`, `generatedAt`.

2. **`.github/workflows/update-articles.yml`**
   - **Aggregate job:** build + `upload-artifact` after successful aggregate (before release job runs).
   - **Release job:** `finalize-release` and `push-release-telemetry` with `if: always()`; upload phase status artifact.

3. **`scripts/pipeline_handoff_git.py`**
   - New `push-release-telemetry`: overlays release outcome telemetry onto git handoff **without** changing aggregate checkpoint.

4. **`scripts/iu_article_pipeline_phase_status.py`**
   - GitHub summary shows `PIPELINE_ARTIFACTS_PERSISTED`; short status tokens (`INGEST_STATUS=OK`, etc.).

5. **Proof + this report.**

## What does NOT change

- Publish output (`articles.json`, bootstrap, index)
- Release guard logic or exit codes (Hry guard still fails release job)
- Freshness guard, continuous-update-guard, dedupe, event dedupe, section classification
- Homepage, RSS rotation, scheduler behavior
- Full publish workflow decoupling (Phase 3D)

`INGEST_PUBLISH_DECOUPLING_ACTIVE=PARTIAL` — artifacts and telemetry persist; release job still fails on guards.

## Workflow fail vs ingest success

| Outcome | Workflow job status | Ingest/aggregate truth |
| --- | --- | --- |
| Guard blocks release | `article_data_release` **FAIL** | **OK** — visible in phase status + artifacts |
| Ingest fails | ingest job FAIL | INGEST_FAIL — no aggregate artifact |
| Aggregate fails | aggregate job FAIL | AGGREGATE_FAIL — no success artifact |

A red workflow run does **not** mean ingest/aggregate failed when `RELEASE_STATUS=BLOCKED` and `PIPELINE_ARTIFACTS_PERSISTED=YES`.

## Where durable artifacts live

| Store | Path / name | When written |
| --- | --- | --- |
| Git handoff branch | `automation/pipeline-handoff` → `staging/article_pool_manifest.json`, `staging/article_pipeline_phase_status.json`, `aggregate/aggregated_checkpoint.json` | push-aggregate; release telemetry overlay on push-release-telemetry |
| GitHub Actions artifact | `ingest-aggregate-success-{run_id}` | aggregate job (survives release fail) |
| GitHub Actions artifact | `pipeline-phase-status-{run_id}` | release job `if: always()` |
| Local staging (gitignored) | `projects/data/staging/` | during pipeline phases |

Primary cross-run source-of-truth remains **git handoff**. Workflow artifacts are operator-friendly snapshots.

## How to verify pool was not lost

1. Download `ingest-aggregate-success-{run_id}` from the workflow run (aggregate job).
2. Check `article_pool_manifest.json` → `total_clean_pool`, `ready_for_release_count`.
3. Check `article_pipeline_phase_status.json` → `clean_pool_status: CLEAN_POOL_CREATED`, `ingest_status: INGEST_OK`.
4. On handoff branch: `git show origin/automation/pipeline-handoff:pipeline-handoff/staging/article_pool_manifest.json`.
5. Confirm `aggregate/aggregated_checkpoint.json` unchanged after `push-release-telemetry`.

## Example: RELEASE_BLOCKED scenario

1. Ingest OK → staging pushed to handoff.
2. Aggregate OK → checkpoint + pool manifest + phase status pushed; **ingest-aggregate-success artifact uploaded**.
3. Publish runs locally in release job; Hry freshness guard fails → release job **FAIL**.
4. `finalize-release` records `RELEASE_BLOCKED`, `PUBLISH_SKIPPED`; ingest/aggregate fields preserved.
5. `push-release-telemetry` updates handoff phase status only.
6. GitHub summary:

| Phase | Status |
| --- | --- |
| INGEST | OK |
| AGGREGATE | OK |
| POOL | CREATED |
| RELEASE | BLOCKED |
| PUBLISH | SKIPPED |
| PIPELINE_ARTIFACTS_PERSISTED | YES |

## Proofs

```bash
py -3 scripts/article_pipeline_decoupled_artifact_proof.py
py -3 scripts/article_pipeline_phase_status_proof.py
py -3 scripts/article_pool_manifest_proof.py
```

Full battery per Phase 3C task list (smoke, rotation, scheduler, guards).

## Risks

- **Artifact retention (30 days):** older runs lose GitHub artifact; git handoff remains.
- **Handoff race:** stale release telemetry skip if aggregate run id mismatch (CAS safe).
- **Partial decoupling:** release job still fails; no automatic publish from blocked pool until Phase 3D.

## Phase 3D (next)

- Promote clean pool to release path independently of synchronous guard timing in same job
- Optional async publish workflow consuming handoff + phase status contract
- Alerting/metrics on `RELEASE_BLOCKED` without workflow-level false ingest failure
