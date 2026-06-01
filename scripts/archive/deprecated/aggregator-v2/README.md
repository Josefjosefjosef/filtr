# DEAD_CODE — Aggregator V2 (archived 2026-06-01)

**Not used in production.** infoUzel article pipeline V3 is:

- `scripts/build_articles.py` via `.github/workflows/update-articles.yml`
- Cloudflare `articles-watchdog` → `workflow_dispatch` only (no GitHub schedule on update-articles)

These files wrote to `filtr/data/` (legacy layout), **not** `projects/data/`. They do not run topic dedupe, source rotation, or `iu_crawler` ethics.

Do not wire back into workflows. For historical reference only.
