# Feed classification (media hub) — source of truth

## Authoritative output

- **Pipeline:** `scripts/iu_feed_classification.py` runs during `scripts/build_articles.py` publish (`enrich_article_list` before writing JSON).
- **Per-article field:** `iuFeedClassification` (only when classification succeeds):
  - `v` — schema version (`1`)
  - `mediaTopicKey` — canonical hub bucket: `zpravy` | `sport` | `finance` | `zdravi` | `cestovani` | `hry` | `kultura` | `veda` | `vzdelavani` | `tech` | `bydleni`
  - `reason` — deterministic reason code (e.g. `topic_field`, `tech_source_list`)
  - `confidence` — `0..1`
  - `railSectionKey` — copy of `topic`/`section` for audit
  - `guardFlags` — optional list (e.g. `topic_url_conflict` when URL vertical overrides mismatched RSS topic)

## Root JSON

- `feedClassificationSchemaVersion`: `1`
- `feedClassificationSource`: `iu_feed_classification.py`
- `feedClassificationCoveragePct` — percent of articles with valid `iuFeedClassification`
- `feedClassificationRequired` — `true` when every article in the payload has valid classification (build sets this when coverage is complete)

## Frontend

- `assets/app.js` — `iuArticleMatchesMediaTopicKey` **prefers** `iuFeedClassification` when `v === 1`, `confidence >= 0.5`, and `mediaTopicKey` is set.
- When `feedClassificationRequired` is true (or schema `1` with coverage ≥ 99%), the client treats the pipeline as authoritative: missing/low-confidence rows fall back to **Zprávy-only** visibility, not legacy heuristics.
- Legacy URL/source heuristics run **only** when the pipeline is not required and classification is absent or below confidence.

## Guards

- Low-confidence paths still emit a key; frontend threshold (`>= 0.5`) can defer to legacy.
- Tech / bydlení / cestování use the same priority order as the previous client checks, implemented server-side.

## Audit

```bash
node scripts/audit-feed-classification.mjs
python scripts/test_iu_feed_classification.py
# CI / legacy JSON on disk: apply same enrich as build, then measure coverage
python scripts/validate_feed_classification.py --skip-missing --enrich
# On-disk only (after full build wrote iuFeedClassification into articles.json):
python scripts/validate_feed_classification.py --articles projects/data/articles.json
```
