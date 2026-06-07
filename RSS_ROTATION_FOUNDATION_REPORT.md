# RSS ROTATION FOUNDATION REPORT

> Generated: 2026-06-07T20:44:27Z
> PHASE 1 — foundation metadata only (no production behavior change)

## Summary

| Metric | Value |
|--------|-------|
| Total active sources | 59 |
| Batch A sources | 15 |
| Batch B sources | 15 |
| Batch C sources | 14 |
| Batch D sources | 15 |
| STRONG sources | 20 |
| MEDIUM sources | 21 |
| WEAK sources | 18 |
| Unassigned sources | 0 |
| Duplicate assignments | 0 |

## BEFORE / AFTER / DELTA

### BEFORE

```json
{
  "MAX_SOURCES_PER_SCHEDULER_TICK": 5,
  "selected_count": 5,
  "selected_ids": [
    "spt_ctsport",
    "spt_idnes",
    "spt_isport",
    "zpr_aktualne",
    "zpr_ct24_svet"
  ],
  "skipped_count": 6
}
```

### AFTER

```json
{
  "MAX_SOURCES_PER_SCHEDULER_TICK": 5,
  "selected_count": 5,
  "selected_ids": [
    "spt_ctsport",
    "spt_idnes",
    "spt_isport",
    "zpr_aktualne",
    "zpr_ct24_svet"
  ],
  "skipped_count": 7
}
```

### DELTA

```json
{
  "MAX_SOURCES_PER_SCHEDULER_TICK_unchanged": true,
  "selected_ids_unchanged": true,
  "selected_count_unchanged": true,
  "FETCH_COUNT_unchanged": true,
  "PUBLISH_COUNT_unchanged": true,
  "WATCHDOG_unchanged": true
}
```

## Validation

- batch registry valid: **PASS**
- each source in exactly one batch: **PASS**
- no duplicate assignments: **PASS**
- all active sources assigned: **PASS**

## Source strength (STRONG)

fin_idnes_ekonomika, fin_novinky_ekonomika, fin_sz_byznys, hry_novinky, spt_ctsport, spt_idnes, spt_isport, spt_sportcz, ved_ct24_veda, ved_novinky, vzd_novinky_skola, vzd_seznam, zpr_aktualne, zpr_ct24_domaci, zpr_ct24_svet, zpr_denik, zpr_idnes_zpravy, zpr_novinky_domaci, zpr_novinky_zahranicni, zpr_seznam_domaci

## Source strength (MEDIUM)

ces_cestujlevne, ces_novinky_cestovani, ces_svetcestovatele, fin_e15, fin_ekonom, fin_ekonomickydenik, fin_hn, fin_penize, hry_indian, hry_vortex, hry_zing, kul_ctart, kul_kinobox, spt_crzpravy_sport, ved_technet, ved_vtm, zdr_plnezdravi, zdr_zdravezpravy, zdr_zdravotnickydenik, zpr_hlidacipes, zpr_tydenikpolicie

## Source strength (WEAK)

ces_pelipecky, ces_travelbible, fin_epenize, fin_faei, hry_nedd, hry_sector, kul_vipzivot, kul_vlasta, kul_vtelce, spt_mmamag, spt_tenisportal, vzd_betterlife, vzd_nespechej, zdr_betterlife, zdr_prozeny_zdravi, zdr_zdrave, zpr_ceskajustice, zpr_kverulant

## Unassigned sources

(none)

## Duplicate assignments

(none)

## Production invariants (unchanged)

| Constant | Value |
|----------|-------|
| MAX_SOURCES_PER_SCHEDULER_TICK | 5 |
| FOUNDATION_ONLY | YES |
| BEHAVIOR_CHANGE | NO |
| SCHEDULER_RUNTIME_CHANGE | NO |

## Batch membership

### Batch A (15 sources)

```
ces_pelipecky
fin_ekonom
fin_epenize
fin_hn
fin_novinky_ekonomika
hry_indian
hry_novinky
hry_zing
kul_kinobox
kul_vipzivot
vzd_nespechej
vzd_novinky_skola
zdr_zdrave
zpr_ct24_svet
zpr_seznam_domaci
```

### Batch B (15 sources)

```
ces_novinky_cestovani
ces_svetcestovatele
ces_travelbible
fin_sz_byznys
hry_vortex
kul_vlasta
spt_crzpravy_sport
spt_tenisportal
ved_novinky
zdr_zdravotnickydenik
zpr_denik
zpr_hlidacipes
zpr_kverulant
zpr_novinky_domaci
zpr_novinky_zahranicni
```

### Batch C (14 sources)

```
fin_e15
fin_faei
fin_idnes_ekonomika
fin_penize
hry_sector
spt_ctsport
spt_idnes
spt_isport
ved_vtm
zdr_betterlife
zdr_prozeny_zdravi
zdr_zdravezpravy
zpr_idnes_zpravy
zpr_tydenikpolicie
```

### Batch D (15 sources)

```
ces_cestujlevne
fin_ekonomickydenik
hry_nedd
kul_ctart
kul_vtelce
spt_mmamag
spt_sportcz
ved_ct24_veda
ved_technet
vzd_betterlife
vzd_seznam
zdr_plnezdravi
zpr_aktualne
zpr_ceskajustice
zpr_ct24_domaci
```

