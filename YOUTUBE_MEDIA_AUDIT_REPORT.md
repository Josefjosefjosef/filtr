# YOUTUBE MEDIA — FORENZNÍ AUDIT REPORT (InfoUzel.cz)

**Datum auditu:** 2026-06-15  
**Scope:** YouTube videa / náhledy / zdroje / cache / GDPR / InfoCentrum — sekce **Média (feed)**  
**Mimo scope:** Počasí, Silver, kalendář, úkoly, poznámky, ostatní média mimo YouTube  
**Režim:** Pouze zjištění stavu — **žádné opravy kódu**

---

## KROK 1 — MAPA YOUTUBE ARCHITEKTURY

### YOUTUBE_FILES=

| Soubor | Role |
|--------|------|
| `assets/app.js` | Render karet, náhledy (`--iuVideoThumb`), click-to-embed (`youtube-nocookie.com`), fronta slotů, `iuEnsureVideoAnchors`, `normalizeVideoList` |
| `assets/app.css` | `.iuVideoPoster { background: var(--iuVideoThumb) }` |
| `projects/index.html` | CSP (`frame-src` YouTube), InfoCentrum texty, `__iuLoadVideosJsonOnce`, video modal template |
| `projects/data/videos_allowlist.json` | 77 oficiálních YouTube kanálů (allowlist) |
| `projects/data/videos.json` | Produkční pool videí (aktuálně **prázdný**) |
| `scripts/build_videos.py` | Primární builder poolu (Atom feed, oembed filter, freshness 14/60 dní) |
| `scripts/build_articles.py` | Sekundární zápis `videos.json` z legacy playlist feedů (aktuálně produkuje **0 videí**) |
| `scripts/feeds_youtube.json` | Legacy: 2× ČT24 playlist (`aktualne`) |
| `scripts/video_audit.py` | Lokální forenzní audit `videos.json` |
| `scripts/video_sources_audit.py` | Audit zdrojů allowlistu |
| `sw.js` | Network-first pro `videos.json`; seed fallback s `i.ytimg.com` thumbnaily |
| `assets/iu-external-origins.js` | Registry: `i.ytimg.com`, `youtube.com`, `youtube-nocookie.com` |
| `.github/workflows/update-videos-data.yml` | Cron hodinově — `build_videos.py` → PR |
| `.github/workflows/update-articles.yml` | Staging/commit `videos.json` z `build_articles.py` |
| `video_pipeline_report.md` | Předchozí forenzní report (únor 2026) |

### YOUTUBE_COMPONENTS=

- `buildYouTubeVideoPreviewCard()` — HTML karta s `data-ytid`, poster button
- `iuBuildYouTubeThumb(id)` → `https://i.ytimg.com/vi/{id}/hqdefault.jpg`
- `iuBuildYouTubeEmbedUrl(id)` → `https://www.youtube-nocookie.com/embed/{id}?autoplay=1&…`
- `iuEnsureVideoAnchors()` — vkládání karet po každých 8 článcích (slot queue)
- `iuUpdateVideoQueue()` / `iuReadQueue()` — localStorage `iu_video_queue_v1:{section}`
- `iuInitFeedVideoPreviewEmbeds()` — click handler, iframe až po kliknutí
- `normalizeVideoList()` — normalizace `state.videosRaw.videos`
- `__iuLoadVideosJsonOnce()` (index.html) — single-flight fetch `projects/data/videos.json`

### YOUTUBE_DATA_SOURCES=

1. **Primární:** `projects/data/videos_allowlist.json` → `scripts/build_videos.py` → `videos.json`
2. **Legacy:** `scripts/feeds_youtube.json` (2 ČT24 playlisty) → `build_articles.py`
3. **Produkce live:** `https://infouzel.cz/projects/data/videos.json`

### YOUTUBE_APIS=

- YouTube Atom: `https://www.youtube.com/feeds/videos.xml?channel_id=…`
- YouTube oEmbed (build-time embedability): `https://www.youtube.com/oembed?url=…`
- YouTube embed probe (build-time): `https://www.youtube.com/embed/{id}`
- **Frontend embed (po kliknutí):** `https://www.youtube-nocookie.com/embed/{id}`
- **Náhledy:** `https://i.ytimg.com/vi/{id}/hqdefault.jpg` (žádné YouTube Data API v3)

### YOUTUBE_FEEDS=

- Allowlist: 77 kanálů v 10 kategoriích (`videos_allowlist.json`)
- Legacy RSS/Atom playlisty: 2× ČT24 v `feeds_youtube.json`

### YOUTUBE_CACHE_LOCATIONS=

| Vrstva | Umístění | TTL / politika |
|--------|----------|----------------|
| `videos.json` | GitHub Pages CDN + SW network-first | SW: pass-through `no-store`; žádný dlouhý SW cache body |
| SW seed | `sw.js` `getSeedVideos()` | Pouze offline fallback (3× stejné videoId) |
| Video fronta | `localStorage` `iu_video_queue_v1:{section}` | Perzistentní mezi návštěvami |
| Seen/dedupe | `localStorage` `iu_video_seen_v1` | Prune po `dedupeDays` (default 30) |
| Náhledy | Browser HTTP cache pro `i.ytimg.com` | Žádná app-level thumbnail cache |
| HTTP | `videos.json?v={dataVer}` cache-bust | Verze z meta |

### YOUTUBE_REFRESH_JOBS=

| Job | Schedule | Stav 2026-06-15 |
|-----|----------|-----------------|
| `update-videos-data.yml` | `30 */1 * * *` | **FAIL** 07:42Z, 01:43Z (conflict markers); poslední **success** 14.6. 22:37Z |
| `update-articles.yml` | častěji | **Přepisuje** `videos.json` prázdným výstupem z `build_articles.py` |

---

## KROK 2 — INVENTURA YOUTUBE ZDROJŮ

```
TOTAL_YOUTUBE_SOURCES=77
```

Všechny zdroje v allowlistu mají `official: true` → **SOURCE_ACTIVE=YES** pro všech 77.

**Duplicity v allowlistu (stejný kanál, jiný sourceKey):**

| SOURCE_NAME | CHANNEL_ID | Poznámka |
|-------------|------------|----------|
| CzechCrunch | UCuTf9Dg2a3dA-RRtMuA4ARQ | 2× (science_tech_ai + business_startups) |
| Forbes Česko | UCTTAE_HClD_DRs17iRiqZSg | 2× (forbescesko + ForbesCesko handle) |
| TED / TEDxTalks | UCsT0YIqwnpJCM-mx7-gSA4Q | stejný channel_id, různé handle |

Kompletní seznam 77 zdrojů: viz `projects/data/videos_allowlist.json` (audit skript `%TEMP%\iu_yt_sources_json.js`, výstup `TOTAL_YOUTUBE_SOURCES: 77`).

**Ukázka (první 3):**

```
SOURCE_NAME=Veritasium
CHANNEL_ID=UCin0m13qWv3-051xlWlHamA
CHANNEL_URL=https://www.youtube.com/channel/UCin0m13qWv3-051xlWlHamA
SOURCE_ACTIVE=YES

SOURCE_NAME=Kurzgesagt
CHANNEL_ID=UCq8ZAAsI89IoJ-fn1gYpO3g
CHANNEL_URL=https://www.youtube.com/channel/UCq8ZAAsI89IoJ-fn1gYpO3g
SOURCE_ACTIVE=YES

SOURCE_NAME=Computerphile
CHANNEL_ID=UCoxcjq-8xIDTYp3uz647V5A
CHANNEL_URL=https://www.youtube.com/channel/UCoxcjq-8xIDTYp3uz647V5A
SOURCE_ACTIVE=YES
```

---

## KROK 3 — ODKUD SE BERE NÁHLED VIDEA

```
THUMBNAIL_SOURCE=videoId z videos.json (pole thumb) nebo generováno za běhu
THUMBNAIL_PROVIDER=Google / YouTube CDN (i.ytimg.com)
THUMBNAIL_URL_PATTERN=https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg
THUMBNAIL_CACHE=Browser HTTP cache only (žádná dedikovaná IU cache vrstva)
THUMBNAIL_REFRESH_POLICY=Nový thumb při výměně videoId ve slotu; build zapisuje thumb při generaci videos.json
THUMBNAIL_FALLBACK=Žádný img.onerror fallback v Média feed path; prázdný poster = šedé pozadí (CSS background:none)
```

**Mechanismus (kód):**

```3326:3329:assets/app.js
function iuBuildYouTubeThumb(id) {
  const vid = String(id || "").trim();
  if (!vid) return "";
  return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
}
```

```6464:6464:assets/app.js
<button type="button" class="iuVideoPoster" style="--iuVideoThumb: url('${escapeHtml(thumb)}');" …>
```

```9912:9912:assets/app.css
background: var(--iuVideoThumb) center / cover no-repeat;
```

CSS `background: url(i.ytimg.com/…)` **spouští HTTP požadavek na Google při vykreslení posteru** — ještě před kliknutím na přehrání.

**Build-time thumb:**

```4672:4672:scripts/build_articles.py
"thumb": v.get("thumb") or youtube_thumb_from_id(vid),
```

---

## KROK 4 — GDPR / COOKIE / YOUTUBE AUDIT (kód + deklarace)

```
USES_YOUTUBE_IFRAME=YES (po kliknutí na poster v Média feed)
USES_YOUTUBE_NOCOOKIE=YES (Média embed: iuBuildYouTubeEmbedUrl → youtube-nocookie.com)
USES_STANDARD_YOUTUBE=YES (mimo Média scope: AI video grid app.js ~24769 používá youtube.com/embed; překladač ~27524 youtube-nocookie iframes v HTML)
IFRAME_CREATED_BEFORE_CONSENT=NO (Média feed — iframe až po click; ověřeno kódem iuInitFeedVideoPreviewEmbeds)
YOUTUBE_REQUEST_BEFORE_CONSENT=CONDITIONAL
  - Produkce dnes: NO (žádná data → žádné thumbnaily)
  - Při funkčním poolu: YES — i.ytimg.com náhledy se načtou při vykreslení karty, bez souhlasu (consent layer neblokuje ytimg)
THIRD_PARTY_REQUESTS_BEFORE_CONSENT=i.ytimg.com (thumbnaily, když jsou karty vyplněné); žádný youtube.com/googlevideo před kliknutím v Média feed
ALL_YOUTUBE_DOMAINS=i.ytimg.com, www.youtube.com, www.youtube-nocookie.com, googlevideo.com (po přehrání)
```

**Consent vrstva (`assets/iu-consent.js`):** řídí pouze **anonymní statistiky** (`iu:consent:analytics:v1`). **Nereguluje** YouTube ani náhledy.

**CSP (`projects/index.html`):**

```
frame-src https://www.youtube.com https://www.youtube-nocookie.com;
img-src … https://i.ytimg.com https:;
```

---

## KROK 5 — PRODUKČNÍ NETWORK AUDIT

**URL testováno:** `https://infouzel.cz/projects/?section=feed&topic=zpravy&nosw=1`  
**Nástroj:** Playwright (repo `node_modules/playwright`), headless, SW abort.

### Produkční stav (prázdný videos.json)

```
THUMBNAIL_REQUESTS=0
YOUTUBE_REQUESTS=0
FAILED_REQUESTS=0
404_COUNT=0
403_COUNT=0
CORS_ERRORS=0
CONSOLE_ERRORS=0
YOUTUBE_CONTACT_BEFORE_CLICK=NO
```

### DOM snapshot (produkce)

```json
{
  "VIDEO_COUNT_VISIBLE": 3,
  "cards": [
    {"ytid": null, "placeholder": "1", "thumb": "", "title": "Načítám video…"},
    {"ytid": null, "placeholder": "1", "thumb": "", "title": "Načítám video…"},
    {"ytid": null, "placeholder": "1", "thumb": "", "title": "Načítám video…"}
  ],
  "MISSING_THUMBNAIL_COUNT": 3,
  "iframeCount": 0,
  "bodyHome": false,
  "section": "feed"
}
```

### Hub landing `?section=media`

```
VIDEO_COUNT_VISIBLE=0
bodyHome=true
shouldInjectVideos=false (isHome gate)
YOUTUBE_CONTACT_BEFORE_CLICK=NO
```

### Ověření ytimg dostupnosti (nezávislý HEAD)

```
HEAD https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg → status 200
```

### Produkční videos.json

```json
{
  "generatedAt": "2026-06-15T08:38:33.281956Z",
  "videos": 0,
  "freshness": { "total": 0 }
}
```

Zdroj: `https://infouzel.cz/projects/data/videos.json` i `main` na GitHubu — **shodně prázdné**.

---

## KROK 6 — BUG ANALÝZA

### A) Proč někdy není vidět náhled

```
ROOT_CAUSE_MISSING_THUMBNAIL=
  1) PRODUKCE P0: projects/data/videos.json má videos=[] → sloty zůstanou jako disabled placeholder
     (data-iu-placeholder=1, --iuVideoThumb prázdné, background:none)
  2) Hub ?section=media: body.iu-home=true → shouldInjectVideos=false → na úvodním hubu žádné video karty
  3) Když pool existuje ale slot nemá videoId: placeholder bez thumb URL
  4) Žádný img fallback / mqdefault downgrade v Média feed (na rozdíl od počasí)

CACHE_LAYER_FOUND=YES
CACHE_INVALIDATION_POLICY=
  - videos.json: přepsání při každém úspěšném data commitu
  - SW: network-first, seed jen offline
  - localStorage queue: perzistentní; může držet staré sloty i při prázdném poolu
STALE_DATA_SOURCE=update-articles.yml přepisuje videos.json prázdným výstupem build_articles.py
ROOT_CAUSE_CONFIRMED=YES
```

**Pipeline důkaz — prázdný commit:**

```
git show eba216e839:projects/data/videos.json → "videos": []
```

**Poslední neprázdný dedicated build** (commit `7d99b09cbd`, 2026-06-14T22:48:25Z):

```
freshness.total=25, videos=25, sourcesMeta s feedUrl pro allowlist kanály
```

**Workflow selhání:**

```
gh run list --workflow=update-videos-data.yml
→ failure 2026-06-15T07:42:23Z (conflict markers)
→ build_videos.py přitom vyprodukoval: VIDEOS_FRESHNESS total=25
```

### B) Proč někdy stará videa

```
ROOT_CAUSE_STALE_VIDEO=
  1) PRODUKCE: žádná videa vůbec (prázdný JSON) — uživatel vidí věčné „Načítám video…“
  2) Když data existují: localStorage iu_video_seen_v1 (dedupe 30 dní) + iu_video_queue_v1
     drží staré videoId ve slotech
  3) build_videos.py freshness: primary 14d, fallback 60d, maxTotal 25 (24h window v meta)
  4) update-videos-data workflow selhává → fresh pool se nedostane do main
ROOT_CAUSE_CONFIRMED=YES
```

---

## KROK 7 — INVENTURA ZOBRAZENÝCH VIDEÍ

**Produkce 2026-06-15 (`topic=zpravy`):**

```
VIDEO_COUNT_VISIBLE=3 (placeholdery, ne funkční videa)
VIDEO_COUNT_IN_DATA=0
UNIQUE_CHANNELS=0
BROKEN_VIDEO_COUNT=3 (placeholdery bez videoId — nefunkční)
MISSING_THUMBNAIL_COUNT=3
STALE_VIDEO_COUNT=0 (N/A — žádná data)
DUPLICATE_VIDEO_COUNT=0
```

**Referenční stav z posledního úspěšného build_videos (14.6. 22:48Z, commit 7d99b09cbd):**

```
VIDEO_COUNT_IN_DATA=25
UNIQUE_CHANNELS=~25 (1 video per source v okně)
```

---

## KROK 8 — INFOCENTRUM / OCHRANA SOUKROMÍ

**Relevantní deklarace:**

| Místo | Text |
|-------|------|
| InfoCentrum → Videa | „denní výběr a přehrávání z YouTube“ · Externí data |
| Cookies D) | „Při **přehrání** videa (YouTube / youtube-nocookie.com) … mohou služby ukládat vlastní technická data“ |
| Privacy §6 tabulka | YouTube / Google — embed videí — „technická data **při přehrání**“ |
| Privacy → Externí odkazy | „YouTube … **(po kliknutí)**“ |

**Skutečné chování (Média feed, při neprázdném poolu):**

- Náhledy `i.ytimg.com` se načtou **při zobrazení karty** (CSS background), ne až při přehrání/kliknutí
- Embed iframe `youtube-nocookie.com` — **až po kliknutí** (soulad s deklarací pro přehrání)
- Consent layer **neblokuje** náhledy ani YouTube

```
INFOCENTER_STATEMENTS_MATCH_REALITY=PARTIAL (modul Videa existuje, ale produkce neukazuje videa)
COOKIE_STATEMENTS_MATCH_REALITY=PARTIAL (nezmiňuje i.ytimg.com náhledy před přehráním)
PRIVACY_STATEMENTS_MATCH_REALITY=NO (tabulka říká „při přehrání“, náhledy jsou dříve)
YOUTUBE_BEHAVIOR_MATCHES_DECLARATIONS=NO (chybí zmínka o thumbnail CDN; produkce nefunguje)
```

---

## KROK 9 — GDPR / ePRIVACY / YOUTUBE COMPLIANCE

```
GDPR_COMPLIANT=PARTIAL
  - Neodesíláme obsah nástrojů na YouTube ✓
  - Chybí transparentnost k náhledům před přehráním ✗
EPRIVACY_COMPLIANT=NO
  - i.ytimg.com požadavky = third-party storage/tracking potenciál před uživatelským souhlasem
  - Consent layer nekryje externí náhledy
COOKIE_COMPLIANT=PARTIAL
  - Marketingové cookies ne ✓
  - YouTube/Google technická data z náhledů nejsou pokryta v cookie policy ✗
YOUTUBE_COMPLIANT=PARTIAL
  - Embed: youtube-nocookie.com ✓ (doporučený režim)
  - Náhledy: přímé i.ytimg.com bez nocookie varianty
  - Click-to-play pro iframe ✓
LEGAL_RISK_FOUND=YES
```

```
LEGAL_RISK_LIST=
  1) Nesoulad deklarace „při přehrání“ vs. skutečné načítání i.ytimg.com náhledů při zobrazení feedu
  2) Absence informace o thumbnail CDN v Cookies / Privacy pro Média modul
  3) Produkční výpadek videí (videos.json=[]) — faktická neschopnost plnit službu deklarovanou v InfoCentru
SEVERITY=
  - Riziko 1–2: MEDIUM (ePrivacy / transparentnost)
  - Riziko 3: HIGH (produkt + důvěra, ne primárně GDPR pokuta)
```

---

## KROK 10 — FINÁLNÍ SHRNUTÍ

```
GDPR_RISK_LEVEL=MEDIUM
LEGAL_RISK_LEVEL=MEDIUM
PRODUCT_RISK_LEVEL=CRITICAL
ROOT_CAUSE_CONFIRMED=YES
FIX_NEEDED=YES (audit pouze zjišťoval — opravy nebyly provedeny)
```

### PRIORITY_ORDER=

1. **P0 — Obnovit `videos.json` na produkci** — `update-articles.yml` přepisuje prázdným výstupem; `update-videos-data.yml` selhává na conflict markers. Dokud `videos.length=0`, Média nemají co zobrazit.
2. **P1 — Opravit pipeline konflikt** — zajistit, aby `build_videos.py` output (25–240 videí) byl jediný zdroj pravdy commitovaný do main.
3. **P1 — Placeholder UX** — disabled „Načítám video…“ bez timeout/error stavu maskuje výpadek dat.
4. **P2 — Hub `?section=media`** — `iu-home` gate vypíná video injection na úvodním hubu.
5. **P2 — GDPR/ePrivacy texty** — doplnit `i.ytimg.com` náhledy do Cookies/Privacy (nebo lazy-load náhledů až po interakci/souhlasu).
6. **P3 — Thumbnail fallback** — `mqdefault` / placeholder image při 404 ytimg (feed path dnes nemá).

---

## DŮKAZY — LOG VÝPISY

### A) Produkční videos.json

```json
{"generatedAt":"2026-06-15T08:38:33.281956Z","videos":0,"freshness":{"total":0}}
```

### B) Playwright network audit (zpravy feed)

```json
{"THUMBNAIL_REQUESTS":0,"YOUTUBE_REQUESTS":0,"VIDEO_COUNT_VISIBLE":3,
 "MISSING_THUMBNAIL_COUNT":3,"YOUTUBE_CONTACT_BEFORE_CLICK":"NO"}
```

### C) Video karty DOM

```json
{"ytid":null,"placeholder":"1","thumb":"","title":"Načítám video…"}
```

### D) Workflow update-videos-data (selhání + build output)

```
VIDEOS_FRESHNESS primary14=25 fallback60=0 older=0 total=25
VIDEOS_WINDOW_24H cz=9 en=38 out_cz=9 out_en=16 out_total=25
ERROR: conflict markers in … — aborting without commit
exit code 1
```

### E) Referenční fungující videos.json (7d99b09cbd)

```
generatedAt: 2026-06-14T22:48:25Z
freshness.total: 25
thumb pattern: https://i.ytimg.com/vi/{id}/hqdefault.jpg
```

---

## ZÁVĚR

**Produkční Média sekce je v kritickém stavu:** `videos.json` na `infouzel.cz` obsahuje **0 videí** od rána 15. 6. 2026. UI vykreslí **3 disabled placeholdery** „Načítám video…“ bez náhledů a bez kontaktu s YouTube. Příčina je **datová pipeline** (prázdný výstup `build_articles.py` + selhání `update-videos-data.yml`), nikoli frontend thumbnail renderer.

**GDPR:** Média embed je navržen rozumně (youtube-nocookie, click-to-play), ale **náhledy z `i.ytimg.com` nejsou v InfoCentru/Cookies popsány** a při funkčním poolu by šly na Google **před přehráním i před consent lištou** (která řeší jen statistiky).

**Audit dokončen bez změn kódu.**

---

*Report: `YOUTUBE_MEDIA_AUDIT_REPORT.md` · Audit skripty pouze v `%TEMP%` (mimo repo)*
