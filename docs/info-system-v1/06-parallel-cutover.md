# Paralelní provoz a cutover

## Rozhodnutí

48hodinový paralelní provoz **nebyl** součástí tohoto nasazení (dle zadání).

Provedeno **jednorázové atomické přepnutí** (`cutover_state.json`: `commercialAggregationActive=false`, `infoSystemActive=true`).

## Kill switch staré agregace

- `update-articles.yml` / `update-articles-fast-pool.yml` — pipeline gate SKIP při cutover
- Cloudflare articles-watchdog — `decideWatchdog` → `skip_cutover`
- UI — HomeCards + komerční `#feed` skryty CSS cutoverem

## Rollback

- `?iuInfoSystem=off`
- tag `pre-aggregator-stable-20260717` (`5647bb3f…`)
- obnovit `commercialAggregationActive: true` v cutover_state + redeploy watchdog
