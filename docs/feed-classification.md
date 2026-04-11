# Feed classification (media hub) — source of truth

## Authoritative output

- **Pipeline:** `scripts/iu_feed_classification.py` runs during `scripts/build_articles.py` publish (`enrich_article_list` before writing JSON).
- **Per-article field:** `iuFeedClassification` (only when classification succeeds):
  - `v` — schema version (`1`)
  - `mediaTopicKey` — canonical hub bucket: `zpravy` | `sport` | `finance` | `zdravi` | `cestovani` | `hry` | `kultura` | `veda` | `vzdelavani` | `tech` | `bydleni`
  - `reason` — deterministic reason code (e.g. `topic_field`, `tech_source_list`)
  - `confidence` — `0..1`
  - `railSectionKey` — copy of `topic`/`section` for audit

## Root JSON

- `feedClassificationSchemaVersion`: `1`
- `feedClassificationSource`: `iu_feed_classification.py`

## Frontend

- `assets/app.js` — `iuArticleMatchesMediaTopicKey` **prefers** `iuFeedClassification` when `v === 1`, `confidence >= 0.5`, and `mediaTopicKey` is set.
- Legacy URL/source heuristics run **only** when classification is absent or below confidence (backward compatibility).

## Guards

- Low-confidence paths still emit a key; frontend threshold (`>= 0.5`) can defer to legacy.
- Tech / bydlení / cestování use the same priority order as the previous client checks, implemented server-side.

## Audit

```bash
node scripts/audit-feed-classification.mjs
python scripts/test_iu_feed_classification.py
```
