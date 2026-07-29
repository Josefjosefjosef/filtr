# InfoUzel — Aggregation Architecture

**Status:** production (post media removal, 2026-07)  
**Related audits:** `AUDIT_MEDIA_AGGREGATION_REMOVAL.md`, `AUDIT_FINAL_AGGREGATOR_CLEANUP.md`

## Purpose

One **source-neutral** aggregation engine serves:

- public / official institutions (e.g. ČHMÚ CAP),
- future approved connectors (open data, APIs, RSS/Atom),
- future individually approved media — **never** by restoring the removed commercial media stack.

The engine is **not** limited to state institutions and does **not** ban `sourceType=media` at the model level.

## Primary product path (live)

```
Source registry (info_events)
  → connector (CAP / RSS / HTML / API)
  → fetch + validation (timeouts, size, SSRF gates)
  → normalize → stable id + dedupe
  → projects/data/info_events/{feed,lanes,manifest,monitoring}.json
  → assets/iu-info-system-core-v1.js + iu-prehled-dne-ui-v1.js (local-first)
```

| Component | Path |
|-----------|------|
| Refresh | `scripts/iu-info-events-refresh.mjs` |
| Libraries | `scripts/iu-info-events-lib.mjs`, `scripts/iu-info-events-v2.mjs` |
| Legal whitelist | `projects/data/info_events/legal_source_registry.json` |
| Source registry | `projects/data/info_events/source_registry.json` |
| Cutover | `projects/data/info_events/cutover_state.json` |
| Cron | `.github/workflows/update-info-events.yml` |

## ČHMÚ CAP v2

Specialized connector + revision graph; **not** part of the removed commercial RSS stack.

| Component | Path |
|-----------|------|
| Engine | `scripts/chmi-cap-v2/**` |
| Prod sync | `scripts/chmi-cap-v2-prod-sync.mjs` |
| Cron | `.github/workflows/update-chmi-cap-v2.yml` (`*/15`) |
| State | `projects/data/info_events/chmi_cap_v2/**` |

When CAP v2 mode is `active`, CHMI items in `info_events` come from this path.

## Dormant universal ingest (kept, not publishing media)

Legacy **article ingest scripts** remain as a reusable fetch/normalize/publish toolkit over an **empty** registry. They must **not** publish commercial media.

| Component | Path | Production behaviour |
|-----------|------|----------------------|
| Build | `scripts/build_articles.py` | No active feeds |
| Registry | `projects/data/source_registry.json` | `entries: []` |
| Config | `config/sources.json` | `sources: []` |
| Workflows | `update-articles*.yml` | Cutover gate → SKIP |
| Watchdog | `cloudflare/articles-watchdog` | `skip_cutover` |
| Empty stubs | `articles.json`, pool, chunks, bootstrap | Empty, still deployed for SW/compat |

**Do not** re-enable via `commercialAggregationActive=true` without a dedicated PR + deny-list update + legal review.

## Shared data model (neutral)

Items should carry (names may match existing fields):

`sourceId`, `sourceLabel`, `item`/`event` type, `title`, `url`/`canonicalUrl`, `publishedAt`, `updatedAt`, `status`, region/locality, severity (alerts), rights/attribution, `retrievedAt`.

Do **not** assume every item is a news article.

## Source legal profile

Each production source requires legal registry approval (`APPROVED_*`), license URL, field allowlist, and commercial/automation flags as documented in `docs/info-system-v1/12-legal-whitelist-audit.md`.

## Adding a new source (future)

1. Technical connector (prefer official RSS/Atom/API/open data).  
2. Legal review → `legal_source_registry.json`.  
3. Shadow mode + tests + monitoring.  
4. Production activate in `source_registry` / connector config.  
5. If the source was on the **removed media deny-list**, update the deny-list and guard in the **same** PR.  
6. Never restore deleted commercial registries or frozen article shards.

## Deactivation / rollback

- Deactivate source in registry / cutover flags.  
- Code rollback ≠ media re-activation.  
- Tag baseline: `pre-aggregator-stable-20260717`.  
- Query: `?iuInfoSystem=off` only affects UI; sync stays off while `commercialAggregationActive=false`.

## Cache / local-first / PWA

- SW: versioned app/data caches + durable `iu-feed-offline-v2`.  
- Info events prefs: `iu.infoEvents.*` localStorage (read/saved/hidden/views).  
- Article in-memory store is session-only; commercial shards must not return.

## Regression guard

`npm run removed-media-regression-guard` — forbids:

- non-empty commercial `config/sources.json` / active registry entries,
- published media articles,
- return of `latest_valid_*` snapshots / daily `articles/YYYY-MM-DD.json` / `data/media.json`,
- `commercialAggregationActive !== false`.

Does **not** forbid future `sourceType=media` in general.

## Directory map

```
projects/data/info_events/     # live public aggregation
scripts/chmi-cap-v2/           # CHMI connector
scripts/iu-info-events-*.mjs   # public engine
scripts/build_articles.py      # dormant universal ingest toolkit
config/removed_media_deny_list.json
docs/info-system-v1/
docs/archive/media-aggregator/ # historical reports only
AGGREGATION_ARCHITECTURE.md    # this file
```

## Security

Keep CSP, sanitization, URL/SSRF gates, size/timeouts, Actions least privilege, secrets hygiene. Cleanup must not bypass validation wrappers.
