# Article Pool Foundation — Phase 3A Report

## Summary

Phase 3A adds **read-only pool telemetry** at the aggregate boundary without activating ingest/publish decoupling, without changing publish output, and without modifying release guards.

**Merge baseline:** PR #4991 (`d80589d99a`) — RSS batch rotation runtime active.

---

## Current ingest/publish coupling

```
ingest (RSS → staging/sources/*.json)
  → aggregate (_aggregate_pipeline → aggregated_checkpoint.json)
  → release/publish (_publish_article_outputs → articles.json + guards + PR)
```

All three jobs share concurrency group `update-articles-data-v4`. A release failure (e.g. Hry freshness guard) blocks the **entire workflow conclusion**, even when ingest and aggregate succeeded.

### Existing artifacts

| Artifact | Location | Role |
|----------|----------|------|
| Per-source staging shards | `projects/data/staging/sources/*.json` | Raw normalized ingest items (pre-dedupe) |
| Ingest manifest | `projects/data/staging/ingest_manifest.json` | Batch index (`sourceBatchKeys`, `pipelineRunId`) |
| YouTube pool | `projects/data/staging/youtube_pool.json` | Deferred video rows |
| Aggregated checkpoint | `projects/data/staging/aggregated_checkpoint.json` | **Primary article pool** (`articles_full`, `articles_final`) |
| Handoff manifest | `pipeline-handoff/manifest.json` on `automation/pipeline-handoff` | CAS: `winningIngestRunId`, `winningAggregateRunId`, `handoffEpoch` |
| Handoff staging tree | `pipeline-handoff/staging/**` | Durable ingest copy |
| Handoff aggregate | `pipeline-handoff/aggregate/aggregated_checkpoint.json` | Durable pool checkpoint |
| Topic dedupe sidecar | `projects/data/topic_dedupe_suppressed.json` | Suppressed event duplicates (aggregate-time) |
| Scheduler state | `scheduler_state.json` / handoff copy | Rotation scheduler |
| Public output | `articles.json`, `articles/index.json`, `bootstrap.json` | Publish phase only |

Today `articles_full === articles_final` (identical lists). Schema预留 future split: pool vs curated release subset.

---

## Clean article pool definition

```
clean_article_pool = articles after:
  • RSS fetch
  • normalize
  • URL dedupe
  • title dedupe (cluster_items)
  • event-level dedupe (apply_topic_event_dedupe)
  • section classification
  • quality / relevance checks
  • per-section limits + retention (aggregate caps)

but before:
  • release CI guards (freshness, missing-source, infra)
  • PR creation
  • publish writes (articles.json, bootstrap, index)
  • homepage selection
```

**Boundary in code:** end of `_aggregate_pipeline()` in `scripts/build_articles.py` — output field `articles_full`.

---

## Phase 3A implementation

### New file: `staging/article_pool_manifest.json`

Written during **aggregate** (and incremental ingest aggregate path) via `scripts/iu_article_pool.py`:

- Path: `projects/data/staging/article_pool_manifest.json` (gitignored staging tree)
- Trigger: `_emit_article_pool_manifest()` after `_aggregate_pipeline()`, before checkpoint write
- **Does not** modify `aggregated_checkpoint.json` schema or publish path

### Manifest fields

| Field | Meaning |
|-------|---------|
| `total_raw_items` | Raw feed items from telemetry / aggregate input |
| `total_normalized` | Parsed + normalized ingest items |
| `total_after_url_dedupe` | Post URL-priority dedupe count |
| `total_after_event_dedupe` | Post full aggregate pipeline (= clean pool size today) |
| `total_clean_pool` | `len(articles_full)` |
| `per_section_counts` / `per_source_counts` | Pool composition |
| `duplicate_counts` | URL drops, cluster drops, event suppressions |
| `ready_for_release_count` | `len(articles_final)` (today == clean pool) |
| `blocked_by_release_guard_count` | **0 at pool boundary** (guards run in publish job) |
| `reason_if_not_released` | `release_guards_evaluated_in_separate_publish_job` |

---

## Where release fails today (pre-existing)

| Guard | Failure mode | Blocks |
|-------|--------------|--------|
| `infra-guard` | Section **Hry** newest article >168h on production | PR CI |
| `continuous-update-guard` | Pipeline failure streak on `update-articles.yml` | PR CI |
| Release job guards | Same Hry freshness inside `article_data_release` | Workflow completion |

These failures occur **after** the clean pool exists in `aggregated_checkpoint.json`. Ingest batch rotation (Phase 2B) can succeed while release still fails.

---

## Why release fail must not block future ingest (Phase 3B rationale)

1. **Pool is durable** — `pipeline-handoff/aggregate/aggregated_checkpoint.json` persists independently of publish success.
2. **Ingest is time-critical** — batch rotation requires */5 cadence; blocking ingest on stale Hry punishes unrelated sections.
3. **Guards are publish-quality gates** — they validate public `articles.json`, not the existence of fresh staging.
4. **Phase 3A observability** — `article_pool_manifest.json` makes pool health visible even when release is red.

Phase 3B (not started) would:
- Split workflow success criteria per phase
- Allow ingest+aggregate green while release is deferred
- Relocate or scope release guards to publish-only job
- Optionally split `articles_final` from `articles_full` for curated release

---

## Risks

| Risk | Mitigation (3A) |
|------|-----------------|
| Manifest write breaks aggregate | Wrapped in try/except; checkpoint write unchanged |
| Accidental publish change | Manifest is separate file; `_checkpoint_bundle_for_disk` strips `_pool_stage` |
| False sense of decoupling | `ingest_publish_decoupling_active: false` in manifest |
| Production data mutation | Manifest under gitignored `staging/` only |

---

## Proofs

| Proof | Purpose |
|-------|---------|
| `scripts/article_pool_manifest_proof.py` | Manifest schema, persistence, publish/dedupe unchanged |
| `npm run smoke` | Repo regression |
| Phase 2B proofs | Batch rotation unchanged |
| Existing scheduler tests | Scheduler unchanged |

---

## Explicit verdict (Phase 3A)

```
ARTICLE_POOL_FOUNDATION=PASS (after proofs)
FOUNDATION_ONLY=YES
INGEST_PUBLISH_DECOUPLING_ACTIVE=NO
CLEAN_ARTICLE_POOL_DEFINED=YES
POOL_MANIFEST_CREATED=YES
PUBLISH_OUTPUT_CHANGE=NO
RELEASE_GUARD_CHANGE=NO
DEDUPE_CHANGE=NO
EVENT_DEDUPE_CHANGE=NO
SECTION_CLASSIFICATION_CHANGE=NO
HOMEPAGE_CHANGE=NO
ARTICLES_JSON_MANUAL_CHANGE=NO
BOOTSTRAP_MANUAL_CHANGE=NO
INDEX_MANUAL_CHANGE=NO
SAFE_FOR_PHASE3B=YES
```

---

## Files changed (Phase 3A)

| File | Change |
|------|--------|
| `scripts/iu_article_pool.py` | **New** — manifest builder/writer |
| `scripts/build_articles.py` | Additive `_pool_stage` metadata + `_emit_article_pool_manifest()` hook |
| `scripts/iu_staging.py` | Docstring note |
| `scripts/article_pool_manifest_proof.py` | **New** — proof |
| `ARTICLE_POOL_FOUNDATION_REPORT.md` | **New** — this report |

**Not changed:** publish logic, dedupe, event dedupe, section classification, homepage, release guards, production article data.
