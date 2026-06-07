# RSS Rotation Phase 2B — Runtime Activation Report

## Summary

Phase 2B activates A/B/C/D batch rotation in the article **ingest scheduler** behind kill switch `RSS_ROTATION_BATCH_RUNTIME=1`, with legacy fallback when the flag is off or the batch registry is invalid.

## What changed

| Area | Change |
| --- | --- |
| Scheduler | `select_feeds_for_tick()` batch path when flag=1 + valid registry |
| Batch selection | `batch_id = floor(minute/5) % 4` → A/B/C/D (Prague wall clock) |
| Per tick load | Full batch (~14–15 sources) instead of cap 5 |
| 15 min floor | `SKIPPED_MIN_INTERVAL_FLOOR` when last check &lt; 15 min |
| Kill switch | `RSS_ROTATION_BATCH_RUNTIME=1` (ingest job only) |
| Fallback | Missing/invalid registry → legacy fixed-slot + cap 5 |
| Watchdog | Cloudflare cron `*/15` → `*/5`, `STALE_AFTER_MINUTES` 15 → 5 |
| Workflow | `RSS_ROTATION_BATCH_RUNTIME=1` on `article_pipeline_ingest` only |

## What did NOT change

- `build_articles.py` publish logic
- Dedupe / event dedupe / section classification
- `articles.json`, `bootstrap.json`, `index.json` (no manual edits)
- Aggregate / publish job env (no batch flag)
- `MAX_SOURCES_PER_SCHEDULER_TICK` constant (still **5** for legacy mode)

## Legacy vs batch mode

| | Legacy (default) | Batch (flag=1) |
| --- | --- | --- |
| Trigger | Flag off or registry invalid | `RSS_ROTATION_BATCH_RUNTIME=1` |
| Selection | Fixed Prague slots + P0/liveness | `rotation_batch_registry.json` |
| Cap | 5 sources/tick (+ P0 exempt) | Full batch A/B/C/D |
| Full rotation | ~148 min | ~20 min |
| Skip reason (rate) | `SKIPPED_TICK_CAP`, `SKIPPED_RATE_LIMIT_15MIN` | `SKIPPED_MIN_INTERVAL_FLOOR` |

## Batch layout (59 active sources)

| Batch | Tick minute | Sources |
| --- | --- | --- |
| A | :00, :20, :40 | 15 |
| B | :05, :25, :45 | 15 |
| C | :10, :30, :50 | 14 |
| D | :15, :35, :55 | 15 |

## BEFORE / AFTER / DELTA

### BEFORE (Phase 2A baseline)

- Watchdog `*/15`
- Cap 5 sources/tick
- Full rotation ~148 min
- 51+ `SKIPPED_TICK_CAP` per typical run

### AFTER (Phase 2B with flag)

- Watchdog `*/5`
- Batch runtime active only with `RSS_ROTATION_BATCH_RUNTIME=1`
- Batches A/B/C/D, ~20 min full rotation
- Min interval per source ≥ 15 min (floor enforced)
- Legacy fallback available (flag off or bad registry)

### DELTA

- Rotation time improved ~7.4× (148 → 20 min)
- Source coverage per hour improved (~4× tick rate, ~3× sources/tick)
- `SKIPPED_TICK_CAP` expected reduced in batch mode
- No publish behavior change

## Risks

1. **Ingest duration** — ~15 fetches/tick vs 5; mitigated by Phase 2A load analysis (medium overload, ~108s).
2. **Watchdog dispatch frequency** — `STALE_AFTER_MINUTES=5` may increase workflow dispatches; pipeline gate + `skip_busy` unchanged.
3. **Cloudflare deploy** — cron change requires worker redeploy (wrangler.toml in repo only until deploy).
4. **Prague minute alignment** — batch selection uses Europe/Prague minute-of-hour (same as legacy slots).

## Proofs

| Script | Purpose |
| --- | --- |
| `rss_rotation_phase2b_runtime_activation_proof.py` | Batch vs legacy, floor, fallback, 20 min sim |
| `rss-rotation-phase2b-runtime-guard.mjs` | Workflow/env/watchdog/diff scope |
| `rss_rotation_phase2a_dry_run.py` | Pre-merge 24h dry-run baseline |
| `rss_rotation_foundation_behavior_proof.py` | Legacy unchanged without flag |
| `test_rotation_batches.py` | Registry schema |
| `test_iu_article_scheduler.py` | Legacy cap / SLA |

## Verdict

```
RSS_ROTATION_PHASE2B_RUNTIME_ACTIVATION=PASS (when all proofs green)
BATCH_RUNTIME_ACTIVE=YES (with flag)
LEGACY_FALLBACK=YES
KILL_SWITCH=YES
SAFE_FOR_PR=YES (scoped diff, no publish/dedupe change)
```

Deploy checklist after merge:

1. Merge PR
2. Deploy Cloudflare articles-watchdog (`wrangler deploy`) for `*/5` cron
3. Monitor first 24h: ingest telemetry, `SKIPPED_MIN_INTERVAL_FLOOR` rate, pipeline duration
