# YOUTUBE / GDPR / DPA / NIS2 — FORENZNÍ COMPLIANCE AUDIT REPORT

**Projekt:** InfoUzel.cz  
**Datum auditu:** 2026-06-15  
**Režim:** READ-ONLY — žádné opravy, commity, PR ani deploy  
**Auditor:** Cursor (forenzní sken repozitáře + produkční ověření)

---

## Executive summary

| Oblast | Stav | Závažnost |
|--------|------|-----------|
| YouTube architektura | Zdokumentována, 77 zdrojů, 25 videí v produkčním poolu | — |
| YouTube GDPR (Média feed) | Částečný soulad — nocookie embed po kliknutí ✓, náhledy `i.ytimg.com` před souhlasem ✗ | MEDIUM |
| Privacy / InfoCentrum | Rozsáhlá dokumentace v UI, chybí právní základ pro IP/logy | MEDIUM |
| DPA (GitHub / Cloudflare) | **Nenalezena** formální evidence v repozitáři | HIGH |
| NIS2 | Orientační screening: LIKELY_OUT_OF_SCOPE | LOW |
| **Celkový compliance status** | **YELLOW** | — |

---

## KROK 1 — YOUTUBE ARCHITEKTURA

### YOUTUBE_FILES=

**Runtime / UI**
- `assets/app.js` — karty videí, náhledy, click-to-embed, fronta slotů, AI grid, překladač iframes
- `assets/app.css` — `.iuVideoPoster`, `.iuVideoCard`, weather video styles
- `projects/index.html` — CSP, InfoCentrum texty, `__iuLoadVideosJsonOnce`, video modal
- `assets/iu-external-origins.js` — registry třetích stran (YouTube domény)
- `sw.js` — network-first pro `videos.json`, offline seed s ytimg URL

**Data**
- `projects/data/videos.json` — produkční pool (Média feed)
- `projects/data/videos_allowlist.json` — 77 oficiálních kanálů
- `projects/data/videos_sources_audit.json` — výstup audit skriptu
- `projects/data/weather_history_videos.json` — weather YouTube picks
- `projects/data/weather_history_sources.json` — RSS/Atom zdroje pro weather

**Build / ingest**
- `scripts/build_videos.py` — primární builder → `videos.json`
- `scripts/build_articles.py` — legacy cesta přes `feeds_youtube.json`
- `scripts/feeds_youtube.json` — 2× ČT24 playlisty
- `scripts/build_weather_history.py` — weather Atom + oEmbed
- `scripts/video_audit.py`, `scripts/video_sources_audit.py`
- `scripts/iu_staging.py`, `scripts/iu_blocked_sources.py`
- `config/sources.json` — 2× `type: "videos"` ČT24 playlist entries

**CI / workflows**
- `.github/workflows/update-videos-data.yml` — cron `30 */1 * * *`, `build_videos.py`
- `.github/workflows/update-articles.yml` — ochrana `videos.json` před prázdným legacy přepisem
- `.github/workflows/update-weather-history.yml` — denní weather dataset
- `.github/workflows/embed-verify.yml` — Playwright embed verify (manual)
- `.github/workflows/ci-data-freshness.yml`, `nightly-health-report.yml`, `repo-guard.yml`

**Dokumentace / audit**
- `YOUTUBE_MEDIA_AUDIT_REPORT.md` (dřívější audit tentýž den, ráno)
- `video_pipeline_report.md`, `CSP_AUDIT_REPORT.md`, `GDPR_DEEP_AUDIT_REPORT.md`

### YOUTUBE_COMPONENTS=

| Komponenta | Soubor | Chování |
|------------|--------|---------|
| `buildYouTubeVideoPreviewCard()` | `assets/app.js:6449+` | Poster karta, `data-ytid`, CSS thumb `--iuVideoThumb` |
| `iuBuildYouTubeThumb()` | `assets/app.js:3326-3330` | `https://i.ytimg.com/vi/{id}/hqdefault.jpg` |
| `iuBuildYouTubeEmbedUrl()` | `assets/app.js:3332-3337` | `youtube-nocookie.com/embed/{id}?autoplay=1&…` |
| `iuInitFeedVideoPreviewEmbeds()` | `assets/app.js:23172+` | Click handler → iframe až po kliknutí |
| `iuEnsureVideoAnchors()` | `assets/app.js:3730+` | Vkládání karet každých 8 článků |
| `normalizeVideoList()` | `assets/app.js:4224+` | Normalizace `videos.json` |
| `__iuLoadVideosJsonOnce()` | `projects/index.html:5277+` | Single-flight fetch `videos.json?v={dataVer}` |
| `IU_AI_VIDEOS` + `renderAiVideos()` | `assets/app.js:24734-24777` | 9 statických iframe → `youtube.com/embed/` |
| Překladač iframes | `assets/app.js:27524-27528` | 5 statických `youtube-nocookie.com` iframe v DOM |
| Weather history video | `assets/app.js:17848+` | Reuse preview card + auto-click |

**Feature flags:** `IU_FEED_VIDEO_ENABLED=true`, `IU_FEED_VIDEO_EVERY=8` (`assets/app.js:1194-1197`)

### YOUTUBE_DATA_SOURCES=

1. **Primární:** `videos_allowlist.json` → `build_videos.py` → `videos.json`
2. **Legacy:** `feeds_youtube.json` (2 ČT24) → `build_articles.py` (chráněno proti commitu prázdného poolu)
3. **Produkce:** `https://infouzel.cz/projects/data/videos.json?v={iu-data-ver}`

### YOUTUBE_APIS=

| URL | Kdy | Kdo |
|-----|-----|-----|
| `youtube.com/feeds/videos.xml?channel_id=` | Build-time Atom | `build_videos.py` |
| `youtube.com/feeds/videos.xml?playlist_id=` | Build-time Atom | `build_videos.py`, `feeds_youtube.json` |
| `youtube.com/oembed?url=` | Build-time embeddability | `build_videos.py`, `build_weather_history.py` |
| `youtube.com/embed/{id}` | Build-time region probe | `build_videos.py` |
| `youtube-nocookie.com/embed/{id}` | **Runtime Média embed (click)** | `assets/app.js:3336` |
| `youtube.com/embed/{id}` | Runtime AI grid | `assets/app.js:24769` |
| `i.ytimg.com/vi/{id}/hqdefault.jpg` | Runtime + build thumbs | `assets/app.js:3329`, `build_videos.py` |

**YouTube Data API v3:** nepoužívá se (Atom + oEmbed only).

### YOUTUBE_FEEDS=

- Allowlist: 77 kanálů v 10 kategoriích (`videos_allowlist.json`), pouze `official: true`
- Legacy: 2× ČT24 playlist (`PLmjovsp6pTeMmUMUg37zgbo9CTmtqzAGQ`, `PLmjovsp6pTeOaU28zlFr4pS7dR0PbXeiw`) — `config/sources.json:451-498`

### YOUTUBE_CACHE_LOCATIONS=

| Vrstva | Umístění | Politika |
|--------|----------|----------|
| Git/CDN | `projects/data/videos.json` | Cache-bust `?v={dataVer}` |
| Service Worker | `/projects/data/videos.json` | Network-first, pass-through |
| SW offline seed | 3× stejné videoId | Pouze offline fallback (`sw.js:114-122`) |
| localStorage queue | `iu_video_queue_v1:{section}` | Perzistentní slot assignments |
| localStorage seen | `iu_video_seen_v1` | Dedupe 30 dní |
| Browser HTTP | `i.ytimg.com` | Žádná app-level thumb cache |
| Build cache | `_EMBED_CACHE` in-memory | Per-run v `build_videos.py` |

### YOUTUBE_REFRESH_JOBS=

| Job | Schedule | Output |
|-----|----------|--------|
| `update-videos-data.yml` | `30 */1 * * *` | `videos.json` (max 25 / 24h window) |
| `update-articles.yml` | častěji | **Necommituje** prázdný `videos.json` z legacy |
| `update-weather-history.yml` | `0 3 * * *` | `weather_history_videos.json` |
| `embed-verify.yml` | manual | Playwright artifacts |

**Build limity (`build_videos.py`):** `VIDEO_WINDOW_HOURS=24`, `MAX_VIDEOS_OUT=25`, `TARGET_CZ=12`

---

## KROK 2 — YOUTUBE ZDROJE

```
TOTAL_YOUTUBE_SOURCES=77
```

Všechny zdroje v allowlistu mají `official: true` → **SOURCE_ACTIVE=YES** pro všech 77.

**Duplicity (stejný kanál, více sourceKey):**
- CzechCrunch `UCuTf9Dg2a3dA-RRtMuA4ARQ` (2 kategorie)
- Forbes Česko `UCTTAE_HClD_DRs17iRiqZSg` (2 handle)
- TED / TEDxTalks `UCsT0YIqwnpJCM-mx7-gSA4Q`

**Ukázka YOUTUBE_SOURCE_LIST= (prvních 10 z 77):**

```
SOURCE_NAME=Veritasium | CHANNEL_ID=UCin0m13qWv3-051xlWlHamA | CHANNEL_URL=https://www.youtube.com/channel/UCin0m13qWv3-051xlWlHamA | SOURCE_ACTIVE=YES
SOURCE_NAME=Kurzgesagt | CHANNEL_ID=UCq8ZAAsI89IoJ-fn1gYpO3g | CHANNEL_URL=https://www.youtube.com/channel/UCq8ZAAsI89IoJ-fn1gYpO3g | SOURCE_ACTIVE=YES
SOURCE_NAME=Computerphile | CHANNEL_ID=UCoxcjq-8xIDTYp3uz647V5A | CHANNEL_URL=https://www.youtube.com/channel/UCoxcjq-8xIDTYp3uz647V5A | SOURCE_ACTIVE=YES
SOURCE_NAME=Two Minute Papers | CHANNEL_ID=UCbfYPyITQ-7l4upoX8nvctg | CHANNEL_URL=https://www.youtube.com/channel/UCbfYPyITQ-7l4upoX8nvctg | SOURCE_ACTIVE=YES
SOURCE_NAME=Lex Clips | CHANNEL_ID=UCSHZKyawb77ixDdsGog4iWA | CHANNEL_URL=https://www.youtube.com/channel/UCSHZKyawb77ixDdsGog4iWA | SOURCE_ACTIVE=YES
SOURCE_NAME=ColdFusion | CHANNEL_ID=UCGkpFfEMF0eMJlh9xXj2lMw | CHANNEL_URL=https://www.youtube.com/channel/UCGkpFfEMF0eMJlh9xXj2lMw | SOURCE_ACTIVE=YES
SOURCE_NAME=Real Engineering | CHANNEL_ID=UC176GAQozKKjhz62H8u9vQQ | CHANNEL_URL=https://www.youtube.com/channel/UC176GAQozKKjhz62H8u9vQQ | SOURCE_ACTIVE=YES
SOURCE_NAME=TechAltar | CHANNEL_ID=UCRG_N2uO405WO4P3Ruef9NA | CHANNEL_URL=https://www.youtube.com/channel/UCRG_N2uO405WO4P3Ruef9NA | SOURCE_ACTIVE=YES
SOURCE_NAME=CzechCrunch | CHANNEL_ID=UCuTf9Dg2a3dA-RRtMuA4ARQ | CHANNEL_URL=https://www.youtube.com/channel/UCuTf9Dg2a3dA-RRtMuA4ARQ | SOURCE_ACTIVE=YES
SOURCE_NAME=Živě.cz | CHANNEL_ID=UCEZrvIAg8gvB1Ur5gx6-Zwg | CHANNEL_URL=https://www.youtube.com/channel/UCEZrvIAg8gvB1Ur5gx6-Zwg | SOURCE_ACTIVE=YES
```

**Legacy playlist zdroje (2, enabled):**
- `ct24-youtube-playlist-1` — `PLmjovsp6pTeMmUMUg37zgbo9CTmtqzAGQ` — SOURCE_ACTIVE=YES
- `ct24-youtube-playlist-2` — `PLmjovsp6pTeOaU28zlFr4pS7dR0PbXeiw` — SOURCE_ACTIVE=YES

**Blokovaný kanál:** Počasíčko / `pocasicko` — `scripts/iu_blocked_sources.py`, `assets/app.js:17872`

Kompletní seznam: `https://infouzel.cz/projects/data/videos_allowlist.json`

---

## KROK 3 — NÁHLEDY VIDEÍ

```
THUMBNAIL_SOURCE=videoId z videos.json (pole thumb) nebo generováno za běhu iuBuildYouTubeThumb()
THUMBNAIL_PROVIDER=Google / YouTube CDN
THUMBNAIL_URL_PATTERN=https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg
THUMBNAIL_CACHE=Browser HTTP cache only (žádná dedikovaná IU cache vrstva)
THUMBNAIL_REFRESH_POLICY=Nový thumb při výměně videoId ve slotu; build zapisuje thumb při generaci videos.json
THUMBNAIL_FALLBACK=Žádný img.onerror fallback v Média feed path; prázdný poster = šedé pozadí (CSS background:none)
```

**Mechanismus:** CSS `background: var(--iuVideoThumb) url('i.ytimg.com/…')` na `.iuVideoPoster` spouští HTTP požadavek na Google **při vykreslení karty**, ne až po kliknutí.

**Důkaz kódu:**

```3326:3330:assets/app.js
function iuBuildYouTubeThumb(id) {
  const vid = String(id || "").trim();
  if (!vid) return "";
  return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
}
```

**Produkční ověření thumb dostupnosti:**
- `HEAD https://i.ytimg.com/vi/S8CnGwyQMTc/hqdefault.jpg` → **200 OK** (2026-06-15)

---

## KROK 4 — YOUTUBE GDPR AUDIT (kód)

```
USES_YOUTUBE_IFRAME=YES
USES_YOUTUBE_NOCOOKIE=YES (Média feed embed po kliknutí)
USES_STANDARD_YOUTUBE=YES (AI grid app.js:24769 → youtube.com/embed; mimo primární Média scope)
IFRAME_CREATED_BEFORE_CONSENT=NO (Média feed — iframe až po click; app.js:23726-23728)
YOUTUBE_REQUEST_BEFORE_CONSENT=YES (i.ytimg.com náhledy při vykreslení karet)
THIRD_PARTY_REQUESTS_BEFORE_CONSENT=YES (i.ytimg.com; consent neblokuje YouTube/thumbs)
ALL_YOUTUBE_DOMAINS=i.ytimg.com, www.youtube.com, www.youtube-nocookie.com, googlevideo.com (po přehrání)
```

**Consent vrstva (`assets/iu-consent.js`):** řídí pouze `iu:consent:analytics:v1`. **Nereguluje** YouTube, náhledy ani iframes.

**CSP (`projects/index.html:47-48`):**
```
frame-src https://www.youtube.com https://www.youtube-nocookie.com;
img-src 'self' data: blob: https://i.ytimg.com https:;
```

**Iframe vytvoření po kliknutí (důkaz):**

```23726:23728:assets/app.js
const iframe = document.createElement("iframe");
iframe.src = src;
```

kde `src = iuBuildYouTubeEmbedUrl(id2)` → `youtube-nocookie.com`.

**Mimo Média feed — iframes bez click gate:**
- AI sekce: 9× `youtube.com/embed/` (`assets/app.js:24768-24773`)
- Překladač: 5× statické `youtube-nocookie.com` iframe v HTML template (`assets/app.js:27524-27528`)

---

## KROK 5 — PRODUKČNÍ NETWORK AUDIT

**URL:** `https://infouzel.cz/projects/?section=feed&topic=zpravy&nosw=1`  
**Nástroj:** Playwright Chromium headless (2026-06-15, večer)  
**Produkční videos.json:** `generatedAt=2026-06-15T17:49:45Z`, **25 videí**

```
THUMBNAIL_REQUESTS=3
YOUTUBE_REQUESTS=0
FAILED_REQUESTS=0
404_COUNT=0
403_COUNT=0
CORS_ERRORS=0
CONSOLE_ERRORS=0
YOUTUBE_CONTACT_BEFORE_CLICK=YES (pouze i.ytimg.com náhledy, žádný youtube.com/nocookie iframe před kliknutím)
```

**Ukázka thumb request:** `https://i.ytimg.com/vi/nTBLdO7j0WY/hqdefault.jpg`

**DOM snapshot (feed zpravy):**
```json
{
  "VIDEO_COUNT_VISIBLE": 3,
  "VIDEO_WITH_YTID": 1,
  "PLACEHOLDER_COUNT": 2,
  "IFRAME_COUNT": 0,
  "posterStyles": [
    {"ytid": "UJbQNpXppQk", "thumb": "https://i.ytimg.com/vi/UJbQNpXppQk/hqdefault.jpg"},
    {"ytid": null, "thumb": "", "placeholder": "1"},
    {"ytid": null, "thumb": "", "placeholder": "1"}
  ]
}
```

**Media hub (`?section=media`):**
```
VIDEO_COUNT_VISIBLE=18
BODY_HOME=true
YOUTUBE_CONTACT_BEFORE_CLICK=not measured separately (hub renders cards with data)
```

**Poznámka k dennímu vývoji:** Ranní audit (`YOUTUBE_MEDIA_AUDIT_REPORT.md`) zaznamenal `videos.json` s 0 videi; večerní produkční stav má **25 videí** — pool obnoven.

---

## KROK 6 — VIDEO INVENTURA

**Produkční data (`videos.json`, 2026-06-15T17:49:45Z):**

```
VIDEO_COUNT_IN_DATA=25
UNIQUE_VIDEO_IDS=25
DUPLICATE_VIDEO_COUNT=0
UNIQUE_CHANNELS=10
MISSING_THUMBNAIL_COUNT=0 (v JSON)
STALE_VIDEO_COUNT=0 (freshness.primaryCount=25, fallbackCount=0, olderCount=0)
```

**Produkční UI (feed zpravy, Playwright):**

```
VIDEO_COUNT_VISIBLE=3
BROKEN_VIDEO_COUNT=2 (placeholdery data-iu-placeholder=1 bez videoId)
MISSING_THUMBNAIL_COUNT=2 (placeholdery bez --iuVideoThumb)
```

**Media hub (`?section=media`):** `VIDEO_COUNT_VISIBLE=18`

**Nesoulad:** Data pool 25 videí vs. feed zpravy zobrazuje 3 sloty (1 funkční + 2 placeholdery) — fronta slotů / localStorage queue vs. aktuální pool.

---

## KROK 7 — GDPR MAPA

### GDPR_FILES=

- `projects/index.html` (Info Centrum — GDPR práva, kontakt, hosting logy)
- `GDPR_DEEP_AUDIT_REPORT.md`, `gdpr_deep_audit_report.json`
- `legal_obligation_mapping_report.json`
- `INFO_CENTER_*.md` (6+ governance reportů)
- `RETENTION_POLICY_REPORT.md`, `SECURITY_PRIVACY_HARDENING_PHASE1_REPORT.md`
- `scripts/generate_security_governance_reports.py`
- `assets/iu-consent.js`, `assets/iu-consent-layer.js`, `assets/iu-info-center.js`

### PRIVACY_FILES=

- `projects/index.html` — sekce `privacy`, `privacy-settings`, `data-storage`
- `assets/iu-info-center.js`, `assets/iu-info-center.css`, `assets/iu-info-center-lazy-mount.js`
- `assets/iu-consent.js`, `assets/iu-consent-layer.js`, `assets/iu-consent-layer.css`
- `assets/iu-external-origins.js`, `assets/iu-storage-notice.js` (orphan — není mountnut v index.html)
- `STORAGE_NOTICE_REPORT.md`, `PUBLIC_CONTACTS_REPORT.md`, `YOUTUBE_MEDIA_AUDIT_REPORT.md`

**Standalone `/privacy.html`:** neexistuje — privacy je pouze v Info Centru overlay.

### COOKIE_FILES=

- `projects/index.html` — `#iuInfoCenterDetailCookies`, `#iuConsentLayer`
- `assets/iu-consent.js` — `iu:consent:*` localStorage keys
- `assets/iu-consent-layer.js`, `assets/iu-consent-layer.css`
- `sw.js` — Service Worker cache (zmíněn v cookies textu)

### LEGAL_FILES=

- `projects/index.html` — Provozovatel, disclaimers, externí poskytovatelé tabulka
- `assets/iu-legal-documents-*.js/css` — generátor smluv (ne site ToS)
- `NIS2_SCOPE_REVIEW.md`, `legal_obligation_mapping_report.json`
- `INFO_CENTER_LEGAL_*.md`, `GDPR_DEEP_AUDIT_REPORT.md`

**Podmínky použitání / Terms of Service / VOP:** **nenalezeny** jako samostatná stránka — pouze tool disclaimers v Info Centru.

---

## KROK 8 — INFOCENTRUM VS REALITA

### Relevantní deklarace

| Místo | Text |
|-------|------|
| About → Videa | „denní výběr a přehrávání z YouTube“ |
| Cookies D) | „Při **přehrání** videa (YouTube / youtube-nocookie.com) … mohou služby ukládat vlastní technická data“ |
| Privacy §6 tabulka | YouTube / Google — „technická data **při přehrání** dle Google“ |
| Privacy → Externí odkazy | „YouTube … **(po kliknutí)**“ |

### Skutečné chování

| Chování | Realita |
|---------|---------|
| Média embed iframe | `youtube-nocookie.com` **až po kliknutí** ✓ |
| Náhledy `i.ytimg.com` | Načteny **při vykreslení karty**, před kliknutím i před consent ✗ |
| Consent layer | Řídí jen statistiky, ne YouTube ✗ |
| AI grid iframes | `youtube.com/embed` eager v DOM (mimo deklaraci Média) |
| Překladač iframes | 5× statické nocookie iframe v DOM při otevření sekce |
| Analytics | Stub only — žádný vendor loaded (`iu-consent.js:101-111`) |

```
INFOCENTER_STATEMENTS_MATCH_REALITY=PARTIAL
COOKIE_STATEMENTS_MATCH_REALITY=NO (chybí zmínka i.ytimg.com náhledů)
PRIVACY_STATEMENTS_MATCH_REALITY=NO (tabulka říká „při přehrání“, náhledy jdou dříve)
YOUTUBE_BEHAVIOR_MATCHES_DECLARATIONS=PARTIAL (embed OK, thumbnaily NE)
DATA_COLLECTION_MATCHES_DECLARATIONS=PARTIAL (local-first OK; IP/logy bez právního základu)
```

---

## KROK 9 — DPA AUDIT

```
GITHUB_DPA_FOUND=NO
GITHUB_DPA_LOCATION=— (žádný odkaz, smlouva ani evidence uzavření v repozitáři)

CLOUDFLARE_DPA_FOUND=NO
CLOUDFLARE_DPA_LOCATION=— (žádný odkaz, smlouva ani evidence uzavření v repozitáři)

FORMAL_EVIDENCE_PRESENT=NO
```

**Co existuje místo DPA:**
- User-facing tabulka v Info Centru: GitHub Pages, GitHub Actions, Cloudflare Workers (`projects/index.html:6327-6329`)
- Interní gap: `GDPR_DEEP_AUDIT_REPORT.md` — „No formal registry; **no DPA references**“
- `legal_obligation_mapping_report.json`: `{ "area": "DPA", "status": "REQUIRED", "why": "Art. 28 — smlouvy se zpracovateli infrastruktury; interní dokument, ne Info Center." }`

**Grep celého repa:** žádné shody pro `Cloudflare DPA`, `GitHub DPA`, URL na standardní DPA dokumenty.

---

## KROK 10 — IP LOGY AUDIT

```
IP_PROCESSING_PRESENT=YES
```

| Zdroj | Použití | Evidence |
|-------|---------|----------|
| GitHub Pages logy | Ano — hosting statického webu | Info Centrum tabulka: „IP při HTTP požadavku“ |
| Cloudflare logy | Ano — pokud nasazeno (Workers, CDN) | Info Centrum + `cloudflare/` v repu |
| Analytics | Ne — stub only, žádný vendor | `iu-consent.js`, `__IU_ANALYTICS_ACTIVE__=false` |
| Security logy | Ne — žádný centrální SIEM v repu | — |
| Error logy | Ne — pouze lokální `persistLastError` v prohlížeči | `assets/app.js` |

```
PROCESSING_SOURCE=GitHub Pages (hosting), Cloudflare Workers (volitelně VIN/watchdog), mapové dlaždice (IP při otevření mapy)
PROCESSING_PURPOSE=technický provoz hostingu/CDN; deklarováno v Info Centru bez explicitního právního základu
```

---

## KROK 11 — PRIVACY COVERAGE (právní základ / oprávněný zájem)

**Ověřeno v produkčním `projects/index.html`:**

```
LEGAL_BASIS_IP_LOGS_PRESENT=NO
LOCATION=— (v live UI chybí)
```

**Grep produkčního HTML:** 0× `právní základ`, 0× `oprávněný zájem`

**Co existuje místo toho:**
- „InfoUzel používá pouze údaje a nastavení nezbytné pro provoz webu…“ (`index.html:6243`)
- „provozní logy hostingu/CDN (pokud vzniknou u poskytovatele infrastruktury)“ (`index.html:6307`) — **bez Art. 6 labelu**
- Analytics: „Podmínka zapnutí: váš souhlas“ — ne „právní základ“ (`index.html:6225`)

**Historické dokumenty (ne v produkci):** `INFO_CENTER_FINAL_LEGAL_VALIDATION.md` obsahoval matici s „oprávněný zájem provozovatele“ pro provoz webu + IP/logy — **odstraněno** per `INFO_CENTER_FINAL_READY_REPORT.md`.

**Pokrytí požadovaných kategorií:**

| Kategorie | právní základ | oprávněný zájem |
|-----------|---------------|-----------------|
| bezpečnost | NO | NO |
| provoz | NO (implicitní text) | NO |
| ochrana proti zneužití | NO | NO |
| technické logy | NO (IP zmíněno, bez basis) | NO |

---

## KROK 12 — GDPR / ePRIVACY COMPLIANCE

```
GDPR_COMPLIANT=PARTIAL
EPRIVACY_COMPLIANT=NO
COOKIE_COMPLIANT=PARTIAL
YOUTUBE_COMPLIANT=PARTIAL
LEGAL_RISK_FOUND=YES
```

### LEGAL_RISK_LIST=

| # | Nález | SEVERITY |
|---|-------|----------|
| 1 | `i.ytimg.com` náhledy načteny před souhlasem / před deklarovaným „přehráním“ | **MEDIUM** |
| 2 | Cookies/Privacy nezmiňují thumbnail CDN Google | **MEDIUM** |
| 3 | Chybí formální DPA evidence pro GitHub a Cloudflare (Art. 28) | **HIGH** |
| 4 | Chybí explicitní právní základ pro IP/provozní logy (Art. 13/6) | **MEDIUM** |
| 5 | AI sekce používá standard `youtube.com` iframe (ne nocookie) mimo Média deklaraci | **LOW** |
| 6 | Překladač: 5 eager nocookie iframes v DOM bez click gate | **LOW** |
| 7 | Feed UI: 2/3 slotů jako broken placeholders navzdory 25 videím v poolu | **MEDIUM** (produkt/důvěra) |
| 8 | Žádná standalone Terms of Service stránka | **LOW** |
| 9 | `iu-storage-notice.js` existuje ale není mountnut | **LOW** (procesní) |
| 10 | Incident response playbook chybí (`NIS2_SCOPE_REVIEW.md`) | **MEDIUM** (NIS2-adjacent) |

---

## KROK 13 — NIS2 SCREENING

```
NIS2_LIKELY_IN_SCOPE=NO
NIS2_REASONING=
```

| Faktor | Hodnota | Zdroj |
|--------|---------|-------|
| Typ služby | Veřejný informační portál + client-side PWA nástroje | `NIS2_SCOPE_REVIEW.md` |
| Provozovatel | Media Uzel s.r.o. (CZ SME) | Info Centrum + `NIS2_SCOPE_REVIEW.md` |
| Počet zaměstnanců | **Neuveden** v dokumentaci | — |
| Regulovaná služba | Ne — ne energie, doprava, zdravotnictví, bankovnictví | `NIS2_SCOPE_REVIEW.md` |
| Kritická infrastruktura | Ne | `NIS2_SCOPE_REVIEW.md` |
| Centrální DB osobních údajů | Ne | `NIS2_SCOPE_REVIEW.md`, forensic audit |
| Incident response | NEEDS REVIEW — formal IR plan not in repo | `NIS2_SCOPE_REVIEW.md` |

**Verdikt:** `LIKELY_OUT_OF_SCOPE` *(NEEDS_LEGAL_REVIEW if scope grows)* — `NIS2_SCOPE_REVIEW.md`, `legal_obligation_mapping_report.json`

---

## KROK 14 — GAP REPORT

```
COMPLIANCE_STATUS=YELLOW
DPA_GAP=YES
PRIVACY_GAP=YES
NIS2_DOCUMENTATION_GAP=YES
CRITICAL_RISK=NO
```

### Seznam gapů s prioritou

| Priorita | Gap | Oblast |
|----------|-----|--------|
| P0 | Formální DPA pro GitHub + Cloudflare chybí v repozitáři | DPA / Art. 28 |
| P1 | Právní základ (Art. 6) pro IP/provozní logy chybí v live UI | Privacy / GDPR |
| P1 | ePrivacy: `i.ytimg.com` před consent, nepopsané v Cookies | YouTube / ePrivacy |
| P1 | Deklarace „při přehrání“ vs. skutečnost u náhledů | Transparency |
| P2 | Feed sloty: 2/3 broken placeholders (produkt) | YouTube UX |
| P2 | NIS2: chybí IR playbook, employee count pro threshold analýzu | NIS2 docs |
| P2 | AI grid: standard youtube.com iframe (mimo nocookie doporučení) | YouTube |
| P3 | Chybí standalone Terms of Service | Legal |
| P3 | Orphan `iu-storage-notice` assets | Process |

---

## KROK 15 — TECHNICKÉ DŮKAZY (souhrn)

### Kód — embed flow

1. Poster render → CSS background načte `i.ytimg.com` (před consent)
2. Click → `document.createElement("iframe")` → `youtube-nocookie.com/embed/` (`app.js:23726-23728`)
3. Consent (`iu-consent.js`) — pouze analytics stub, `window.__IU_ANALYTICS_ACTIVE__=false`

### Network — produkce 2026-06-15 večer

```
Playwright → infouzel.cz/projects/?section=feed&topic=zpravy&nosw=1
THUMBNAIL_REQUESTS=3 | YOUTUBE_REQUESTS=0 | IFRAME_COUNT=0
YOUTUBE_CONTACT_BEFORE_CLICK=YES (thumb only)
```

### Data — produkce

```
GET https://infouzel.cz/projects/data/videos.json → HTTP 200
VIDEO_COUNT_IN_DATA=25 | GENERATED_AT=2026-06-15T17:49:45.056077Z
TOTAL_YOUTUBE_SOURCES=77 (allowlist)
```

### Architektura — data flow

```mermaid
flowchart LR
  A[videos_allowlist.json 77 sources] --> B[build_videos.py Atom+oEmbed]
  B --> D[videos.json max 25/24h]
  D --> E[GitHub Pages CDN]
  E --> F[app.js load videos.json]
  F --> G[iuEnsureVideoAnchors every 8 articles]
  G --> H[poster i.ytimg.com thumb BEFORE click]
  H --> I[click → youtube-nocookie iframe]
```

---

## ZÁVĚR AUDITU

Forenzní audit potvrzuje **funkční YouTube architekturu** s 77 allowlist zdroji, hodinovým refresh jobem a rozumným Média embed designem (youtube-nocookie, click-to-play). Produkční pool obnoven na **25 videí** (oproti rannímu stavu 0).

**Compliance mezery jsou primárně dokumentační a procesní:**
- chybí DPA evidence (HIGH),
- chybí právní základ pro IP/logy v live UI (MEDIUM),
- ePrivacy nesoulad u thumbnail CDN (MEDIUM),
- InfoCentrum deklarace neodpovídají plně technickému chování u náhledů.

**NIS2:** orientační screening = likely out of scope, ale chybí formální IR dokumentace.

**Celkový stav: YELLOW** — žádné CRITICAL právní riziko identifikováno, ale DPA gap a ePrivacy/thumbnail gap vyžadují pozornost counsel.

---

*Report vytvořen: 2026-06-15 · Audit skripty: `%TEMP%\iu_yt_audit_prod.ps1`, `%TEMP%\iu_yt_network_audit.mjs` · Bez commitů · Bez oprav*
