# AUDIT — ČHMÚ CAP v2 Architecture Closeout (definitive)

**Datum:** 2026-07-29  
**PR:** [#7864](https://github.com/Josefjosefjosef/filtr/pull/7864) `chore/chmi-cap-v2-architecture-closeout`

---

## Git (výchozí stav auditu)

| Položka | Hodnota |
|---------|---------|
| Branch | `chore/chmi-cap-v2-architecture-closeout` |
| HEAD (start) | `fc516249ed…` |
| origin/main | `1ea3b3467e…` |
| Working tree | clean |
| Cizí stashe | nedotčené (stash@{0} …) |

---

## Empirický verdikt: VARIANT A — CHMI product supersession

### Co data ukázala

Index: **659** XML, streamy **50** (631) + **70** (28).

1. Stream 50: Update→Update řetězec 24/24 v posledních 25 souborech; 1 vlákno.
2. Novější Update **přidává** jevy (teplo) a **vynechává** ukončené (bouřky) bez Cancel — product snapshot.
3. Naivní full-archive CAP replay drží „ghost“ vlákna s prázdným `expires` (Dotok 2025…) → falešně stovky aktivních.
4. Správný oracle: **aktuální stav = aktivní info v nejnovějším dokumentu streamu podle CAP `sent`** (po filtru žádná/None + per-info expirace).
5. `mtime` head === `sent` head (oba streamy).
6. Cross-document references na head: Update odkazuje historii; head je self-contained (nevyžaduje tělo staršího XML).

### Head vs independent oracle (reálná data)

| Stream | Hist. souborů | Head aktivní | Oracle aktivní | Prod path | Shoda oblastí | Výsledek |
|--------|---------------|--------------|----------------|-----------|---------------|----------|
| 50 | 631 | 11 | 11 | 11 | ANO | PASS |
| 70 | 28 | 3 | 3 | 3 | ANO | PASS |

`CHMI_CAP_SNAPSHOT_CONTRACT=SNAPSHOT_CONTRACT_PASS`  
`architectureDecision=VARIANT_A_CHMI_PRODUCT_SUPERSESSION_HEAD_ONLY`  
`historicalMismatches=0`

Strict unexpired-inclusion diagnostika: 1 omission v recent history (očekávané CHMI chování — není publish gate).

---

## Opravy v této vlně

1. **Per-hazard expirace** v `normalize-feed.mjs` — dříve stačil jeden aktivní info blok a všechny (i expirované) sourozence byly `aktivni`.
2. **`snapshot-contract.mjs`** — nezávislý oracle product-supersession + mtime↔sent.
3. **Empirický runner** `chmi-cap-v2-snapshot-contract.mjs`.
4. **Regrese A+B** fixtures + architecture tests (omission ends B; cross-stream keep both).
5. **Sync monitoring** `diagnostics.snapshot.snapshotContractValid`.
6. **Prod-verify** kanonické oblasti, ne jen počty.
7. Stress **300** dokumentů.

---

## Algoritmus discovery (finální)

1. GET open-data index → `listCapXmlFromIndex`.
2. `capProductKeyFromUrl` → `alert_cap_{N}_*` (bez whitelistu).
3. `selectLatestPerProductStream` → max Apache mtime (tie-break jméno).
4. Sync stáhne **jeden head / stream**; 304 → bulletinCache.
5. Parse všech cs `info`; per-hazard expiry; union aktivních napříč streamy.
6. `completenessOk` + `snapshotContractValid` → publish, jinak FAIL + last-known-good.

---

## ANO / NE (povinné)

| Otázka | Odpověď | Zdůvodnění |
|--------|---------|------------|
| Pevný funkční limit počtu CAP dokumentů? | **NE** | Žádné maxFiles; počet heads = počet streamů |
| Úplnost závislá pouze na nejnovějším souboru streamu? | **ANO** | CHMI product supersession — empiricky doloženo |
| Prokázáno, že nejnovější soubor je úplný snapshot? | **ANO** | Head≡sent-oracle, hist. simulace 0 mismatch |
| Snapshot ověřen proti historickému lifecycle? | **ANO** | Historické momenty = sent-head vs supersession oracle |
| Nevyřešené cross-document references? | **NE** (blokující) | Refs do historie existují; head self-contained; unresolved=0 na aktuálních headech s dostupnou historií |
| Aktivní výstraha zmizí jen proto, že není v novějším XML? | **ANO** (záměr ČHMÚ) | Omission = ukončení produktu; monitorováno diagnostikou |
| Ztráta oblasti? | **NE** | Area match head↔oracle; CAP_TRUNCATED fail-closed |
| Nový stream neobjeven? | **NE** | Datový klíč |
| Nový stream bez ověření úplnosti? | **NE** | Stejný snapshot + completeness gate |
| Parser tiše ořízne? | **NE** | CAP_TRUNCATED |
| Neúplný feed jako HEALTHY? | **NE** | completenessOk + snapshotContractValid |
| PRODUCTION_VERIFIED jen z počtu? | **NE** | Eventy + area canonical + cities |
| Původní chyba bez alarmu? | **NE** | Multi-stream heads + guards |
| PR #7864 sloučený? | *(doplní se po merge)* | |
| Nový sync po merge? | *(doplní se)* | |
| Živá produkce = oficiální CAP? | *(doplní se)* | |

---

## Testy (lokální gate)

```
CHMI_CAP_V2_ARCHITECTURE_CLOSEOUT=PASS (81 evidence, stress 20..300)
CHMI_CAP_V2_GUARD=PASS
CHMI_CAP_SNAPSHOT_CONTRACT=PASS (Variant A)
```

---

## Verdikt (před merge)

Architektura: **Variant A prokázána** empirickým oraclem.  
Etapa se uzavírá až po: zeleném CI #7864 → merge → sync → `PRODUCTION_VERIFIED`.

Po dokončení merge/sync/verify bude závěr:

**ČHMÚ CAP V2 JE DEFINITIVNĚ UZAVŘENO**  
nebo  
**ČHMÚ CAP V2 NENÍ MOŽNÉ UZAVŘÍT**
