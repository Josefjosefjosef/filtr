# AUDIT — ČHMÚ CAP v2 Architecture Closeout (DEFINITIVE)

**Datum uzavření:** 2026-07-30  
**Merge #7864:** `ba66581b8c`  
**Cache-epoch follow-up #7874:** `e0099bfe12`  
**Data sync po merge #7875:** `4bac674c28`

---

## Git

| Položka | Hodnota |
|---------|---------|
| Výchozí HEAD (audit start) | `fc516249ed` |
| Pracovní větev | `chore/chmi-cap-v2-architecture-closeout` |
| PR #7864 | **MERGED** 2026-07-30T00:06:17Z |
| Merge commit | `ba66581b8c` |
| Follow-up #7874 (cache epoch) | **MERGED** `e0099bfe12` |
| Data PR po sync #7875 | **MERGED** `4bac674c28` |
| Konečný main HEAD | `4bac674c28` |
| Working tree | clean |
| Cizí stashe | **nedotčené** |

---

## Rozhodnutí: VARIANT A — CHMI product supersession

### Empirie (659 XML, streamy 50+70)

| Stream | Hist. | Head | Oracle (sent) | Prod path | Oblasti | Výsledek |
|--------|-------|------|---------------|-----------|---------|----------|
| 50 | 631 | 11 | 11 | 11 | shoda | PASS |
| 70 | 28 | 3 | 3 | 3 | shoda | PASS |

`CHMI_CAP_SNAPSHOT_CONTRACT=SNAPSHOT_CONTRACT_PASS`  
`historicalMismatches=0`  
`mtime ≡ sent` head na obou streamech.

**Model:** každý novější soubor produktového streamu je úplný superseding snapshot aktuálních výstrah produktu. Vynechání jevu = ukončení (bez Cancel). Naivní full-archive CAP replay je chybný (ghost vlákna s prázdným `expires`).

Nezávislý oracle = aktivní info v nejnovějším dokumentu podle CAP `sent` (ne `selectLatestPerProductStream`).

---

## Implementace (souhrn)

1. Discovery: `opendata_active_streams` / `selectLatestPerProductStream` — bez maxFiles.
2. Parser: `CAP_TRUNCATED` fail-closed.
3. Normalize: **per-hazard expirace** (ne revision-level).
4. Sync: `snapshotContractValid` + `BULLETIN_CACHE_EPOCH` invalidace cache po změně sémantiky.
5. Prod-verify: eventy + kanonické oblasti + city filtry (ne jen počty).
6. Regrese A+B fixtures + stress 20…300.

---

## Produkce (finální gate)

```
CHMI_CAP_V2_PROD_VERIFY=PRODUCTION_VERIFIED
streams=2
expectedActive=14
productionActive=14
diffs=0
alarms=
events=Vysoké teploty|Velmi vysoké teploty|Velmi silná zátěž teplem|Silná zátěž teplem|Riziko požárů|Výhled jevů|Stav sucha|Hydrologické sucho
```

City filters Praha / Brno / Plzeň / Benešov / Rumburk: ok.

Diagnostics: `snapshotContractValid=true`, `status=healthy`, alarms=[].

---

## Závěrečná tabulka

| Vrstva | Streamy | Dokumenty | Aktivní | Oblasti | Reference | Výsledek |
|--------|---------|-----------|---------|---------|-----------|----------|
| Oficiální index | 2 | 659 listed | — | — | — | OK |
| Head model | 2 | 2 heads | 14 | 1115 mapped links | cross-doc OK | PASS |
| Sent-oracle | 2 | 2 | 14 | shoda | unresolved=0 (heads) | PASS |
| Normalizace | 2 | 2 | 14 | per-hazard expiry | — | PASS |
| Data PR #7875 | 2 | — | 14 | — | — | MERGED |
| Main | — | — | 14 | — | — | `4bac674c28` |
| Produkční feed | 2 | — | 14 | shoda | — | VERIFIED |
| API/UI | — | — | 14 | city filters ok | — | VERIFIED |

---

## ANO / NE

| Otázka | Odpověď |
|--------|---------|
| Pevný funkční limit počtu CAP dokumentů? | **NE** |
| Úplnost závislá pouze na nejnovějším souboru streamu? | **ANO** (CHMI supersession — empiricky) |
| Prokázáno, že nejnovější soubor je úplný snapshot? | **ANO** |
| Snapshot ověřen proti historickému supersession oracle? | **ANO** (0 mismatch) |
| Nevyřešené cross-document references (blokující)? | **NE** |
| Aktivní výstraha zmizí jen vynecháním v novějším XML? | **ANO** (záměr ČHMÚ / omission ends) |
| Ztráta oblasti? | **NE** |
| Nový stream neobjeven? | **NE** |
| Nový stream bez ověření úplnosti? | **NE** |
| Parser tiše ořízne? | **NE** |
| Neúplný feed jako HEALTHY? | **NE** |
| PRODUCTION_VERIFIED jen z počtu? | **NE** |
| Původní chyba bez alarmu? | **NE** |
| PR #7864 sloučený? | **ANO** |
| Nový produkční sync po merge? | **ANO** (#7875) |
| Živá produkce = oficiální CAP? | **ANO** (14=14, diffs=0) |

---

## Verdikt

# ČHMÚ CAP V2 JE DEFINITIVNĚ UZAVŘENO
