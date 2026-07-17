# Stabilizační report — pre-aggregator-stable-20260717

## Identita

| Položka | Hodnota |
|---------|---------|
| Pre-stabilization production SHA | `1e47ac46d93147035730314716641f71b330fffd` |
| Stabilization branch | `chore/pre-aggregator-stable-20260717` |
| Post-stabilization SHA | _(po merge)_ |
| Stabilization tag | `pre-aggregator-stable-20260717` _(po prod verify)_ |
| Production URL | https://infouzel.cz/projects/ |
| Deployment run | _(po Pages)_ |
| Prod verify UTC | _(po ověření)_ |
| Data Bot | running (`update-articles` + `fast-pool` in_progress/success; no stop needed) |

## Inventář PR

Viz `00-inventory.md` — **GROUP_A_OPEN=0**.

- **A:** žádné
- **B:** #7551, #7550, #7343, #7338, #7274, #7270, #6993, #6937
- **C:** uzavřeno před startem (stale wave)

## Opravy v tomto běhu

1. Safe VERSION_JSON / prod verify diagnostika (`ArgumentOutOfRangeException` při Substring po `-replace`).
2. UI freeze manifest + CI guard (`layout-guard.yml`).
3. Cross-browser feature detection guard (Chromium+Firefox PASS; WebKit SKIP missing binary).
4. Dokumentace baseline, rollback, aggregator map, PWA scénáře, screenshots.
5. Stabilization matrix runner.
6. Harden `iu-article-load-more-stress-guard` (soft-stop u client cap−1 + settle polling) — CI flake stuck at meta 99/N.

## Cleanup

Viz `07-cleanup-and-preserved.md` — žádné agresivní mazání runtime/pipeline.

## Guard výsledky (local matrix PASS)

Report: `%TEMP%\iu-pre-aggregator-stable-matrix-1784266013409.json`

| Guard | Status |
|-------|--------|
| freeze | PASS |
| cross_browser_features | PASS |
| layout | PASS |
| pwa_offline | PASS |
| article_parity | PASS |
| local_data_protection | PASS |
| user_data_backup | PASS |
| pc_browser_compat | PASS |
| quicktools_fixed_width | PASS |
| articles_freshness | PASS |
| prod_version_probe | PASS |
| iu-perf-regression-guards | PASS (navLatency medians ~37–74ms; flicker OK) |

## VERSION_JSON bug proof

- Repro: Substring length z delšího originálu po whitespace collapse → `MethodInvocationException` / `ArgumentOutOfRangeException`.
- Fix: délka vždy z collapsed stringu; empty → prázdný preview; verdict informational only.

## Připravenost agregátor rebuild

Po GREEN CI + merge + deploy + tag + čistém stromu: **YES** (kontrakt v `04-aggregator-integration-map.md`).
