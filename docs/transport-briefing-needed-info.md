# Transport / Jízdní řády — technický briefing (co je potřeba vědět pro UI bez serveru)

## 1) Typ výsledku (A/B) + důkaz

**Typ: A) Zdroj vrací už spočítané spojení — ale UI ho dnes neparsuje; pouze otevře externí IDOS stránku s výsledky.**

- **Důkaz (kód)**: `assets/app.js`
  - `iuJRBuildIdosUrl(opts)` skládá URL na IDOS spojení (hotový planner): `https://idos.idnes.cz/.../spojeni/?f=...&t=...`
  - `iuJROpenIdos(opts)` volá `window.open(url, ...)` (žádné `fetch()` na IDOS, žádné parsování výsledku)
- **Důkaz (HTML text v UI)**: `projects/index.html` — „Vyhledávání tras/odjezdů a výsledky poskytuje IDOS – otevře se externí stránka.“

**Důkaz struktury dat (jediná ukázka)**: data pro JR v UI jsou pouze **seznam názvů zastávek** (JSON pole stringů), bez spojů/časů/routing dat.

```json
[
  "Praha",
  "Praha hl.n.",
  "Praha Masarykovo n.",
  "Praha-Smíchov",
  "Praha-Vršovice",
  "Praha-Libeň",
  "Praha-Holešovice",
  "Praha-Dejvice",
  "Praha-Radotín",
  "Praha-Zličín",
  "Brno",
  "Brno hl.n."
]
```

Zdroj: `projects/data/jr_stops_min.json` (stejný formát jako `jr_stops_all_min.json`, jen menší výřez).

## 2) Datové zdroje (jen to, co reálně používáme)

- **infoUzel (statický soubor pro našeptávač)** — `/projects/data/jr_stops_all_min.json` — **aktualizace hourly** (GitHub Actions cron) — voláno v `assets/app.js` → `iuJRLoadStopsOnce()` (fetch `JR_STOPS_URL`) — **formát: JSON (array of strings)**
- **CIS JŘ (oficiální stop list)** — `https://portal.cisjr.cz/pub/seznamy/zastavky.csv` — **aktualizace: není v kódu uvedena (externí zdroj); náš import běží hourly** — používá `scripts/build_jr_stops_all.mjs` → `downloadHttp(URL_STOPS_LIST, ...)` — **formát: CSV (1 sloupec, CP852, jedna zastávka na řádek, uvozovky)**
- **CIS JŘ (FTP fallback pro stop list)** — `ftp://ftp.cisjr.cz/pub/seznamy/zastavky.csv` — **best-effort fallback** (jen pokud HTTP selže) — `scripts/build_jr_stops_all.mjs` → `downloadViaCurl(ftpUrl, ...)` — **formát: CSV (stejné jako výše)**
- **CIS JŘ (ZIP fallback; jen stažení, bez parsování)** — `https://portal.cisjr.cz/pub/JDF/JDF.zip`, `https://portal.cisjr.cz/pub/draha/mestske/JDF.zip` — **best-effort fallback** (jen pokud CSV selže) — `scripts/build_jr_stops_all.mjs` → `downloadHttp(u, ...)` — **formát: ZIP**
- **IDOS (externí web pro výsledky spojení)** — `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?...` — **aktualizace: n/a (externí web)** — voláno v `assets/app.js` → `iuJRBuildIdosUrl()` / `iuJROpenIdos()` — **formát: HTML (otevře se v nové záložce)**
- **IDOS (externí web pro odjezdy)** — `https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/` — **aktualizace: n/a (externí web)** — voláno v `assets/app.js` → `iuJRBuildIdosDeparturesUrl()` / `iuJROpenIdosDepartures()` — **formát: HTML (otevře se v nové záložce)**

**Update schedule (pokud je v kódu/workflow):**
- `.github/workflows/update-jr-stops.yml` — cron: `0 * * * *` (každou hodinu) — spouští `node scripts/build_jr_stops_all.mjs` a commitne `projects/data/jr_stops_all_min.json`, pokud je změna.

## 3) Jak to běží na statickém webu dnes

- **Po načtení stránky**
  - Načte se `projects/index.html` → JS bundle `assets/app.js`.
  - Sekce se bere z query parametru `?section=...` (`assets/app.js` → `applySectionFromURL()`).
  - Pokud je sekce `jizdnirady`, zavolá se `iuJRInitView()` a rovnou `iuJRLoadStopsOnce()` (tj. stáhne se dataset zastávek).
- **Po odeslání formuláře („Najít spojení“)**
  - `assets/app.js` (`iuJRInitView()`): handler na `submit` jen posbírá hodnoty, naformátuje datum/čas a zavolá `iuJROpenIdos({from,to,...})`.
  - `iuJROpenIdos()` otevře novou záložku přes `window.open()` na složené IDOS URL. UI neprovádí žádný routing ani parsování výsledků.
- **Caching**
  - Načítání zastávek: `fetch(JR_STOPS_URL, { cache: 'force-cache' })` (HTTP cache prohlížeče).
  - UI persistence: `localStorage`
    - `iuJR:favs` (oblíbené trasy)
    - `iuJR:mode` (routes/departures)
  - Dataset zastávek se po načtení drží v paměti (`__iuJRDisplay/__iuJRNorm/__iuJRIndex`), neukládá se do localStorage.
- **Zdroj dat: předgenerované vs live**
  - JR zastávky: **předgenerované** v `projects/data/jr_stops_all_min.json` (stažení z vlastního originu).
  - „Výsledky spojení“: **externí stránka IDOS** (navigace/nová záložka), ne `fetch`.

## 4) Klíčové limity pro „100% funkční“ bez serveru (fakta z implementace/dat)

- **Velikost dat v repu (JR)**
  - `projects/data/jr_stops_all_min.json`: **1,154,276 B (~1.101 MB)**, **37,884 položek**
  - `projects/data/jr_stops_min.json`: **3,155 B (~0.003 MB)**, **167 položek**
- **Co tato data obsahují**
  - Jen názvy zastávek (stringy). V repu (pro JR UI) nejsou žádná data typu trips/stop_times/routes/kalendáře odjezdů.
- **CORS / možnost fetch z prohlížeče**
  - UI dnes fetchuje jen **same-origin** `/projects/data/jr_stops_all_min.json` → CORS se neřeší.
  - IDOS se nefetchuje (jen `window.open` na externí web).
- **Chování při výpadku**
  - Pokud selže fetch zastávek (`iuJRLoadStopsOnce()` catch): nastaví se režim `disabled`, autocomplete vrací prázdné návrhy; **free-text vstupy + otevření IDOS URL stále funguje** (validace submitu je jen „neprázdné odkud/kam“).
  - Pokud je nedostupný IDOS: v UI není implementovaný žádný fallback (jen otevření externí stránky).
- **Build-time odolnost importu CIS JŘ**
  - `scripts/build_jr_stops_all.mjs` při podezřelém výsledku (např. počet < 30k nebo chybějící kontrolní zastávky) **nezapíše degradovaná data** a „ponechá existující dataset“ (v praxi tedy zůstane poslední známá dobrá verze v repu).

## 5) IDOS/eIDOS grep výsledek (povinné)

**Příkaz (přesně dle zadání):**

```bash
git grep -n -i "eidos\|idos\|idos\.cz\|eidos\.cz" -- . || true
```

**Výsledek (výstup příkazu):**

```text
assets/app.css:2796:   UI-only: deep-link to IDOS, no scraping
assets/app.js:5309:  // - Deep-link results to IDOS (no scraping)
assets/app.js:5314:  // IDOS departures prefill support is NOT verified yet.
assets/app.js:5521:  function iuJRBuildIdosUrl(opts){
assets/app.js:5528:    return `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?f=${f}&t=${t}&date=${date}&time=${time}&byarr=${byarr}&direct=${direct}&submit=true`;
assets/app.js:5531:  function iuJRBuildIdosDeparturesUrl(opts){
assets/app.js:5533:    if (!JR_DEPARTURES_SUPPORTS_PREFILL) return 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
assets/app.js:5537:    const base = 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
assets/app.js:5542:  function iuJROpenIdos(opts){
assets/app.js:5543:    const url = iuJRBuildIdosUrl(opts);
assets/app.js:5551:  function iuJROpenIdosDepartures(opts){
assets/app.js:5559:      const url = iuJRBuildIdosDeparturesUrl({ stop, date, time });
assets/app.js:5563:    iuJROpenIdos({ from: stop, to: '', date, time, byarr: false, direct: false });
assets/app.js:5882:        iuJROpenIdosDepartures({ stop, date, time });
assets/app.js:5918:        iuJROpenIdos({ from, to, date, time, byarr, direct });
docs/transport-data-sources.md:6:- **eIDOS**: v repu **nenalezeno** (ověřeno `git grep -n -i -E -- "eidos|eidos\.cz" -- .`, exit_code=1).
docs/transport-data-sources.md:7:- **IDOS**: v repu je použit pouze jako **externí odkaz / otevření nové záložky** (HTML linky + `window.open`), nikde se neprovádí `fetch()` na `idos.idnes.cz`.
docs/transport-data-sources.md:18:| IDOS (externí web) – trasy | `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?...` | `assets/app.js:5528` (`iuJRBuildIdosUrl`) | Klik na „Najít spojení“ (submit) | Nic (jen sestavení URL + `window.open`) | Externí stránka (nová záložka) |
docs/transport-data-sources.md:19:| IDOS (externí web) – odjezdy | `https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/` (příp. parametry) | `assets/app.js:5533` / `5537` (`iuJRBuildIdosDeparturesUrl`) | Klik na „Zobrazit odjezdy“ | Nic (jen sestavení URL + `window.open`) | Externí stránka (nová záložka) |
docs/transport-data-sources.md:39:assets/app.js:5528:    return `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?f=${f}&t=${t}&date=${date}&time=${time}&byarr=${byarr}&direct=${direct}&submit=true`;
docs/transport-data-sources.md:40:assets/app.js:5533:    if (!JR_DEPARTURES_SUPPORTS_PREFILL) return 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
docs/transport-data-sources.md:41:assets/app.js:5537:    const base = 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
docs/transport-data-sources.md:42:projects/index.html:547:                          <a href="https://idos.idnes.cz/" target="_blank" rel="noopener noreferrer">IDOS</a>
docs/transport-data-sources.md:43:projects/index.html:549:                          <a href="https://idos.idnes.cz/smluvni-podminky/" target="_blank" rel="noopener noreferrer">Smluvní podmínky</a>
projects/index.html:546:                          Našeptávač názvů zastávek je z otevřených dat CIS JŘ (portal.cisjr.cz). Vyhledávání tras/odjezdů a výsledky poskytuje IDOS – otevře se externí stránka.
projects/index.html:547:                          <a href="https://idos.idnes.cz/" target="_blank" rel="noopener noreferrer">IDOS</a>
projects/index.html:549:                          <a href="https://idos.idnes.cz/smluvni-podminky/" target="_blank" rel="noopener noreferrer">Smluvní podmínky</a>
```

