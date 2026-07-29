# AUDIT: ČHMÚ CAP v2 — úplnost výstrah a geografické filtrování

**Datum auditu:** 2026-07-29  
**Větev:** `fix/chmi-cap-completeness-and-geo-filtering`  
**Výchozí HEAD (main):** `97f0b5778e4f764d7b8d0208c84ef77a028183dd`  
**Režim:** Fáze A — forenzní audit bez oprav kódu  
**Cizí stashe:** nedotčené (108+ existujících stashů)

---

## 1. Aktuální produkční stav

| Metrika | Hodnota |
|---|---|
| Produkční URL feed | `https://josefjosefjosef.github.io/filtr/projects/data/info_events/feed.json` |
| `generatedAt` (produkce = main) | `2026-07-29T01:56:27.154Z` |
| `chmiCapV2Active` | `true` |
| Počet ČHMÚ položek v produkci | **3** |
| Zobrazené karty | Stav sucha — Rumburk; Stav sucha — Praha; Hydrologické sucho — Benešov |
| Oficiální nejnovější CAP bulletin | `alert_cap_50_290854.xml` (`sent` 2026-07-29T10:54:03+02:00) |
| Počet publikovatelných položek z nejnovějšího bulletinu | **14** (teplo, zátěž teplem, požáry, výhled) |
| Automation větev (nezměněná do main) | `automation/update-chmi-cap-v2` → PR **#7842** → **14 položek**, `publish=true` |
| Poslední úspěšný sync run | GHA `30476985518` @ 2026-07-29T17:48:09Z, `items=14` |

**Závěr produkce:** Sync běží a vytváří správný nový snapshot (14 položek), ale **nesloučí se do `main`**, takže Pages/produkce zůstávají na starém třípoložkovém suchu.

---

## 2. Přesná cesta od ČHMÚ až do UI

```
ČHMÚ Open Data CAP index
  https://opendata.chmi.cz/meteorology/weather/alerts/cap/
        │
        ▼
discovery-adapter.mjs  (opendata_newest_file, IU_CHMI_CAP_V2_MAX_FILES=1)
        │  listCapXmlFromIndex() → sort by Apache mtime → slice(0, 1)
        ▼
conditional GET XML bulletin
        │
        ▼
parse-cap.mjs          (všechny cs info bloky + všechny area/geocode)
        │
        ▼
identity.mjs           (1 hazard instance / info blok; thread přes references)
        │
        ▼
geo-registry.mjs       (CISORP → ORP → okres → kraj; quarantine unknown)
        │
        ▼
revisions.mjs          (immutable revision + change_type)
        │
        ▼
normalize-feed.mjs     (hazard → info_events item; title = event + první ORP)
        │
        ▼
chmi-cap-v2-prod-sync.mjs
  → nahradí VŠECHNY sourceId=chmi v feed.json kandidátem z aktuálního běhu
  → monitoring.json / diagnostics.json / revisions_index.json
        │
        ▼
GHA update-chmi-cap-v2.yml (cron */15)
  → commit na automation/update-chmi-cap-v2
  → gh pr create / merge --auto || true
        │
        ✖ BLOK: required checks repo-guard / layout-guard / smoke
          na automation větvi NEBĚŽÍ → auto-merge neproběhne
        │
        ▼ (pouze pokud by merge prošel)
main → pages-publish-from-main-data → infouzel.cz / GitHub Pages
        │
        ▼
assets/iu-info-system-core-v1.js  (load feed, locality filter regionMatches)
assets/iu-prehled-dne-ui-v1.js    (karty + badge VÝSTRAHA ČHMÚ)
```

---

## 3. Vstupní CAP zdroje

| Zdroj | URL / cesta | Použití |
|---|---|---|
| Open Data CAP index | `https://opendata.chmi.cz/meteorology/weather/alerts/cap/` | Discovery (produkční default) |
| CAP XML bulletiny | `…/alert_cap_*.xml` (auditem ~659 souborů v indexu) | Tělo zpráv |
| Veřejná stránka výstrah | `https://vystrahy-cr.chmi.cz/` | Atribuce / odkaz v UI (ne parser) |
| Geo registry | `scripts/chmi-cap-v2/data/geo-registry.json` | ORP 206 / okres 78 / kraj 14 |
| Legacy extract (ne aktivní publish) | `extractCapBulletinItems` v `iu-info-events-lib.mjs` | Historický regex parser (`max=8`, severity Extreme\|Severe\|Moderate) — CAP v2 path jej nepoužívá při `mode=active` |

**Discovery režim produkce:** `IU_CHMI_CAP_V2_DISCOVERY=opendata_newest_file`, **`IU_CHMI_CAP_V2_MAX_FILES=1`**.

---

## 4. Poslední úspěšná synchronizace (vrstvy)

### 4.1 main / produkce (zmrazené)

| Pole | Hodnota |
|---|---|
| lastRunAt | 2026-07-29T01:56:27.154Z |
| processed file | `alert_cap_70_281200.xml` |
| CAP sent | 2026-07-28T14:00:00+02:00 |
| msgType | Update |
| CAP zprávy zpracované | 1 |
| hazardCount (revision) | 4 |
| publikované položky | 3 (1 hazard odfiltrován jako „žádná/None“) |
| status monitoring | healthy (falešně úplný) |

### 4.2 automation větev (aktuální sync, ne v main)

| Pole | Hodnota |
|---|---|
| lastRunAt | 2026-07-29T17:48:22.472Z |
| processed file | `alert_cap_50_290854.xml` |
| CAP sent | 2026-07-29T10:54:03+02:00 |
| msgType | Update |
| CAP zprávy | 1 |
| info bloků (cs) | 37 |
| publikované položky | 14 |
| PR | #7842 OPEN, checks = žádné |

---

## 5. Porovnání vrstva × vrstva (auditní tabulka)

Měření k 2026-07-29 ~18:00 UTC+2. „Oficiální zdroj“ = nejnovější CAP bulletin + kontext starších aktivních bulletinů (sucho).

| Vrstva | Počet CAP zpráv | Počet jevů (info / hazard) | Počet oblastí (area) | Počet publikovaných položek |
|---|---:|---:|---:|---:|
| Oficiální zdroj (nejnovější bulletin) | 1 (`alert_cap_50_290854`) | 37 info (z toho ~13 skutečných výstrah + „žádná“ + výhled) | 381 area | n/a (ČHMÚ UI) |
| Oficiální zdroj (top 10 bulletinů, aktivní jevy) | 10 | teplo + zátěž + požáry + sucho + výhled | tisíce geocode vazeb | n/a |
| Stažená data (produkční sync maxFiles=1, automation) | 1 | 37 | 381 | — |
| Parser (`parseCapAlertXml`) | 1 | 37 hazards | 381 areas, geocodes namapovány | — |
| Normalizace (`revisionsToFeed`) | 1 | 14 feed items (odfiltruje „Žádná…“, None) | orpIds zachovány v `region.orpIds` | 14 |
| info_events na automation | 1 bulletin | 14 | orpIds u položek (až 206) | **14** |
| info_events na main / Pages | 1 starý bulletin | 3 | orpIds u sucha (2–114) | **3** |
| API (= statický feed.json) | stejné jako info_events | 3 / 14 | — | 3 produkce / 14 automation |
| UI Přehled dne (produkce) | — | — | titulky = první ORP | **3 karty** |

### 5.1 Kde se data ztrácejí (přesné místo)

| # | Vrstva | Soubor / mechanismus | Ztráta | Závažnost |
|---|---|---|---|---|
| **P0** | **Publish / CI merge** | `.github/workflows/update-chmi-cap-v2.yml` → `gh pr merge --auto \|\| true` | Sync vytvoří 14 položek, ale PR #7842 **nikdy nesplyne** do main (chybí required checks `repo-guard`, `layout-guard`, `smoke` na automation větvi). Produkce zůstává na 3 položkách. | **KRITICKÁ — primární příčina 3 karet** |
| **P0** | **Discovery** | `IU_CHMI_CAP_V2_MAX_FILES=1` + full replace všech `sourceId=chmi` | Nejnovější bulletin (teplo) **nahradí** celý ČHMÚ feed; starší stále aktivní bulletiny (např. sucho `alert_cap_70_*`) zmizí. | **KRITICKÁ — neúplnost i po merge** |
| **P1** | **Normalizace titulku / UI lokalita** | `normalize-feed.mjs` `primary = links[0]` | Titulek „… — Praha“ i když výstraha pokrývá desítky ORP → klamný dojem jediného města. | Vysoká (UX / důvěra) |
| **P1** | **Frontend filtr** | `regionMatches()` v `iu-info-system-core-v1.js` | Filtr je textový `includes` nad `region.name` + surovými `orpIds` (`orp:1000`). **Neobsahuje názvy všech ORP** ani hierarchii obec→ORP. Město mimo „primary“ název se nemusí trefit. | Vysoká |
| **P2** | **Normalizace obsahu** | `revisionToFeedItems` | Do feed itemu neukládá `description` / `instruction` / úplný seznam ORP názvů (jen `orpIds` + searchText). Detail UI je omezený. | Střední |
| **P2** | **Monitoring úplnosti** | `monitoring.chmiCapV2` | Stačí `activeCount > 0` + HTTP 200 → status `healthy`. Neověřuje shodu se zdrojem / stáří `sent` vs publikace. | Střední |
| **P3** | Legacy regex | `extractCapBulletinItems` (`max=8`, severity filter) | Neaktivní při CAP v2 active publish; riziko při fallbacku. | Nízká (teď) |

**Parser NENÍ primární viník tří položek:** zpracovává všechny cs `info` a všechny `area`.  
**Deduplikace NENÍ primární viník:** u sucha i tepla se orpIds ukládají v poli.  
**Whitelist „jen sucho“ NENÍ v CAP v2 normalizaci:** „Žádná výstraha…“ se správně odfiltruje; teplo/požáry se publikují, jakmile se stáhne správný bulletin.

---

## 6. Bloky info — vzorek nejnovějšího bulletinu

Soubor: `alert_cap_50_290854.xml`  
`identifier` / `sender` / `sent` / `status` / `msgType` / `scope` / `references`: Update od ČHMÚ (ohp@chmi.cz), Actual.

Příklady skutečných výstrah (ne „Žádná…“):

| event | severity | areas | mapped ORP links |
|---|---|---:|---:|
| Vysoké teploty | Moderate | 14 / 14 / 1 / 1 | 192 / 179 / 8 / 14 |
| Velmi vysoké teploty | Severe | 3 | 27 |
| Silná zátěž teplem | Moderate | 8 / 10 / 4 | 61 / 68 / 34 |
| Velmi silná zátěž teplem | Severe | 12 / 4 | 104 / 34 |
| Riziko požárů | Moderate | 4 / 2 / 1 | 49 / 15 / 6 |
| Výhled jevů | Unknown | 14 | 206 |

Odfiltrované normalizací (záměrně): eventy začínající „Žádná…“ / „Žádný…“, severity `None`.

---

## 7. Geografické mapování

| Metrika | Stav |
|---|---|
| Registry | CISORP 206 ORP, 78 okresů, 14 krajů (`cisorp-csu65+cuzk-ui-2026-07-28`) |
| Mapování geocode CISORP | funguje; quarantine při unknown code |
| Zachování všech ORP v `region.orpIds` | **ANO** (produkční sucho Praha má 114 ORP) |
| Titulek / `region.name` | **pouze první ORP** |
| Hierarchie obec → ORP ve filtru | **NE** (textový fallback) |
| Metriky `totalAreas` / `mappedAreas` / `unmappedAreas` / `mappingCoveragePercent` | **CHYBÍ** v monitoring |
| Polygon / circle | parser čte; feed je nevyužívá |

---

## 8. Lifecycle (Alert / Update / Cancel / expirace)

| Funkce | Stav v kódu | Poznámka |
|---|---|---|
| Alert | implementováno | `identity` + `revisions` |
| Update + references | implementováno | thread přes references |
| Cancel | implementováno | status `zruseno` |
| Expirace `expires` | částečně | `activeFromRevision` kontroluje `valid_to`; prázdné expires = aktivní |
| Persistovaná revision historie napříč běhy | slabá | každý sync zpracuje jen nové docs; store není dlouhodobě slučován napříč bulletiny |
| Merge oblastí při stejné logické výstraze | částečně | v rámci jednoho bulletinu OK; napříč bulletiny ne (full replace) |

---

## 9. Cache / PWA / local-first

| Vrstva | Riziko |
|---|---|
| Service Worker / Cache Storage | Po opravě feedu nutná invalidace cache verzí `info_events` (CACHE_BUST v UI už existuje pattern) |
| CDN / Pages | Deploy až po merge do main |
| IndexedDB / Uložit / Skrýt | ID prefix `ie-chmi-v2-*`; migrace z legacy existuje |
| Stará produkční cache | Může držet 3 položky, dokud se nenačte nový `feed.json` |

---

## 10. Plán opravy (Fáze B–K)

### Fáze B — reprodukce (hotovo v auditu)
- Potvrzeno: produkce 3 = starý bulletin; automation 14 = aktuální teplo; oficiální zdroj má i sucho v jiných souborech.

### Fáze C — parser / normalizace
1. Zachovat zpracování všech info/area (už OK).
2. Doplnit do feed itemu: `description`, `instruction`, `areasSummary`, úplné ORP názvy / geo links.
3. Titulek: souhrnná lokalita (např. kraj / „Praha a dalších N oblastí“), ne jen první ORP.
4. Zvážit nepublikovat „Výhled jevů“ se severity Unknown (nebo oddělený lifecycle).

### Fáze D — geografie
1. Exportovat kompletní `geo.links` do publikované položky.
2. Hierarchický match: obec/město → ORP → okres → kraj (registry + UI localities).
3. Metriky unmapped + guard prahu pokrytí.

### Fáze E — deduplikace / lifecycle
1. **Multi-bulletin active set:** načíst N nejnovějších (nebo všechny „aktuální“ podle sent/expires) a sloučit aktivní thrady; ne full-wipe jedním souborem.
2. Update: nahradit thread; Cancel/expirace: vyhodit z aktivních.
3. Sloučení oblastí při stejné hazard identitě: union orpIds.

### Fáze F — publikace / API
1. Opravit merge path datového PR (viz níže).
2. Žádný pevný limit 3; success = úplnostní metriky.

### Fáze G — frontend filtry
1. `regionMatches` přes ORP kódy / hierarchii, ne jen text jména primary.
2. Karta: souhrn území + relevantní lokalita vůči filtru.

### Fáze H — cache
1. Bump CACHE_BUST info systému.
2. Ověřit SW upgrade bez reload smyčky.

### Fáze I — monitoring / guardy
1. Metriky: capMessages, infoBlocks, logicalAlerts, areas, mapped, unmapped, coverage%, lastCapSent, publishedActive.
2. Alert při `sourceActive > publishedActive`, `unmapped > 0`, `lastCapSent ≫ lastPublish`, stuck old snapshot.
3. Guard: all areas preserved; no first-info-only; no drought-only whitelist; no hard limit 3.

### Fáze J — testy
- Fixtures dle §20 zadání (multi event, multi info, multi area, city→ORP, update/cancel, unknown event/area, cache).

### Fáze K — PR / CI / produkce
1. Opravit workflow publish dat.
2. CI zelené; merge; produkční porovnání s CAP.

### Oprava publish cesty (P0)

**Problém:** Branch protection vyžaduje `repo-guard`, `layout-guard`, `smoke`. Automation větev je force-push data-only a **nespouští** tyto checky → `gh pr merge --auto` visí navždy; `|| true` maskuje selhání.

**Varianty:**

| Varianta | Popis | Dopad |
|---|---|---|
| **A (nejrychlejší)** | Data-only commit přímo na `main` přes bot token s výjimkou / `workflow_dispatch` pages (pokud policy dovolí) | Rychlé, ale obchází PR model |
| **B (nejbezpečnější)** | Dedicated data-sync workflow s paths-filter: data-only PR spouští odlehčené required checks (nebo label `data-only` + conditional required contexts) | Stabilní, více práce na CI |
| **C (nejčistší)** | Sync zapisuje do artifactu / Cloudflare KV / Pages data branch bez PR; main obsahuje jen kód; runtime bere feed z data endpointu | Architekturní změna |

**Doporučení auditu:** **B** + krátkodobě zajistit, aby data PR dostal required checks (paths-ignore smoke/layout pro čistě `projects/data/info_events/**`, nebo explicitní no-op green jobs na automation větvi).

Současně **zvýšit `IU_CHMI_CAP_V2_MAX_FILES`** (např. 8–20) a změnit publish na **slučování aktivních threadů** napříč bulletiny, ne replace jedním souborem.

---

## 11. Migrační dopad

| Oblast | Dopad |
|---|---|
| Stabilní ID `ie-chmi-v2-*` | Preferovat zachování `hazard_instance_id`; při změně identity nutná migrační mapa |
| Uživatelské stavy | Migrace legacy→v2 již existuje; při změně hash identity nutné rozšíření |
| Datový model feed itemu | Zpětně kompatibilní rozšíření polí (`capV2.geo`, description) |
| Automation PR #7842 | Po opravě CI buď mergnout aktuální snapshot, nebo přegenerovat |

---

## 12. Cache dopad

- Po nasazení nového feedu: bump `CACHE_BUST` v `iu-prehled-dne-ui-v1.js` / core.
- Ověřit, že SW nevrací starý `feed.json` s 3 položkami.
- Offline snapshot: po sync online nahradit; nepřepisovat Uložit/Skrýt.

---

## 13. Rollback plán

| Vrstva | Rollback |
|---|---|
| Parser / normalize | Revert commitů fix větve; CAP v2 zůstane active |
| Discovery maxFiles | Env/var zpět na 1 (dočasně) |
| Feed snapshot | Obnovit last-known-good `feed.json` z gitu / `feed.prev.json` |
| Frontend filtr | Revert UI commit; textový filtr zůstane degradovaný ale funkční |
| Cache | Další CACHE_BUST bump |
| **Zákaz** | Neobnovovat mediální agregátor; nevypínat CAP v2 sync |

---

## 14. Akceptační kritéria (zkráceně z zadání)

- [ ] Všechny aktuální CAP bulletiny s aktivními výstrahami načteny (ne jen 1 soubor bez merge)
- [ ] Všechny relevantní info bloky zpracovány
- [ ] Všechny aktuální typy jevů publikovány (teplo, zátěž, sucho, požáry, …)
- [ ] Úplné ORP seznamy + hierarchický filtr města
- [ ] Jedna logická karta ≠ jedna náhodná obec
- [ ] Update / Cancel / expirace
- [ ] Monitoring úplnosti (ne jen count > 0)
- [ ] Data PR se skutečně dostane do main + produkce
- [ ] CI zelené; stashe cizí nedotčené; bez návratu media agregátoru

---

## 15. Git snapshot na začátku auditu

| Položka | Hodnota |
|---|---|
| Branch před úkolem | `main` |
| HEAD | `97f0b5778e4f764d7b8d0208c84ef77a028183dd` |
| Working tree | čistý |
| Nová větev | `fix/chmi-cap-completeness-and-geo-filtering` |
| Otevřené relevantní PR | #7842 chore(data): refresh CHMI CAP v2 snapshot (OPEN, bez checks) |
| Stashe | desítky historických; **nedotčeny** |

---

## 17. Stav dokončení (2026-07-29 večer)

Následující opravy doplněny po PR #7857:

1. **Odstraněn pevný `maxFiles` / `slice(0,N)`** — discovery `opendata_active_streams` bere **nejnovější bulletin každého produktového streamu** (`alert_cap_50_*`, `alert_cap_70_*`, …).
2. Neúplný sync → **FAIL**, žádný silent HEALTHY, last-known-good feed zachován.
3. CI faily #7857: cache-bust guard + freeze hash `projects/index.html`.
4. Workflow čeká na required checks; starý data PR #7842 se uzavírá.
5. `scripts/chmi-cap-v2-prod-verify.mjs` — end-to-end PRODUCTION_VERIFIED.

Detailní závěrečný report po merge + produkčním ověření.

