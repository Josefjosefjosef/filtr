# VIDEO PIPELINE — FORENZNÍ REPORT (proč se česká videa + náhledy NEVLOŽILY)

## 5.1 Shrnutí (1 obrazovka)

- **Datum/čas testu**: 2026-02-17 (lokální forenzní audit repo + build log výňatky)
- **Stav**: **Data/build nejsou viník** (videa i CZ videa jsou ve `projects/data/videos.json`, thumb URL jsou vyplněné). Nejpravděpodobnější stop je **App render/injection gate**: ve standardním feedu se `contentType=video` položky z pipeline **úmyslně přeskočí** a mají se vložit až přes **DOM anchor pass**; pokud anchor pass nemá sloty (např. view bez článků), výsledek je **0 video karet = 0 náhledů**.

**3 nejdůležitější zjištění**
- **`projects/data/videos.json` obsahuje CZ videa i náhledy**: total=400, CZ_exact=91, thumb=400 (důkaz níže).
- **Build běží a produkuje 400 videí**, i když resolver pro mnoho allowlist handle URL hlásí `WARN ... status=404` (důkaz z Actions logu níže).
- **Render gate v `assets/app.js`**: když `shouldInjectVideos=true`, render pipeline **skips** každé `contentType=video` v `items` (`continue`) a spoléhá na `iuEnsureVideoAnchors()`; pokud `slotCount=0` (málo/žádné články), není co injectnout → **žádné video karty/žádné postery**.

## 5.2 Čísla

### Build / data (z `projects/data/videos.json`)
- **IN_VIDEOS_JSON_TOTAL**: 400
- **IN_VIDEOS_JSON_CS_LIKE**: 58 (heuristika “cs/czech/česk…” v title/lang/channel)
- **IN_VIDEOS_JSON_CZ_EXACT**: 91 (lang=cz/cs nebo region=cz)
- **POSTER_URL_PRESENT (thumb field)**: 400

Důkaz (lokální audit skriptem `scripts/video_audit.py`):

```text
VIDEOS_JSON_TOTAL 400
VIDEOS_JSON_CZ_EXACT 91
VIDEOS_JSON_CS_LIKE 58
VIDEOS_JSON_WITH_THUMB 400
TOP_LANG [('en', 309), ('cz', 91)]
TOP_REGION [('world', 309), ('cz', 91)]
```

### UI render (produkce / runtime)
V téhle větvi je přidaný debug-only agregátor, který na `?debug=1` vypíše `[IU_VIDEO_DBG]` (counts + drops + poster audit max 30) a tím dá přesná čísla:

- **UI_LOADED** = `IU_VIDEO_DBG.counts.loaded_count`
- **UI_NORMALIZED** = `IU_VIDEO_DBG.counts.normalized_count`
- **UI_AFTER_FILTERS** = kombinace `IU_VIDEO_DBG.counts.ui.*` + `IU_VIDEO_DBG.counts.slotCount` + `IU_VIDEO_DBG.counts.injectedVideosCount`
- **UI_RENDERED** = `IU_VIDEO_DBG.counts.domVideoCardsTotal` (a zvlášť `domVideoCardsSlots`)
- **POSTER_OK/FAIL** = `IU_VIDEO_DBG.posters` (z poster auditu, debug-only, limit 30)

## 5.3 Důvody vyřazení (agregace)

V debug režimu (`?debug=1`) se agregují důvody do `IU_VIDEO_DBG.drops` a sample do `IU_VIDEO_DBG.samples` (max 30).

Minimální reason set (splněno):
- `missing_id`
- `missing_title`
- `duplicate`
- `lang_miss`
- `topic_miss`
- `duration_too_short`
- `duration_too_long`
- `title_blocklist`
- `bad_publishedAt`
- `age_gt_<Nh>` (z age filteru)
- `render_target_missing`

Pozn.: `allowlist_miss` je build-side (v app.js už allowlist není), proto se v UI typicky neobjevuje.

## 5.4 Poster/náhledy (agregace)

Build generuje `thumb` vždy jako `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (`scripts/build_videos.py`), a `assets/app.js` ho používá přímo v inline stylu CSS var `--iuVideoThumb`.

Debug-only poster test (limit 30) agreguje do:
- `poster_ok_head`
- `poster_ok_get`
- `poster_ok_img`
- `poster_head_not_ok`
- `poster_get_not_ok`
- `poster_img_error`
- `poster_missing`
- `poster_network`

Výstup:
- `IU_VIDEO_DBG.posters` (count map)
- `IU_VIDEO_DBG.posterSamples` (max 20 URL + reason)

## 5.5 GitHub Actions / build log výňatky

Workflow, který generuje `projects/data/videos.json`:
- **GitHub Actions workflow**: `Update articles data` (`.github/workflows/update-articles.yml`)
- **Skript**: `scripts/build_videos.py`
- **Vstupy**: `projects/data/videos_allowlist.json` (pouze `official:true` zdroje; handle/channel/playlist → Atom feed `youtube.com/feeds/videos.xml?...`)
- **Výstup**: `projects/data/videos.json` (schema: `{generatedAt, sourcesMeta, categories, videos:[...]}`).

Relevantní log z run `Update articles data` (ID `22098435556`):

```text
WARN: resolver handle failed status=404 url=https://www.youtube.com/@XTBcz
WARN: resolver unsupported source: https://www.youtube.com/@XTBcz
...
VIDEOS_FRESHNESS primary14=272 fallback60=128 older=0 total=400
OK: build_videos.py ran
```

Závěr: build sice část handle resolverů nedá, ale **videos.json je plné a obsahuje CZ**.

## 5.6 Konkrétní oprava (jen návrh, bez implementace)

**Viník (nejpravděpodobnější)**: `assets/app.js` render gate pro standardní feed:
- při `shouldInjectVideos=true` se pipeline `contentType=video` položky **přeskočí** a mají se vložit až přes `iuEnsureVideoAnchors()`;
- pokud daný view nemá dost článků (nebo je to “media view” bez článků), vyjde `slotCount=0` → anchor pass nic nevloží → **0 videí / 0 náhledů** i když data existují.

**Návrh fixu** (vyber 1, bez refaktoru):
- **Varianta A (nejpřímější)**: Když je aktivní “media” view (např. `?section=media`), explicitně nastavit režim jako “video section” (tj. aby `hasVideoSection=true`), tím pádem `shouldInjectVideos=false` a video položky se renderují přímo.
- **Varianta B (nejbezpečnější pro feed)**: V `renderFeed` vypnout anchor režim, pokud `slotCount===0` a zároveň `visibleItems` obsahují videa → neskipovat `kind==="video"`.
- **Varianta C (nejčistší, delší)**: Oddělit “standard feed injection” a “video-only feed” jako dvě explicitní render cesty (stále přes `renderFeed`, jen s jednoznačným mode flag), aby se nemíchaly režimy podle `activeSections`.

