# INFO_CENTER_LEGAL_REVIEW.md
## Info Center V2.3 — finální review před PR

**Datum review:** 2026-06-09  
**Status:** `INFO_CENTER_V2_3_READY_FOR_PR`

---

## Scope review

| Soubor | Stav |
|--------|------|
| `projects/index.html` | ✅ změněno (Info Center + Silver privacy + datovka helper) |
| `assets/iu-info-center.css` | ✅ beze změny od V2.1 (v scope) |
| `assets/iu-info-center.js` | ✅ beze změny od V2.1 (v scope) |
| `INFO_CENTER_LEGAL_REVIEW.md` | ✅ aktualizováno V2.3 |
| `assets/app.js` | ✅ **neměněno** |
| RSS / články / data / workflow / SW / backend | ✅ bez zásahu |

---

## V2.3 audit flags

```
PUBLIC_CONTACTS_AUDITED = YES
PUBLIC_CONTACT_EMAIL = info@infouzel.cz
EXTERNAL_SERVICES_VERIFIED = YES
ABSOLUTE_CLAIMS_REVIEW = PASS
ABSOLUTE_CLAIMS_FOUND = 3
ABSOLUTE_CLAIMS_REMAINING = 0
ANALYTICS_DISCLOSURE = PASS
VAT_PAYER_STATUS = NON_VAT_PAYER
DIČ_DISPLAYED = NO
EMAIL_UNIFICATION = PASS
```

---

## KROK 1 — Veřejné kontakty (audit celého projektu)

### Veřejně zobrazované kontakty v UI

| Umístění | E-mail | Poznámka |
|----------|--------|----------|
| Info Center → Provozovatel | `info@infouzel.cz` | ✅ správný veřejný kontakt |
| Info Center → Ochrana soukromí | `info@infouzel.cz` | ✅ |
| Footer webu | — | žádný e-mail v UI |
| Silver hero | — | žádný e-mail |
| Modály / finance / datovka | — | žádný provozní e-mail (jen uživatelská pole faktur) |

### Mimo veřejné UI (nezapisováno do UI, pouze audit)

| Umístění | E-mail | Akce V2.3 |
|----------|--------|-----------|
| `bot/index.html` | `admin@infouzel.cz` | **NEPŘEPSÁNO** — mimo scope; NEEDS REVIEW |
| `projects/bot/index.html` | `admin@infouzel.cz` | **NEPŘEPSÁNO** — mimo scope; NEEDS REVIEW |
| `scripts/update-weather-namedays.js` | `admin@infouzel.cz` | interní From header, ne UI |
| `scripts/build_weather_history.py` | `admin@infouzel.cz` | interní bot header, ne UI |
| `scripts/articles-missing-source-articles-guard.mjs` | `admin@infouzel.cz` | interní, ne UI |

**Závěr:** Veřejné UI v `/projects/` používá výhradně `info@infouzel.cz`. Bot stránky mají jiný kontakt — zdokumentováno, nesjednoceno (mimo povolený scope).

---

## KROK 2 — Externí služby (ověřeno v kódu)

Zdroje: `assets/iu-external-origins.js`, `assets/iu-parcel-tracking-engine.js`, `assets/app.js`, `projects/index.html`

```
EXTERNAL_SERVICES_LIST = [
  "api.open-meteo.com (počasí)",
  "www.youtube.com / www.youtube-nocookie.com / i.ytimg.com (videa)",
  "tracking.app.packeta.com / tracking.packeta.com (Zásilkovna)",
  "www.balikovna.cz (Balíkovna)",
  "www.ppl.cz (PPL)",
  "tracking.dpd.de (DPD)",
  "gls-group.com (GLS)",
  "trace.wedo.cz (WeDo)",
  "www.dhl.com (DHL)",
  "www.msng.cz (Messenger)",
  "www.ceskaposta.cz (formát zásilek — reference v parcel engine)",
  "idos.idnes.cz (IDOS — odkaz v UI)",
  "www.pid.cz (PID — odkaz v UI)",
  "mapy.cz (mapy, navigace, parcel dashboard)",
  "www.google.com/maps (mapy)",
  "www.openstreetmap.org (mapy)",
  "www.waze.com (navigace)",
  "www.deepl.com (překladač — odkaz MindMenu)",
  "ChatGPT / Gemini / Copilot / Claude (AI odkazy MindMenu)",
  "ilovepdf.com (převod souborů — odkaz MindMenu)",
  "RSS vydavatelé (ČT24, Seznam, Novinky, iRozhlas, Deník, sport/finance/zdraví vertikály — iu-sources.js, source_registry.json)",
  "www.google.com (externí vyhledávání)"
]
```

---

## KROK 3 — Absolutní tvrzení

### Nalezeno (před opravou): 3

| # | Text | Umístění | Riziko |
|---|------|----------|--------|
| 1 | „Co napíšeš… zůstává jen u tebe“ | Silver hero | absolutní privacy claim |
| 2 | „Nic neopouští tvoje zařízení“ | Silver hero | absolutní privacy claim |
| 3 | „Nikdy se neodesílají na server“ | Datovka helper | absolutní formulace |

### Opraveno V2.3

| Původní | Nové |
|---------|------|
| Co napíšeš… zůstává jen u tebe | Osobní záznamy ukládáme primárně v tvém zařízení |
| Nic neopouští tvoje zařízení | Část webu může používat externí služby |
| Nikdy se neodesílají… | neodesíláme je na server infoUzel.cz |

Info Center texty: bez nebezpečných absolutních privacy claimů. „negarantuje“ a „nemusí být dostupný nepřetržitě“ jsou správné negativní formulace.

---

## KROK 4 — Analytika

- V kódu **není** aktivní analytika (`document.cookie`, gtag, Plausible, Matomo — nenalezeno v app kódu).
- Info Center text: **„InfoUzel může v budoucnu zavést…“** — správně budoucí čas.
- Účel: zlepšování, chyby, vytížení — ✅
- Vyloučeno: profilování, prodej dat, sledování osob — ✅
- Požadavek na informování/souhlas před zavedením — ✅

---

## KROK 5 — DPH

Uživatel potvrdil: **Media Uzel s.r.o. není plátce DPH.**

- DIČ nikde v Info Center ani veřejném UI nezobrazeno — ✅
- Žádná DPH sekce nepřidána — ✅
- IČ zobrazeno (29482241) — správně pro neplátce

---

## KROK 6 — E-mail

Veřejné UI v `/projects/`: **výhradně `info@infouzel.cz`** — PASS.

Bot stránky (`admin@`) — mimo scope, NEEDS REVIEW pro budoucí sjednocení.

---

## Finální checklist PASS / RISK / NEEDS REVIEW

| Položka | Verdikt |
|---------|---------|
| GDPR informační povinnost | **PASS** |
| ePrivacy | **PASS** |
| Cookies | **PASS** |
| localStorage | **PASS** |
| sessionStorage | **PASS** |
| IndexedDB | **PASS** |
| Cache API | **PASS** |
| Service Worker | **PASS** |
| PWA | **PASS** |
| Provozovatel | **PASS** |
| Kontakt | **PASS** |
| Externí služby | **PASS** |
| YouTube | **PASS** |
| Open-Meteo | **PASS** |
| RSS | **PASS** |
| Doprava | **PASS** |
| Zásilky | **PASS** |
| Mapy | **PASS** |
| Budoucí analytika | **PASS** |
| Práva uživatele | **PASS** |
| Odpovědnost | **PASS** |
| Zákaz absolutních tvrzení | **PASS** (po V2.3 opravě) |
| Zákaz garance zachování dat | **PASS** |
| Finální review advokátem/DPO | **NEEDS REVIEW** |
| Bot kontakt `admin@` vs `info@` | **NEEDS REVIEW** |

---

## NEEDS REVIEW (zbývá)

1. **`admin@infouzel.cz`** na `/bot/` — veřejná bot stránka, mimo scope V2.3; doporučeno sjednotit v samostatném PR
2. **Finální právní review advokátem/DPO** — neprovedeno
3. **Budoucí analytika** — při zavedení nutná aktualizace textů + souhlas

---

## Verdikt

| Gate | Hodnota |
|------|---------|
| `READY_FOR_COMMIT` | **YES** |
| `READY_FOR_PR` | **YES** |
| `READY_FOR_MERGE` | **NO** |

**Finální status:** `INFO_CENTER_V2_3_READY_FOR_PR`

Produkce HOTOVO: **NE**
