# RSS ROTATION PHASE 2A — DRY-RUN REPORT

> Generated: 2026-06-07T21:59:37Z
> DRY-RUN SIMULATION ONLY — no production behavior change

## A) Executive summary

- **Dry-run verdict:** PASS
- **Safe for Phase 2B:** YES
- Simulated **288** ticks over **24h** (5-min cadence)
- **72** full A/B/C/D rotations (target **20 min** cycle)
- All **59** active sources assigned; interval floor **≥15 min** — **PASS**
- Current model full rotation **~148 min** → dry-run **20 min** (**7.4×** faster)

## B) Současný model

| Metrika | Hodnota |
|---------|---------|
| Watchdog | */15 |
| MAX_SOURCES_PER_SCHEDULER_TICK | 5 |
| Effective selected/tick | 6 |
| SKIPPED_TICK_CAP (last run) | 51 |
| Full rotation (est.) | ~148 min |
| Not fetched 24h | 52 sources |
| Coverage/hour (est.) | 24.0 fetch slots |

## C) Dry-run cílový model

| Metrika | Hodnota |
|---------|---------|
| Tick interval | 5 min |
| Batches | A (:00) / B (:05) / C (:10) / D (:15) |
| Sources per tick (avg) | ~14.8 |
| Full rotation | 20 min |
| SKIPPED_TICK_CAP | 0 |
| Checks per source / 24h | 72 |

## D) Simulace 24h rotace

| Metrika | Hodnota |
|---------|---------|
| Total ticks | 288 |
| Full rotations | 72 |
| Min interval violations | 0 |
| Duplicate in 20min cycle | 0 |
| Cycles with missing sources | 0 |
| Global min interval | 20 min |
| Global max interval | 20 min |
| Global avg interval | 20.0 min |

### Sample tick schedule

| Tick | Clock | Batch | Sources |
|------|-------|-------|---------|
| 0 | 00:00 | A | 15 |
| 1 | 00:05 | B | 15 |
| 2 | 00:10 | C | 14 |
| 3 | 00:15 | D | 15 |
| 4 | 00:20 | A | 15 |
| 5 | 00:25 | B | 15 |
| 6 | 00:30 | C | 14 |
| 7 | 00:35 | D | 15 |
| 284 | 23:40 | A | 15 |
| 285 | 23:45 | B | 15 |
| 286 | 23:50 | C | 14 |
| 287 | 23:55 | D | 15 |

## E) Per-source intervaly

| Source | Checks/24h | Min | Max | Avg |
|--------|------------|-----|-----|-----|
| `ces_cestujlevne` | 72 | 20 | 20 | 20.0 |
| `ces_novinky_cestovani` | 72 | 20 | 20 | 20.0 |
| `ces_pelipecky` | 72 | 20 | 20 | 20.0 |
| `ces_svetcestovatele` | 72 | 20 | 20 | 20.0 |
| `ces_travelbible` | 72 | 20 | 20 | 20.0 |
| `fin_e15` | 72 | 20 | 20 | 20.0 |
| `fin_ekonom` | 72 | 20 | 20 | 20.0 |
| `fin_ekonomickydenik` | 72 | 20 | 20 | 20.0 |
| `fin_epenize` | 72 | 20 | 20 | 20.0 |
| `fin_faei` | 72 | 20 | 20 | 20.0 |
| `fin_hn` | 72 | 20 | 20 | 20.0 |
| `fin_idnes_ekonomika` | 72 | 20 | 20 | 20.0 |
| `fin_novinky_ekonomika` | 72 | 20 | 20 | 20.0 |
| `fin_penize` | 72 | 20 | 20 | 20.0 |
| `fin_sz_byznys` | 72 | 20 | 20 | 20.0 |
| `hry_indian` | 72 | 20 | 20 | 20.0 |
| `hry_nedd` | 72 | 20 | 20 | 20.0 |
| `hry_novinky` | 72 | 20 | 20 | 20.0 |
| `hry_sector` | 72 | 20 | 20 | 20.0 |
| `hry_vortex` | 72 | 20 | 20 | 20.0 |
| `hry_zing` | 72 | 20 | 20 | 20.0 |
| `kul_ctart` | 72 | 20 | 20 | 20.0 |
| `kul_kinobox` | 72 | 20 | 20 | 20.0 |
| `kul_vipzivot` | 72 | 20 | 20 | 20.0 |
| `kul_vlasta` | 72 | 20 | 20 | 20.0 |
| `kul_vtelce` | 72 | 20 | 20 | 20.0 |
| `spt_crzpravy_sport` | 72 | 20 | 20 | 20.0 |
| `spt_ctsport` | 72 | 20 | 20 | 20.0 |
| `spt_idnes` | 72 | 20 | 20 | 20.0 |
| `spt_isport` | 72 | 20 | 20 | 20.0 |
| `spt_mmamag` | 72 | 20 | 20 | 20.0 |
| `spt_sportcz` | 72 | 20 | 20 | 20.0 |
| `spt_tenisportal` | 72 | 20 | 20 | 20.0 |
| `ved_ct24_veda` | 72 | 20 | 20 | 20.0 |
| `ved_novinky` | 72 | 20 | 20 | 20.0 |
| `ved_technet` | 72 | 20 | 20 | 20.0 |
| `ved_vtm` | 72 | 20 | 20 | 20.0 |
| `vzd_betterlife` | 72 | 20 | 20 | 20.0 |
| `vzd_nespechej` | 72 | 20 | 20 | 20.0 |
| `vzd_novinky_skola` | 72 | 20 | 20 | 20.0 |
| `vzd_seznam` | 72 | 20 | 20 | 20.0 |
| `zdr_betterlife` | 72 | 20 | 20 | 20.0 |
| `zdr_plnezdravi` | 72 | 20 | 20 | 20.0 |
| `zdr_prozeny_zdravi` | 72 | 20 | 20 | 20.0 |
| `zdr_zdrave` | 72 | 20 | 20 | 20.0 |
| `zdr_zdravezpravy` | 72 | 20 | 20 | 20.0 |
| `zdr_zdravotnickydenik` | 72 | 20 | 20 | 20.0 |
| `zpr_aktualne` | 72 | 20 | 20 | 20.0 |
| `zpr_ceskajustice` | 72 | 20 | 20 | 20.0 |
| `zpr_ct24_domaci` | 72 | 20 | 20 | 20.0 |
| `zpr_ct24_svet` | 72 | 20 | 20 | 20.0 |
| `zpr_denik` | 72 | 20 | 20 | 20.0 |
| `zpr_hlidacipes` | 72 | 20 | 20 | 20.0 |
| `zpr_idnes_zpravy` | 72 | 20 | 20 | 20.0 |
| `zpr_kverulant` | 72 | 20 | 20 | 20.0 |
| `zpr_novinky_domaci` | 72 | 20 | 20 | 20.0 |
| `zpr_novinky_zahranicni` | 72 | 20 | 20 | 20.0 |
| `zpr_seznam_domaci` | 72 | 20 | 20 | 20.0 |
| `zpr_tydenikpolicie` | 72 | 20 | 20 | 20.0 |

## F) Per-batch load analýza

### Batch A

- Sources: **15** (STRONG=5, MEDIUM=5, WEAK=5)
- P0/P1/P2: {'P0': 5, 'P1': 4, 'P2': 6}
- estimated_rss_load: **250**
- source_weight_sum: 13.9
- expected_run_sec: 108 | load_score: 253.8 | risk: **medium**

### Batch B

- Sources: **15** (STRONG=5, MEDIUM=6, WEAK=4)
- P0/P1/P2: {'P0': 5, 'P1': 5, 'P2': 5}
- estimated_rss_load: **255**
- source_weight_sum: 13.75
- expected_run_sec: 108 | load_score: 256.2 | risk: **medium**

### Batch C

- Sources: **14** (STRONG=5, MEDIUM=5, WEAK=4)
- P0/P1/P2: {'P0': 4, 'P1': 2, 'P2': 8}
- estimated_rss_load: **255**
- source_weight_sum: 12.9
- expected_run_sec: 100 | load_score: 256.5 | risk: **medium**

### Batch D

- Sources: **15** (STRONG=5, MEDIUM=5, WEAK=5)
- P0/P1/P2: {'P0': 6, 'P1': 3, 'P2': 6}
- estimated_rss_load: **255**
- source_weight_sum: 13.75
- expected_run_sec: 108 | load_score: 256.5 | risk: **medium**

## G) Strong/P0 rozložení

### P0 headline distribution

- **Batch A:** zpr_seznam_domaci
- **Batch B:** zpr_novinky_domaci, zpr_novinky_zahranicni
- **Batch C:** zpr_idnes_zpravy
- **Batch D:** zpr_ct24_domaci, spt_sportcz

### STRONG distribution

- **Batch A:** 5 — zpr_seznam_domaci, zpr_ct24_svet, fin_novinky_ekonomika, hry_novinky, vzd_novinky_skola
- **Batch B:** 5 — zpr_novinky_domaci, zpr_novinky_zahranicni, fin_sz_byznys, ved_novinky, zpr_denik
- **Batch C:** 5 — zpr_idnes_zpravy, spt_isport, spt_ctsport, fin_idnes_ekonomika, spt_idnes
- **Batch D:** 5 — zpr_ct24_domaci, spt_sportcz, ved_ct24_veda, vzd_seznam, zpr_aktualne

## H) Rizika

- No hard blockers in rotation simulation
- **WARNING:** dry-run fetches 3×+ more sources per tick than current cap=5 — requires cap/workflow change in Phase 2B
- **WARNING:** batches with medium/high overload risk: A, B, C, D

## I) Doporučení před Phase 2B

1. **Workflow/Cloudflare:** změnit watchdog z `*/15` na `*/5` (vyžaduje explicitní Phase 2B PR).
2. **Scheduler cap:** zvýšit `MAX_SOURCES_PER_SCHEDULER_TICK` z 5 na ~15–16 (samostatný guarded PR).
3. **Ingest budget:** ověřit pipeline runtime pro ~250 RSS položek / ~108s per tick v staging.
4. **Batch balancing:** žádné kritické problémy
5. **Publish:** Phase 2B nesmí měnit publish logiku — pouze ingest/scheduler selection.

## J) Verdikt Phase 2B readiness

**SAFE_FOR_PHASE2B=YES**

Rotation simulation validates target frequency model. Phase 2B still requires separate PRs for cap, watchdog cadence, and runtime scheduler activation.

## Model comparison delta

| Metrika | Current | Dry-run | Improvement |
|---------|---------|---------|-------------|
| Full rotation | 148 min | 20 min | 7.4× |
| Skipped/tick | 51 | 0 | −51 |
| Checks/source/24h | 9.73 | 72 | 7.4× |
| Coverage/hour | 24.0 | 177.0 | 7.38× |

## Explicit verdict

```
RSS_ROTATION_PHASE2A_DRY_RUN=PASS
DRY_RUN_ONLY=YES
BEHAVIOR_CHANGE=NO
SCHEDULER_RUNTIME_CHANGE=NO
MAX_SOURCES_PER_SCHEDULER_TICK=5
WATCHDOG=*/15
FETCH_LOGIC_CHANGE=NO
PUBLISH_LOGIC_CHANGE=NO
WORKFLOW_CHANGE=NO
CLOUDFLARE_CHANGE=NO
ARTICLES_JSON_CHANGE=NO
BOOTSTRAP_CHANGE=NO
INDEX_CHANGE=NO
PRODUCTION_DATA_CHANGE=NO
SAFE_FOR_PHASE2B=YES
```

