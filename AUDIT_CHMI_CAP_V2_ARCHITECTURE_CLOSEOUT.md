# AUDIT — ČHMÚ CAP v2 Architecture Closeout

**Datum:** 2026-07-29  
**Větev:** `chore/chmi-cap-v2-architecture-closeout`  
**Účel:** Nezávislá architektonická validace před definitivním uzavřením etapy. Nejde o nové funkce — o důkaz obecnosti a odstranění zbývajících rizik.

---

## 1. Forenzní kontrola implementace (tok)

| Krok | Modul | Chování |
|------|--------|---------|
| Index | `discovery-adapter.mjs` → `listCapXmlFromIndex` | Jeden GET na open-data directory listing |
| Discovery streamů | `capProductKeyFromUrl` + `selectLatestPerProductStream` | Klíč = `alert_cap_{N}_*`; **bez whitelistu produktů** |
| Výběr bulletinů | 1 head / productKey (nejvyšší mtime) | **Žádné** `maxFiles` / `slice(0,N)` / first-N |
| Fetch | `createOpenDataActiveStreamsDiscovery.fetchBody` | Conditional GET per head URL |
| Parser | `parse-cap.mjs` | Všechny cs `info`; překročení stropů → `CAP_TRUNCATED` (FAIL, ne tiché oříznutí) |
| Identita / lifecycle | `identity.mjs` + `revisions.mjs` | Thread přes `references`; Alert / Update / Cancel |
| Geo | `geo-registry.mjs` | CISORP → ORP → okres → kraj; neznámé kódy → quarantine |
| Normalizace | `normalize-feed.mjs` | `aktivni` / `zruseno` / `ukonceno`; plné `orpIds`/`orpNames`/summary |
| Dedup | `mergeFeedItemsById` | Stejné `id` → unie oblastí; různé jevy/severity/platnost zůstávají oddělené |
| Publikace | `chmi-cap-v2-prod-sync.mjs` + `atomicPublishDecision` | `completenessOk` povinné; jinak FAIL + last-known-good |

### Odstraněné / ověřené limity

- **Odstraněno dříve:** `IU_CHMI_CAP_V2_MAX_FILES`, `slice(0, maxFiles)`, dead `maxCapMessagesPerRun`.
- **Fail-hard (ne tiché drop):** `maxInfoBlocks`, `maxAreasPerInfo`, `maxGeocodesPerArea`, `maxPolygonPoints`, `maxParametersPerInfo`, `maxEventCodesPerInfo`, `maxReferencesParts` → `CAP_TRUNCATED`.
- **Textové `clip` / `slice` na řetězcích:** ořez délky textu (DoS), nikoli počtu bulletinů.
- **`list.slice()` v configured_urls:** kopie pole URL, ne limit počtu.

Gate: `npm run iu-chmi-cap-v2-architecture-validation` → `CHMI_CAP_V2_ARCHITECTURE_CLOSEOUT=PASS`.

---

## 2. Algoritmus `selectLatestPerProductStream`

### Jak vznikají produktové streamy

Filename pattern `alert_cap_{product}_{DDHHMM}.xml`.  
`product` (např. `50` meteo, `70` sucho/hydro, budoucí `99`) = **datový klíč streamu**.  
Nový produkt = nový klíč v listingu → automaticky nový head. **Žádný whitelist.**

### Výběr

Pro každý productKey se ponechá soubor s max. Apache `mtime` (tie-break: lexikografické jméno).  
Výstup: pole o délce = počet distinct streamů.

### Alert / Update / Cancel / expirace

**V produkční synchronizaci:** stahuje se **jeden head na stream**. ČHMÚ open-data head je prakticky kompletní superseding CAP dokument aktuálního stavu produktu (včetně všech souběžných `info` bloků daného produktu).

**Uvnitř dokumentu:** parser bere všechny cs `info`; identity skládá hazard instance; Cancel → `zruseno`; `expires` v minulosti → `ukonceno` / neaktivní.

**Plný replay Alert→Update→Cancel** napříč více XML stejného streamu je implementován a testován v `lifecycle.mjs` / architecture validation (důkaz správnosti modelu). Produkční sync archive nereplayuje — spoléhá na superseding head (oficiální model open-data).

### Kdy synchronizace končí

1. Discovery OK + všechny head XML v cache **nebo** FAIL `INCOMPLETE_STREAM_CACHE`.  
2. Parse/process bez hard fail → kandidátní feed.  
3. `completenessOk` + `atomicPublishDecision` → publish **nebo** ponechání last-known-good + alarm.  
4. Data PR / Pages deploy jsou oddělené; `PRODUCTION_VERIFIED` vyžaduje shodu live produkce s oficiálními streamy (`chmi-cap-v2-prod-verify.mjs`).

### Explicitní potvrzení

| Tvrzení | Verdikt |
|---------|---------|
| Nezpracovává pouze poslední bulletin globálně (maxFiles=1) | **ANO — opraveno** (head per stream) |
| Nezpracovává pouze první bulletin | **ANO** |
| Nezpracovává pouze „poslední stav“ bez všech info v head dokumentu | **ANO** — všechny cs info v head |
| Projde relevantní lifecycle potřebný k aktuálnímu stavu | **ANO** — head = superseding snapshot; Update/Cancel v replay testech PASS |

---

## 3–4. Integrační a stresové testy (důkaz)

Skript: `scripts/chmi-cap-v2-architecture-validation.mjs`

| Scénář | Výsledek (ukázka běhu) |
|--------|-------------------------|
| 1 / 2 / 5 / 10 streamů | PASS — přesně N heads, vždy nejnovější soubor |
| Nový produkt `99` | PASS — auto-discovery |
| Alert → Update (severity + oblasti) → Cancel | PASS |
| Expirace | PASS — `activeCount=0` |
| 3 paralelní streamy / 3 jevy | PASS |
| Dedup: různé severity/oblasti | PASS — 2 položky |
| Dedup merge stejné id | PASS — unie ORP |
| Geo 5 ORP | PASS |
| `CAP_TRUNCATED` při limitu | PASS |
| Fail-safe publish | PASS — last-known-good |
| Stress 20 / 50 / 100 / 200 docs | PASS — např. 200 docs ≈ 58 ms, mem delta &lt; 10 MB |

---

## 5. Discovery nových produktů

Datově řízené `capProductKeyFromUrl`. Guard: `discover_novel_product_88`.  
Změna kódu / whitelist **není** nutná pro nový `alert_cap_N_*`.

---

## 6. Deduplikace

- Různé `id` / hazard instance (jev × území × platnost) → **neslučuje**.  
- Stejné `id` → `mergeFeedItemsById` **unie** `orpIds` / geo links.  
- Testy v architecture validation §6–7.

---

## 7. Geografie

Registry: ORP (CISORP) → okres → kraj; `areaDesc` / display names; polygon body se parsuje (fail při přesahu bodů).  
Frontend `regionMatches` používá `orpIds`/`orpNames`/kraje/okresy/summary.  
Obce/města: filtrování přes ORP vazby a textové shody v `region` + `searchText` (ne samostatná obecní vrstva v CAP geocode — CAP typicky dodává CISORP).

---

## 8. Fail-safe

| Simulace | Chování |
|----------|---------|
| Poškozené XML / parser throw | `rejected`; při 0 valid → status failed; nepublikuje neúplný feed |
| Chybějící stream/cache | `INCOMPLETE_STREAM_CACHE`, `completenessOk=false` |
| Suspicious drop | `atomicPublishDecision` → publish=false |
| Neprovedený deploy | `prod-verify` porovná live feed vs oficiální CAP → FAIL pokud chybí eventy |

---

## 9. `PRODUCTION_VERIFIED`

Vzniká **pouze** když `chmi-cap-v2-prod-verify.mjs`:

1. stáhne oficiální index + všechny stream heads,  
2. spočítá expected aktivní položky,  
3. načte **produkční** feed (default `https://infouzel.cz/.../feed.json`),  
4. porovná eventy / city filtry / alarmy.

Merge nebo samotný deploy **nestačí** — skript musí projít proti živé produkci.

---

## 10. Regresní guardy

- `chmi-cap-v2-guard.mjs` — fixture + no maxFiles + novel product + CAP_TRUNCATED + completeness gate.  
- `chmi-cap-v2-architecture-validation.mjs` — closeout suite.  
- `chmi-cap-v2-prod-verify.mjs` — produkční shoda.  
- Workflow: smoke/layout/repo-guard na automation branch; completeness alarmy v sync.

---

## 11. Architektonické otázky (ANO/NE)

### 1. Existuje ještě nějaký pevný funkční limit **počtu zpracovaných bulletinů**?
**NE.** Discovery vrací jeden head na každý nalezený stream bez horního stropu počtu streamů. Safety ceilings na velikost **jednoho** XML při překročení **selžou** (`CAP_TRUNCATED`), neodeberou tiše část výstrah.

### 2. Existuje možnost, že některé CAP bulletiny nebudou zpracovány?
**ANO — pouze starší soubory uvnitř téhož product streamu** (archive pod head). To je záměr: head = superseding produktový snapshot.  
**NE** pro přeskočení celého product streamu (původní chyba `maxFiles=1`).

### 3. Existuje možnost ztráty oblastí?
**NE** při publikaci validního feedu pod limity — všechny area/geocode v head se mapují; merge unifikuje ORP.  
Překročení limitu → sync FAIL + last-known-good (ne tichá ztráta v „zdravém“ feedu).

### 4. Existuje možnost ztráty souběžných výstrah?
**NE** napříč product streamy (každý head).  
**NE** uvnitř head dokumentu (všechny cs info).  
Souběh pouze v archive starších souborů téhož streamu bez přítomnosti v head by závisel na ČHMÚ modelu — mimo InfoUzel kontrolu; současný oficiální model head supersede.

### 5. Existuje možnost, že produkce bude označena jako zdravá při neúplných datech?
**NE** pro známý scénář „3 sucha místo kompletního meteo+sucho“: sync `completenessOk` + `INCOMPLETE_*` alarmy + `PRODUCTION_VERIFIED` vyžaduje shodu eventů s oficiálními streamy.

### 6. Existuje možnost, že nový produktový stream nebude objeven?
**NE** — klíč z filename, bez whitelistu (důkaz product `88`/`99` v testech).

### 7. Existuje možnost, že stejná chyba jako původně projde bez alarmu?
**NE.** Původní chyba = globální `maxFiles=1` + publish neúplného feedu bez produkčního compare. Obě cesty jsou odstraněny a hlídány guardy + prod-verify.

---

## Závěr

| Kritérium | Stav |
|-----------|------|
| Žádný pevný limit počtu bulletinů (stream heads) | SPLNĚNO |
| Discovery všech produktových streamů | SPLNĚNO |
| Algoritmus sestaví aktuální stav | SPLNĚNO (head + lifecycle testy) |
| Dedup / geo / fail-safe / PRODUCTION_VERIFIED / guardy | SPLNĚNO |
| Původní chyba architektonicky možná bez detekce | **NE** |

**Verdikt: etapu ČHMÚ CAP V2 lze považovat za definitivně dokončenou** za předpokladu, že CI na closeout PR je zelené a po merge zůstane `npm run iu-chmi-cap-v2-prod-verify` = `PRODUCTION_VERIFIED`.

Zbývající provozní závislost (ne bug InfoUzel): kvalita ČHMÚ open-data head jako kompletního superseding dokumentu produktu — monitorována prod-verify proti oficiálnímu listingu.
