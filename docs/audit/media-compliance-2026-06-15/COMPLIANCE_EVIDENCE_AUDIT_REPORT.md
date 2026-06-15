# COMPLIANCE EVIDENCE AUDIT REPORT — P0 DŮKAZNÍ AUDIT

**Projekt:** InfoUzel.cz  
**Datum:** 2026-06-15  
**Navazuje na:** `YOUTUBE_GDPR_DPA_NIS2_AUDIT_REPORT.md`  
**Režim:** READ-ONLY — bez oprav, commitů, PR, deploye  
**Účel:** Potvrdit nebo vyvrátit zjištěné compliance mezery a určit **skutečnou** závažnost

---

## Executive summary

| Nález z předchozího auditu | Potvrzeno? | Revidovaná závažnost |
|----------------------------|------------|----------------------|
| `i.ytimg.com` před kliknutím / consent | **ANO** | MEDIUM (ePrivacy) |
| Chybí DPA evidence v repu | **ANO** | **MEDIUM** (ne HIGH — vendor DPAs existují externě, chybí interní evidence) |
| Chybí právní základ pro IP/logy | **ANO** | MEDIUM |
| InfoCentrum „při přehrání“ vs náhledy | **ANO** | MEDIUM |
| Broken placeholdery (2/3 slotů) | **ANO** | **LOW** (produkt, ne compliance) |
| NIS2 in scope | **NE** (potvrzeno out of scope) | LOW |

```
CRITICAL_RISK_FOUND=NO
IMMEDIATE_ACTION_REQUIRED=NO
COMPLIANCE_STATUS=YELLOW
```

---

## KROK 1 — YOUTUBE THUMBNAIL PRIVACY FORENZNÍ AUDIT

### Mechanismus (kód)

| Otázka | Odpověď | Důkaz |
|--------|---------|-------|
| Odkud se stahují náhledy? | Google CDN `i.ytimg.com` | `iuBuildYouTubeThumb()` → `https://i.ytimg.com/vi/{id}/hqdefault.jpg` (`assets/app.js:3326-3330`) |
| Kdy se stahují? | Při vykreslení `.iuVideoPoster` (CSS `background: var(--iuVideoThumb)`) | `assets/app.js:6464`, `assets/app.css` |
| Před kliknutím? | **ANO** | Playwright produkce 2026-06-15 |

### Produkční network důkaz (Playwright)

**URL:** `https://infouzel.cz/projects/?section=feed&topic=zpravy&nosw=1`  
**Skript:** `%TEMP%\iu_p0_thumb_forensic.mjs`

```
THUMBNAIL_PROVIDER=Google LLC / YouTube CDN (server: sffe)
THUMBNAIL_DOMAIN_LIST=i.ytimg.com
THUMBNAIL_REQUEST_BEFORE_CLICK=YES
THIRD_PARTY_CONTACT_BEFORE_CLICK=YES
IP_ADDRESS_EXPOSED_TO_THIRD_PARTY=YES
```

**Počet požadavků před kliknutím:** 2× GET na `i.ytimg.com` (3. request může být z předchozího slotu v cache)

**REQUEST_HEADERS_SAMPLE** (zachyceno Playwright, požadavek na `i.ytimg.com/vi/mP5ul4_QRkQ/hqdefault.jpg`):

```json
{
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …",
  "sec-ch-ua": "\"HeadlessChrome\";v=\"131\", \"Chromium\";v=\"131\" …",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "referer": ""
}
```

**RESPONSE_HEADERS_SAMPLE** (HTTP 200):

```json
{
  "server": "sffe",
  "content-type": "image/jpeg",
  "cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
  "report-to": "{\"group\":\"youtube\",\"max_age\":2592000,\"endpoints\":[{\"url\":\"https://csp.withgoogle.com/csp/report-to/youtube\"}]}",
  "timing-allow-origin": "*",
  "content-length": "19906"
}
```

**Poznámky k IP:** Každý GET na `i.ytimg.com` standardně předává IP klienta serverům Google. Cookies třetí strany v tomto requestu nebyly aplikací explicitně odeslány; Google může přesto logovat IP, UA a timing dle svých pravidel.

**Vyvrácení / upřesnění předchozího auditu:** Nález **potvrzen**. Kontakt není na `youtube.com` iframe, ale **je** kontakt na Google infrastrukturu přes thumbnail CDN.

---

## KROK 2 — LOKÁLNÍ CACHE THUMBNAILŮ (analýza, bez implementace)

```
LOCAL_THUMBNAIL_CACHE_POSSIBLE=YES
```

### CURRENT_IMPLEMENTATION=

- Thumbnail URL generováno za běhu: `iuBuildYouTubeThumb(id)` → přímý `i.ytimg.com`
- Nebo z pole `thumb` v `videos.json` (build zapisuje stejný `i.ytimg.com` pattern)
- Vykreslení: CSS background na `.iuVideoPoster` → browser fetch na Google
- SW (`sw.js`): network-first pro `videos.json`; seed offline obsahuje ytimg URL, **ne** mirror obrázků
- **Žádná** self-hosted kopie thumbnailů v `projects/data/`
- **Žádný** SW intercept/proxy pro `i.ytimg.com`

### POTENTIAL_IMPLEMENTATIONS= (pouze analýza)

| Varianta | Technická možnost | První návštěva Google? |
|----------|-------------------|------------------------|
| Build-time mirror do `projects/data/thumbs/` | ANO | Ne po deployi (jen při buildu CI) |
| SW cache po prvním fetchi | ANO | Ano — první návštěva stále kontaktuje Google |
| Self-hosted placeholder bez externího URL | ANO | Ne |
| Lazy-load thumb až po interakci/consent | ANO | Ne do interakce |
| `<img loading="lazy">` s lokálním blob z prior fetch | ANO | Závisí na triggeru |

```
RISK_LEVEL=MEDIUM
```

Riziko se týká **současného** přímého kontaktu s Google CDN, ne nemožnosti technického řešení.

---

## KROK 3 — YOUTUBE EMBED COMPLIANCE (produkce)

**Skript:** `%TEMP%\iu_p0_embed_audit.mjs`  
**Datum:** 2026-06-15

### Média feed (`?section=feed&topic=zpravy`)

```
USES_YOUTUBE_NOCOOKIE=YES (po kliknutí na poster)
USES_STANDARD_YOUTUBE=NO (na feed stránce před/po načtení bez AI panelu)
EMBED_CREATED_ONLY_AFTER_CLICK=YES
YOUTUBE_SCRIPT_LOADED_BEFORE_CLICK=NO
YOUTUBE_IFRAME_LOADED_BEFORE_CLICK=NO
```

**Po kliknutí na poster (důkaz):**
```
IFRAME_SRC_AFTER_CLICK=https://www.youtube-nocookie.com/embed/UJbQNpXppQk?autoplay=1&rel=0&playsinline=1&mute=1&controls=1&enablejsapi=1&origin=https%3A%2F%2Finfouzel.cz
NOCOOKIE_IN_EMBED=YES
```

### AI sekce (`?section=ai`) — počáteční load

```
YOUTUBE_IFRAME_LOADED_BEFORE_CLICK=NO (0 iframe v DOM bez otevření panelu)
YOUTUBE_SCRIPT_LOADED=NO
YT_REQUESTS_BEFORE_CLICK=8 (primárně i.ytimg.com z jiných částí stránky / prefetch)
```

### Kód mimo ověřený produkční load (existence v repu)

| Surface | Doména | Load trigger | Důkaz |
|---------|--------|--------------|-------|
| Média feed | youtube-nocookie.com | click | `app.js:3336`, `23726-23728` |
| AI grid | youtube.com/embed | render panelu | `app.js:24768-24773` |
| Překladač | youtube-nocookie.com | otevření sekce | `app.js:27524-27528` |

**Vyvrácení předchozího auditu:** Tvrzení „Média embed je nocookie + click-to-play“ → **POTVRZENO** produkčním testem. Tvrzení o AI standard YouTube → **POTVRZENO v kódu**, na produkci **neověřeno eager load** (panel nebyl otevřen).

---

## KROK 4 — DPA EVIDENCE AUDIT

Prohledáno: celý repozitář (md, json, html, yml, txt), governance reporty, Info Centrum, workflow komentáře, Cloudflare wrangler config.

```
GITHUB_DPA_EVIDENCE_FOUND=NO
CLOUDFLARE_DPA_EVIDENCE_FOUND=NO
LOCATION=— (žádný interní soubor, odkaz, poznámka o uzavření, screenshot, registry)
```

**Co existuje (ne DPA):**
- `legal_obligation_mapping_report.json` — area `"DPA"`, status `"REQUIRED"` (interní gap flag)
- `GDPR_DEEP_AUDIT_REPORT.md` — „No DPA references“
- `INFO_CENTER_LEGAL_HARDENING_REPORT.md` — „ROPA, DPA … not in Info Center by design“
- Info Centrum tabulka GitHub Pages / Cloudflare Workers (`index.html:6327-6329`) — popis zpracování, **ne** DPA

```
MISSING_EVIDENCE_ONLY=YES
DPA_LIKELY_NONEXISTENT=NO
```

**Upřesnění závažnosti:** GitHub a Cloudflare nabízejí standardní DPA jako součást obchodních podmínek / dashboardu (mimo repozitář). **Chybí interní evidence**, že Media Uzel s.r.o. DPA eviduje, archivuje nebo mapuje na Art. 28. To je **compliance mezera dokumentace**, ne nutně absence smlouvy u vendora.

**Revize předchozího auditu:** Závažnost DPA snížena z **HIGH → MEDIUM** (interní gap, ne prokázaná absence vendor DPA).

---

## KROK 5 — CLOUDFLARE / GITHUB LOGGING AUDIT

### GitHub

```
GITHUB_LOGGING_PRESENT=YES
```

| Log typ | Pravděpodobný vznik | Evidence |
|---------|---------------------|----------|
| GitHub Pages access logy | HTTP požadavky na statický hosting | Info Centrum: „IP při HTTP požadavku“ |
| GitHub Actions build logy | CI workflow běhy | `.github/workflows/*`, Info Centrum tabulka |
| Repo metadata | Commits, PR, artifacts | standardní GitHub |

### Cloudflare

```
CLOUDFLARE_LOGGING_PRESENT=YES (conditional — pokud Workers nasazeny)
```

| Log typ | Evidence |
|---------|----------|
| Workers observability | `cloudflare/articles-watchdog/wrangler.toml:18-21` — `[observability] enabled = true` |
| VIN worker | `cloudflare/vin-worker/` existuje v repu |
| CDN/proxy logy | standardní u Cloudflare účtu (mimo repozitář) |

```
IP_PROCESSING_PRESENT=YES
PURPOSE_OF_PROCESSING=technický provoz hostingu/CDN, doručení statického obsahu, volitelně API proxy (VIN, articles-watchdog)
EXPECTED_LEGAL_BASIS=— (v live UI neuvedeno; historicky navrhováno „oprávněný zájem“ v odstraněné matici — viz INFO_CENTER_FINAL_LEGAL_VALIDATION.md)
```

**Analytics od provozovatele:** `iu-consent.js` — stub only, `__IU_ANALYTICS_ACTIVE__=false`, žádný gtag/Umami loaded.

---

## KROK 6 — INFOCENTRUM VS REALITA (konkrétní věty)

### Nesoulad #1 — Cookies / třetí strany

```
STATEMENT_TEXT="Při přehrání videa (YouTube / youtube-nocookie.com) nebo načtení počasí (Open-Meteo) mohou tyto služby ukládat vlastní technická data dle svých pravidel."
ACTUAL_BEHAVIOR=Google CDN i.ytimg.com načítá thumbnail JPEG při vykreslení video karty v feedu, před kliknutím na přehrání a před consent lištou (statistiky).
MATCH=NO
```
**Zdroj:** `projects/index.html:6171`  
**Network důkaz:** `THUMBNAIL_REQUEST_BEFORE_CLICK=YES`

---

### Nesoulad #2 — Privacy tabulka YouTube

```
STATEMENT_TEXT="YouTube / Google | embed videí | technická data při přehrání dle Google"
ACTUAL_BEHAVIOR=Technický kontakt s Google (i.ytimg.com) nastává již při zobrazení náhledu, ne až při embed/přehrání.
MATCH=NO
```
**Zdroj:** `projects/index.html:6331`

---

### Nesoulad #3 — Externí odkazy

```
STATEMENT_TEXT="Externí odkazy — mapy, dopravci, YouTube, AI nástroje z MindMenu (po kliknutí)"
ACTUAL_BEHAVIOR=Náhledy YouTube (i.ytimg.com) se načítají automaticky při scrollu/feed renderu bez kliknutí. Embed iframe až po kliknutí — tato část sedí.
MATCH=PARTIAL → NO (pro thumbnail část)
```
**Zdroj:** `projects/index.html:6377`

---

### Soulad #4 — Média embed po kliknutí

```
STATEMENT_TEXT=(implicitně cookies D + privacy tabulka — „při přehrání“)
ACTUAL_BEHAVIOR=youtube-nocookie.com iframe vytvořen až po click na poster; produkční IFRAME_SRC_AFTER_CLICK potvrzuje nocookie URL.
MATCH=YES (pro iframe/embed část)
```

---

### Nesoulad #5 — IP / provozní logy

```
STATEMENT_TEXT="provozní logy hostingu/CDN (pokud vzniknou u poskytovatele infrastruktury)"
ACTUAL_BEHAVIOR=GitHub Pages a Cloudflare pravděpodobně logují IP; text neuvádí právní základ (Art. 6 GDPR).
MATCH=PARTIAL → NO (pro právní základ; popis existence logů sedí)
```
**Zdroj:** `projects/index.html:6307`, tabulka `:6327-6329`

---

### Soulad #6 — Analytics default off

```
STATEMENT_TEXT="Anonymní statistiky … volitelné a defaultně vypnuté"
ACTUAL_BEHAVIOR=iu-consent.js stub, žádný analytics vendor loaded.
MATCH=YES
```
**Zdroj:** `index.html:6128`, `iu-consent.js:101-111`

---

## KROK 7 — BROKEN PLACEHOLDER DIAGNOSTIC

**Skript:** `%TEMP%\iu_p0_placeholder_diag.mjs`  
**Produkce:** `?section=feed&topic=zpravy`

```
VIDEO_POOL_COUNT=25
VISIBLE_VIDEO_COUNT=3
BROKEN_PLACEHOLDER_COUNT=2
ROOT_CAUSE=iuPickVideosForSlots() vrátí méně videí než slotCount a při nenalezení kandidáta ukončí výběr (if (!chosen) break; app.js:4517). localStorage fronta iu_video_queue_v1:vse má sloty 2 a 3 s prázdným videoId. Kombinace: dedupe mapa iu_video_seen_v1 (3 ID označena seen), striktní střídání jazyků CZ/EN, filtr seen v pick algoritmu (app.js:4470), monotonic timestamp constraint — pro slot 1 (EN) nebyl nalezen eligible kandidát → pick loop break → sloty zůstanou jako buildPlaceholderCard().
ROOT_CAUSE_CONFIRMED=YES
```

**Důkaz localStorage (Playwright evaluate):**
```json
{
  "iu_video_queue_v1:vse": {
    "slots": [
      {"slot":1,"videoId":"mP5ul4_QRkQ","lang":"cz"},
      {"slot":2,"videoId":"","lang":""},
      {"slot":3,"videoId":"","lang":""}
    ]
  },
  "iu_video_seen_v1": {
    "nTBLdO7j0WY": 1781547372443,
    "701bUUpb618": 1781547372489,
    "mP5ul4_QRkQ": 1781547372581
  }
}
```

**DOM:**
```json
[
  {"slot":"0","ytid":"mP5ul4_QRkQ","placeholder":null},
  {"slot":"1","ytid":null,"placeholder":"1","title":"Načítám video…"},
  {"slot":"2","ytid":null,"placeholder":"1","title":"Načítám video…"}
]
```

**Kód placeholderu:** `buildPlaceholderCard()` — `assets/app.js:3817-3842`  
**Vyvrácení:** Toto **není** GDPR/compliance gap — je to **produktový bug** v queue picker logice.

---

## KROK 8 — REÁLNÉ PRÁVNÍ RIZIKO

Hodnocení zohledňuje: typ služby (informační portál, local-first), absence analytics, absence user accounts, rozsah zpracování, běžnou praxi u embed/thumbnail webů.

```
GDPR_RISK_LEVEL=MEDIUM
EPRIVACY_RISK_LEVEL=MEDIUM
DPA_RISK_LEVEL=MEDIUM
NIS2_RISK_LEVEL=LOW
```

| Oblast | Odůvodnění reálné závažnosti |
|--------|------------------------------|
| GDPR | Transparentnost a Art. 13/6 mezery (právní základ logů, thumbnail disclosure); ne masové zpracování osobních údajů |
| ePrivacy | Potvrzený kontakt Google CDN před interakcí; běžný pattern u YouTube integrací, ale deklarace neodpovídají |
| DPA | Interní evidence chybí; vendoři standardně DPA poskytují — riziko dokumentační, ne okamžité porušení |
| NIS2 | Likely out of scope; chybí IR docs, ale ne esenciální subjekt |

**CRITICAL_RISK_FOUND=NO** — žádný nález nevyžaduje okamžité vypnutí služby.

---

## KROK 9 — PRIORITIZACE

### P0_ITEMS= (nutné řešit okamžitě)

**Žádné** — forenzní audit neidentifikoval CRITICAL právní expozici vyžadující okamžící zásah (stop-ship).

*(Poznámka: Předchozí audit označil DPA jako P0 — revidováno na P1; absence interní evidence není ekvivalentní neexistující vendor DPA.)*

### P1_ITEMS= (vhodné řešit)

1. **Interní DPA registry / evidence** — GitHub + Cloudflare Art. 28 dokumentace mimo repozitář
2. **InfoCentrum texty** — doplnit `i.ytimg.com` náhledy (Cookies + Privacy §6) — potvrzený nesoulad
3. **Právní základ** pro IP/provozní logy hostingu (Art. 6 + LIA screening) — counsel review
4. **Queue picker bug** — 2/3 broken placeholders navzdory poolu 25 (produkt/důvěra)

### P2_ITEMS= (doporučení)

1. AI grid `youtube.com` vs nocookie konzistence (mimo primární Média flow)
2. Překladač eager nocookie iframes při otevření sekce
3. Standalone Terms of Service stránka
4. NIS2 incident response playbook
5. Orphan `iu-storage-notice.js` assets
6. SW/build-time thumbnail mirror (technická ePrivacy mitigace — analýza možná, neimplementováno)

---

## KROK 10 — SHRNUTÍ POTVRZENÍ / VYVRÁCENÍ

| ID | Předchozí nález | Verdikt | Revidovaná severity |
|----|-----------------|---------|---------------------|
| T1 | Thumbnaily před consent | **POTVRZENO** | MEDIUM |
| T2 | iframe nocookie po kliknutí | **POTVRZENO** | — (soulad) |
| T3 | DPA chybí | **POTVRZENO** (interní evidence) | HIGH → **MEDIUM** |
| T4 | Právní základ IP chybí | **POTVRZENO** | MEDIUM |
| T5 | InfoCentrum nesoulad | **POTVRZENO** (3 věty) | MEDIUM |
| T6 | Broken placeholders | **POTVRZENO** | produkt LOW |
| T7 | NIS2 in scope | **VYVRÁCENO** | LOW / out of scope |
| T8 | CRITICAL product risk (0 videos) | **ČÁSTEČNĚ VYVRÁCENO** | pool 25 videí obnoven; placeholder bug přetrvává |

---

## FINÁLNÍ VERDIKT

```
CRITICAL_RISK_FOUND=NO
IMMEDIATE_ACTION_REQUIRED=NO
COMPLIANCE_STATUS=YELLOW
```

**Důvody YELLOW (ne RED):**
- Potvrzené ePrivacy/GDPR transparency mezery u thumbnail CDN
- Chybí interní DPA evidence a právní základ pro logy
- Média embed design je v souladu s doporučením youtube-nocookie + click-to-play
- Žádné aktivní analytics, žádné user accounts, NIS2 likely out of scope

**Důvody ne GREEN:**
- Produkční kontakt Google před interakcí (thumbnaily) není v InfoCentru popsán
- Interní compliance dokumentace (DPA, Art. 6) chybí

---

## DŮKAZNÍ PŘÍLOHA — spuštěné skripty

| Skript | Účel |
|--------|------|
| `%TEMP%\iu_p0_thumb_forensic.mjs` | Thumbnail headers + timing |
| `%TEMP%\iu_p0_embed_audit.mjs` | Embed compliance + click test |
| `%TEMP%\iu_p0_placeholder_diag.mjs` | Placeholder root cause + localStorage |
| `%TEMP%\iu_yt_audit_prod.ps1` | videos.json inventory |

---

*Report vytvořen: 2026-06-15 · Bez commitů · Bez oprav · Navazuje na YOUTUBE_GDPR_DPA_NIS2_AUDIT_REPORT.md*
