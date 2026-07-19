# Přehled dne — datová stabilizace chronologie / 96h (po V4)

Datum: 2026-07-19  
Baseline V4: `ad7da9619bc18947b34916a18f15184620ce0670`

## Problém

- HTML položky (např. Správa železnic) měly `publishedAtSource=null` a `sortAt=firstSeen` (= čas importu).
- Aktivní okno bylo 120 h a používalo importní čas → historické položky vypadaly jako nové.
- Uživatelské `tags` obsahovaly technické hodnoty (`html`, `rss`) a duplicitní slugy → vizuální slepení.

## Opravy

1. `parsePublishDateToIso` + datum z titulku (`DD.MM.YYYY`) v HTML listingu.
2. `MAX_AGE_HOURS=96`; vstup do feedu jen přes `publishedAtSource` nebo stále platnou událost (`validTo`).
3. `applyChronology`: nikdy nesází `publishedAt=now`; `timeSource` / `timeConfidence`.
4. `loadPreviousFirstSeen` pouze z `firstSeenByInfoUzel`.
5. Lifecycle: běžné TZ → `publikovano`, ne falešné `aktivni`.
6. Dedup URL zachovává `sourcePublications[]` + jemnější region.
7. UI: lidské labely, bez tech tagů; oddělené originální odkazy.

## Regenerace (lokální běh)

| Metrika | Před | Po |
|--------|------|-----|
| Položky | ~300 | 170 |
| maxAgeHours | 120 | 96 |
| droppedOutsideWindow | — | 141 |
| fallbackTime | ~151 | 0 |
| techArtifactsInTags | >0 | 0 |
| failedConnectors | 0 | 0 |

SZDC ukázka: `publishedAtSource=2026-07-16…`, `timeSource=title_date`, `timeConfidence=medium`.
