# AUDIT — ČHMÚ CAP v2 Architecture Closeout (DEFINITIVE)

**Datum uzavření dokumentace:** 2026-07-30  
**Merge #7864 (architektura):** `ba66581b8c`  
**Merge #7874 (cache epoch):** `e0099bfe12`  
**Merge #7875 (data sync):** `4bac674c28`

---

## 1. Git

| Položka | Hodnota |
|---------|---------|
| Výchozí HEAD (začátek closeout větve) | `fc516249ed` |
| Pracovní větev closeout | `chore/chmi-cap-v2-architecture-closeout` |
| PR #7864 | **MERGED** 2026-07-30T00:06:17Z → `ba66581b8c` |
| PR #7874 | **MERGED** 2026-07-30T00:42:04Z → `e0099bfe12` |
| PR #7875 | **MERGED** 2026-07-30T00:45:05Z → `4bac674c28` |
| Docs PR #7876 | tato dokumentace |
| Cizí stashe | **nedotčené** |

---

## 2. Původní příčina (proč jen 3 výstrahy)

Produkce zobrazovala pouze 3 položky (sucho), zatímco oficiální CAP obsahoval i teplo, zátěž teplem, riziko požárů atd.

**Dvě spojené příčiny:**

1. **Data PR se nesloučil** — automation větev neměla required checks → starý snapshot zůstal na main/Pages.
2. **`maxFiles=1` + plná náhrada `sourceId=chmi`** — bral se jen nejnovější XML podle Apache mtime. Streamy `alert_cap_50_*` (meteo) a `alert_cap_70_*` (sucho/hydro) běží **paralelně**; jeden globální „nejnovější soubor“ zahodil druhý stream.

**Oprava:** odstraněn `IU_CHMI_CAP_V2_MAX_FILES` / `slice(0, maxFiles)`. Discovery = **jeden head na každý produktový stream** (bez pevného N).

---

## 3. Discovery a supersession model

### Datově řízené discovery

1. GET open-data index → `listCapXmlFromIndex`.
2. `capProductKeyFromUrl` → klíč z `alert_cap_{N}_*` (**bez whitelistu** produktů 50/70).
3. `selectLatestPerProductStream` → max mtime na stream (tie-break jméno).
4. Sync stáhne **jeden head / stream**; 304 → `bulletinCache`.
5. Publish jen při `completenessOk` + `snapshotContractValid`; jinak FAIL + last-known-good.

**Pevný funkční limit počtu CAP dokumentů / stream heads: NE.**

### Supersession head model ČHMÚ (Variant A)

Každý novější soubor produktového streamu je **úplný superseding snapshot** aktuálních výstrah daného produktu. Vynechání jevu v novějším headu = autoritativní změna stavu ČHMÚ (ukončení/nahrazení), typicky **bez** explicitního Cancel.

Nezávislý oracle = aktivní info v nejnovějším dokumentu podle CAP `sent` (ne volání `selectLatestPerProductStream` pro potvrzení sebe sama). Empiricky: `mtime` head ≡ `sent` head.

**Naivní full-archive CAP lifecycle replay je chybný** pro tento zdroj: drží „ghost“ vlákna s prázdným `expires` (např. Dotok 2025) → stovky falešně aktivních.

---

## 4. Empirický oracle (659 XML)

### Běhy

| Běh | Výsledek | Poznámka |
|-----|----------|----------|
| První empirický běh (task `975433`) | **předčasně ukončen** (proces zabit při hangnutí stahování) | **Nebyl úspěšný** — nesmí se citovat jako PASS |
| Finální empirický běh (disk cache, opravený oracle) | **PASS** | `SNAPSHOT_CONTRACT_PASS` |

### Výsledky finálního běhu

| Stream | Hist. souborů | Head aktivní | Sent-oracle | Prod path | Oblasti | Výsledek |
|--------|---------------|--------------|-------------|-----------|---------|----------|
| 50 | 631 | 11 | 11 | 11 | shoda | PASS |
| 70 | 28 | 3 | 3 | 3 | shoda | PASS |

```
CHMI_CAP_SNAPSHOT_CONTRACT=SNAPSHOT_CONTRACT_PASS
architectureDecision=VARIANT_A_CHMI_PRODUCT_SUPERSESSION_HEAD_ONLY
historicalMismatches=0
```

Syntetické / fixture testy (architecture-validation, stress 20…300) dokládají obecnost algoritmu; **produkční důkaz úplnosti** je empirický oracle + `iu-chmi-cap-v2-prod-verify`, ne samotný syntetický stress.

---

## 5. Opravy kódu (closeout vlna)

| Oprava | Účel |
|--------|------|
| Odstranění `maxFiles` / dead `maxCapMessagesPerRun` | Žádný tichý limit počtu bulletinů |
| `CAP_TRUNCATED` ve parseru | Fail-closed při překročení stropů (info/areas/geocodes/polygon/params/refs) — **nikdy tiché oříznutí** |
| Per-hazard expirace v `normalize-feed.mjs` | Expirovaný info blok není `aktivni` jen proto, že sourozenec ve stejné revizi žije |
| `BULLETIN_CACHE_EPOCH` v `prod-sync.mjs` | Po změně sémantiky normalizace se 304 cache nesmí držet staré `aktivni` |
| `snapshotContractValid` v diagnostice | Neúplnost / porušení smlouvy → FAIL, ne HEALTHY |
| Regrese A+B fixtures + architecture suite | Omission vs cross-stream; stress až 300 docs |

---

## 6. Produkční gate (doložený stav při closeout sync)

```
CHMI_CAP_V2_PROD_VERIFY=PRODUCTION_VERIFIED
streams=2
expectedActive=14
productionActive=14
diffs=0
alarms=
```

City filters Praha / Brno / Plzeň / Benešov / Rumburk: ok.  
Diagnostics: `snapshotContractValid=true`, `status=healthy`, alarms=[].

**Počet 14 není trvalá konstanta.** Je to snapshot živých oficiálních dat v okamžiku ověření. Guard vyžaduje:

- `expectedActive = productionActive`
- kanonické rozdíly = 0
- aktivní alarmy úplnosti = 0

Nikoli pevné `14`.

---

## 7. Závěrečná tabulka (closeout okamžik)

| Vrstva | Streamy | Dokumenty | Aktivní | Výsledek |
|--------|---------|-----------|---------|----------|
| Oficiální index | 2 | 659 listed | — | OK |
| Head model | 2 | 2 heads | 14 (tehdy) | PASS |
| Sent-oracle | 2 | 2 | 14 | PASS (`historicalMismatches=0`) |
| Normalizace | 2 | 2 | 14 | PASS (per-hazard expiry) |
| Data PR #7875 | — | — | 14 | MERGED |
| Main | — | — | — | obsahuje #7864+#7874+#7875 |
| Produkční feed / API / UI | 2 | — | 14 = 14 | PRODUCTION_VERIFIED |

---

## 8. ANO / NE

| Otázka | Odpověď |
|--------|---------|
| Existuje v produkční cestě pevný funkční limit počtu CAP dokumentů? | **NE** |
| Je úplnost závislá na nejnovějším souboru každého produktového streamu? | **ANO** — CHMI product supersession (empiricky) |
| Je prokázáno, že nejnovější soubor je úplný snapshot produktu? | **ANO** — head ≡ sent-oracle, 0 hist. mismatch |
| Byla snapshotová vlastnost ověřena proti historickému oracle? | **ANO** |
| Existují blokující nevyřešené cross-document references? | **NE** — head je self-contained |
| Může InfoUzel omylem ztratit stále aktivní výstrahu pouze proto, že načítá novější stream head? | **NE** — historická head-versus-sent-oracle validace nad 659 XML potvrdila supersession snapshotovou smlouvu bez rozdílů. Absence položky v novějším autoritativním headu představuje změnu aktuálního stavu ČHMÚ (autoritativní nahrazení předchozího snapshotu), nikoli tiché oříznutí InfoUzelu. |
| Může dojít ke ztrátě oblasti při validním publish? | **NE** |
| Může nový produktový stream zůstat neobjeven? | **NE** — datový klíč, bez whitelistu |
| Může nový stream projít bez ověření úplnosti? | **NE** |
| Může parser tiše oříznout dokument? | **NE** — `CAP_TRUNCATED` |
| Může být neúplný feed publikován jako HEALTHY? | **NE** |
| Může být PRODUCTION_VERIFIED založen pouze na shodném počtu položek? | **NE** — eventy + oblasti + city filtry |
| Může se původní chyba (`maxFiles=1`) zopakovat bez alarmu? | **NE** |
| PR #7864 / #7874 / #7875 sloučené? | **ANO** |
| Živá produkce odpovídala oficiálnímu CAP při closeout sync? | **ANO** — tehdy 14=14, diffs=0, alarms prázdné |

---

## 9. Verdikt

# ČHMÚ CAP V2 JE DEFINITIVNĚ UZAVŘENO

(podmíněno sloučením docs PR #7876 po zeleném CI a závěrečnou nemutační produkční kontrolou `PRODUCTION_VERIFIED` s diffs=0 a prázdnými alarmy.)
