# Přehled dne — důkazy datové stabilizace (closeout)

- Audited at: `2026-07-19T14:14:46.384Z`
- Feed generatedAt: `2026-07-19T12:10:33.316Z`
- Active items: **140**
- maxAgeHours: **96**
- droppedOutsideActiveWindow: **136**

## Monitoring quality
```json
{
  "itemCount": 140,
  "fallbackTime": 0,
  "lowConfidence": 0,
  "futureTime": 0,
  "missingUrl": 0,
  "missingInstitution": 0,
  "missingGroup": 0,
  "techArtifactsInTags": 0,
  "multiSourcePublications": 0,
  "invalidLifecycle": 0,
  "suspiciousSameCaptureBatch": 52,
  "blockers": [],
  "warnings": [
    "suspicious_backfill_batch"
  ]
}
```

## Registry
- total: 39
- PRODUCTION_ACTIVE: 28
- pending: 11

## Audited sources
### irozhlas (rss+verejnopravni)
- inActiveFeed: **40**
- registry: status=`PRODUCTION_ACTIVE` type=`rss` lane=`verejnopravni-media` kept=`148`

| field | value |
|---|---|
| id | ie-irozhlas-ba3b25eae5b4 |
| eventId | ie-irozhlas-ba3b25eae5b4 |
| sourceId | irozhlas |
| institution | iROZHLAS |
| sourceGroup | verejnopravni-media |
| url | https://www.irozhlas.cz/zpravy-domov/meteorologove-varuji-pred-silnymi-bourkami-zprisnili-vystrahu-pro-jihovychod-a_2607191215_pik |
| published_at | 2026-07-19T10:10:00.000Z |
| first_seen_at | 2026-07-19T12:10:33.316Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | null |
| valid_to | null |
| resolved_at | null |
| time_source | rss_pub_date |
| time_confidence | high |
| lifecycle | publikovano |
| region | Česká republika |
| regionLevel | cr |
| category | cesko-svet |
| lane | verejnopravni-media |
| connectorType | rss |
| tags | [] |
| sourcePublications | [{"sourceId":"irozhlas","sourceLabel":"iROZHLAS","sourceGroup":"verejnopravni-media","url":"https://www.irozhlas.cz/zpravy-domov/meteorologove-varuji-pred-silnymi-bourkami-zprisnili-vystrahu-pro-jihovychod-a_2607191215_pik","publishedAt":"2026-07-19T10:10:00.000Z"}] |
| published_vs_first_seen_diff_ms | 7233316 |
| age_hours_published | 4.079550277777778 |

### nukib (html+kyber)
- inActiveFeed: **0**
- note: Connector returned 25 items but none remain in active 96h feed (correct exclusion of historical backfill / outside window)
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`bezpecnost` kept=`25`

### mze (html+ministerstvo)
- inActiveFeed: **0**
- note: Connector returned 9 items but none remain in active 96h feed (correct exclusion of historical backfill / outside window)
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`ministerstva` kept=`9`

### szdc (html+title_date+doprava)
- inActiveFeed: **1**
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`doprava` kept=`2`

| field | value |
|---|---|
| id | ie-szdc-6c5c217743ed |
| eventId | ie-szdc-6c5c217743ed |
| sourceId | szdc |
| institution | Správa železnic |
| sourceGroup | doprava |
| url | https://www.spravazeleznic.cz/-/na-provoz-mezi-prahou-a-milovicemi-dohlizi-etcs-vlaky-zrychli-na-160-km-h |
| published_at | 2026-07-16T12:00:00.000Z |
| first_seen_at | 2026-07-18T19:38:01.328Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | null |
| valid_to | null |
| resolved_at | null |
| time_source | title_date |
| time_confidence | medium |
| lifecycle | publikovano |
| region | Česká republika |
| regionLevel | cr |
| category | doprava |
| lane | doprava |
| connectorType | html |
| tags | [] |
| sourcePublications | [{"sourceId":"szdc","sourceLabel":"Správa železnic","sourceGroup":"doprava","url":"https://www.spravazeleznic.cz/-/na-provoz-mezi-prahou-a-milovicemi-dohlizi-etcs-vlaky-zrychli-na-160-km-h","publishedAt":"2026-07-16T12:00:00.000Z"}] |
| published_vs_first_seen_diff_ms | 200281328 |
| age_hours_published | 74.24621694444444 |

### kraj-liberecky (html+regional)
- inActiveFeed: **0**
- note: Connector returned 25 items but none remain in active 96h feed (correct exclusion of historical backfill / outside window)
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`regionalni` kept=`25`

### kraj-zlinsky (html+regional)
- inActiveFeed: **0**
- note: Connector returned 30 items but none remain in active 96h feed (correct exclusion of historical backfill / outside window)
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`regionalni` kept=`30`

### mfcr (rss+resort)
- inActiveFeed: **1**
- registry: status=`PRODUCTION_ACTIVE` type=`rss` lane=`ministerstva` kept=`1`

| field | value |
|---|---|
| id | ie-mfcr-3278dd8f91ca |
| eventId | ie-mfcr-3278dd8f91ca |
| sourceId | mfcr |
| institution | Ministerstvo financí ČR |
| sourceGroup | ministerstva |
| url | https://mf.gov.cz/cs/ministerstvo/media/tiskove-zpravy/2026/obcane-koupili-dluhopisy-republiky-v-hodnote-74-mi-64586 |
| published_at | 2026-07-16T08:00:00.000Z |
| first_seen_at | 2026-07-19T09:57:08.852Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | null |
| valid_to | null |
| resolved_at | null |
| time_source | rss_pub_date |
| time_confidence | high |
| lifecycle | publikovano |
| region | Česká republika |
| regionLevel | cr |
| category | stat |
| lane | ministerstva |
| connectorType | rss |
| tags | [] |
| sourcePublications | [{"sourceId":"mfcr","sourceLabel":"Ministerstvo financí ČR","sourceGroup":"ministerstva","url":"https://mf.gov.cz/cs/ministerstvo/media/tiskove-zpravy/2026/obcane-koupili-dluhopisy-republiky-v-hodnote-74-mi-64586","publishedAt":"2026-07-16T08:00:00.000Z"}] |
| published_vs_first_seen_diff_ms | 266228852 |
| age_hours_published | 78.24621694444444 |

### mpo (html+resort)
- inActiveFeed: **0**
- note: Connector returned 54 items but none remain in active 96h feed (correct exclusion of historical backfill / outside window)
- registry: status=`PRODUCTION_ACTIVE` type=`html` lane=`ministerstva` kept=`54`

### policie-cr (rss+security)
- inActiveFeed: **20**
- registry: status=`PRODUCTION_ACTIVE` type=`rss` lane=`bezpecnost` kept=`80`

| field | value |
|---|---|
| id | ie-policie-cr-d1021167b93c |
| eventId | ie-policie-cr-d1021167b93c |
| sourceId | policie-cr |
| institution | Policie České republiky |
| sourceGroup | policie |
| url | https://policie.gov.cz/clanek/bezpecnostni-opatreni-u-hudebniho-festivalu-v-ostrave-bez-mimoradne-udalosti.aspx |
| published_at | 2026-07-19T11:34:00.000Z |
| first_seen_at | 2026-07-19T12:10:33.316Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | null |
| valid_to | null |
| resolved_at | null |
| time_source | rss_pub_date |
| time_confidence | high |
| lifecycle | publikovano |
| region | Česká republika |
| regionLevel | cr |
| category | bezpecnost |
| lane | bezpecnost |
| connectorType | rss |
| tags | [] |
| sourcePublications | [{"sourceId":"policie-cr","sourceLabel":"Policie České republiky","sourceGroup":"policie","url":"https://policie.gov.cz/clanek/bezpecnostni-opatreni-u-hudebniho-festivalu-v-ostrave-bez-mimoradne-udalosti.aspx","publishedAt":"2026-07-19T11:34:00.000Z"}] |
| published_vs_first_seen_diff_ms | 2193316 |
| age_hours_published | 2.679550277777778 |

### chmi (opendata-cap+api)
- inActiveFeed: **17**
- registry: status=`PRODUCTION_ACTIVE` type=`opendata` lane=`pocasi` kept=`25`

| field | value |
|---|---|
| id | ie-chmi-79b3808a416c |
| eventId | ie-chmi-79b3808a416c |
| sourceId | chmi |
| institution | Český hydrometeorologický ústav |
| sourceGroup | pocasi |
| url | https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_191203.xml?id=20343.XOCZ50_OKPR_000264&e=silne+bourky |
| published_at | 2026-07-19T12:03:43.000Z |
| first_seen_at | 2026-07-19T12:10:33.316Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | 2026-07-19T13:30:00.000Z |
| valid_to | 2026-07-19T16:00:00.000Z |
| resolved_at | null |
| time_source | opendata_cap_sent |
| time_confidence | high |
| lifecycle | aktivni |
| region | Středočeský kraj |
| regionLevel | kraj |
| category | pocasi |
| lane | pocasi |
| connectorType | opendata |
| tags | ["cap","vystraha"] |
| sourcePublications | [{"sourceId":"chmi","sourceLabel":"Český hydrometeorologický ústav","sourceGroup":"pocasi","url":"https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_191203.xml?id=20343.XOCZ50_OKPR_000264&e=silne+bourky","publishedAt":"2026-07-19T12:03:43.000Z"}] |
| published_vs_first_seen_diff_ms | 410316 |
| age_hours_published | 2.1842725 |

### hzs-cr (rss)
- inActiveFeed: **14**
- registry: status=`PRODUCTION_ACTIVE` type=`rss` lane=`bezpecnost` kept=`42`

| field | value |
|---|---|
| id | ie-hzs-cr-6aec532e0cfd |
| eventId | ie-hzs-cr-6aec532e0cfd |
| sourceId | hzs-cr |
| institution | Hasičský záchranný sbor ČR |
| sourceGroup | hzs |
| url | https://hzscr.gov.cz/clanek/vazna-dopravni-nehoda-dvou-autobusu-u-lechovic-zamestnala-devet-hasicskych-jednotek.aspx |
| published_at | 2026-07-18T15:59:00.000Z |
| first_seen_at | 2026-07-18T15:59:00.000Z |
| updated_at | 2026-07-19T12:10:33.316Z |
| valid_from | null |
| valid_to | null |
| resolved_at | null |
| time_source | rss_pub_date |
| time_confidence | high |
| lifecycle | publikovano |
| region | Česká republika |
| regionLevel | cr |
| category | bezpecnost |
| lane | bezpecnost |
| connectorType | rss |
| tags | [] |
| sourcePublications | [{"sourceId":"hzs-cr","sourceLabel":"Hasičský záchranný sbor ČR","sourceGroup":"hzs","url":"https://hzscr.gov.cz/clanek/vazna-dopravni-nehoda-dvou-autobusu-u-lechovic-zamestnala-devet-hasicskych-jednotek.aspx","publishedAt":"2026-07-18T15:59:00.000Z"}] |
| published_vs_first_seen_diff_ms | 0 |
| age_hours_published | 22.26288361111111 |

## Chronology (published_at ≠ first_seen_at)
- examples with Δ>60s: **15** (showing up to 8)
- approx same (±60s): **70**

- `ie-sukl-58d2742cd149` src=`sukl` published=`2026-07-15T12:26:53.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=336615852
- `ie-khs-praha-149e47894cea` src=`khs-praha` published=`2026-07-15T13:44:37.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=331951852
- `ie-szu-fb531a313a71` src=`szu` published=`2026-07-16T06:10:51.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=272777852
- `ie-khs-stc-f2b58d0a93e2` src=`khs-stc` published=`2026-07-16T06:54:00.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=270188852
- `ie-szu-d0520ccf7f89` src=`szu` published=`2026-07-16T07:15:08.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=268920852
- `ie-ctu-f230c786a3db` src=`ctu` published=`2026-07-16T07:29:22.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=268066852
- `ie-mfcr-3278dd8f91ca` src=`mfcr` published=`2026-07-16T08:00:00.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=266228852
- `ie-coi-984b59385be2` src=`coi` published=`2026-07-16T08:03:23.000Z` first_seen=`2026-07-19T09:57:08.852Z` time_source=`rss_pub_date` conf=`high` Δms=266025852

## Time parser distribution
```json
{
  "opendata_cap_sent": 17,
  "rss_pub_date": 122,
  "title_date": 1
}
```

## 96h window
- items age 90–96h in feed: 0
- items age >96h in feed: 4
- long-active examples: 0
### Over-96h in active feed
- `ie-khs-praha-149e47894cea` ageH=96.50 status=`publikovano` why=CHECK
- `ie-hzs-cr-874815867512` ageH=96.86 status=`publikovano` why=CHECK
- `ie-hzs-cr-fba873bec815` ageH=97.20 status=`publikovano` why=CHECK
- `ie-sukl-58d2742cd149` ageH=97.80 status=`publikovano` why=CHECK

## Deduplication
- multi sourcePublications: **0**
- exact URL duplicates in feed: **6**
- filter counts: {"policie":20,"irozhlas":40,"szdc":1,"chmi":17}

## Metadata tech artifacts
- hits: **0**

## Acceptance snapshot
```json
{
  "chronologySeparated": true,
  "noFallbackInFeed": true,
  "noTechArtifacts": true,
  "qualityBlockersEmpty": true,
  "pendingUnchanged": true
}
```

## Closeout notes (evidence PR)

### Real fix applied during evidence audit
Client-side **96h safety filter** in `assets/iu-info-system-core-v1.js` (`filterEvents`), mirroring backend `isInActiveFeedWindow`.
Reason: published feed snapshot can age past 96h between Update info events runs; regular `publikovano` items must not remain visible solely due to stale dataset.

### Sources with connector items but 0 in active feed
NÚKIB, MZe, Liberecký kraj, Zlínský kraj: `itemsKept > 0` in registry monitoring, **0** in active feed → historical items correctly excluded by 96h window (not a connector failure).

### Parser coverage in current active feed
Observed `timeSource` values: `rss_pub_date`, `opendata_cap_sent`, `title_date`.
Other parsers (JSON-LD, article:published_time, Atom, API) remain implemented in connectors; unit/guard coverage in `scripts/iu-info-events-data-stab-evidence-guard.mjs`. Active production mix currently dominated by RSS + CAP + SZDC title dates.

### Multisource clusters
Current production active feed has `multiSourcePublications=0` (no multi-institution clusters this cycle). Dedup filter through `sourcePublications` is unit-proven.

### Physical devices
**NESPLNĚNO** (devices unavailable). Playwright is not a substitute.
