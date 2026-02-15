# Transport data sources inventory (Travel + JR)

## Shrnutí (fakta)

- Repo obsahuje sekci **„Jízdní řády“** (`?section=jizdnirady`) jako UI vrstvu; autocomplete čte dataset ze souboru v repu a výsledky tras/odjezdů se **nepočítají v našem kódu** – uživatel je otevírá na externím webu.
- **eIDOS**: v repu **nenalezeno** (ověřeno `git grep -n -i -E -- "eidos|eidos\.cz" -- .`, exit_code=1).
- **IDOS**: v repu je použit pouze jako **externí odkaz / otevření nové záložky** (HTML linky + `window.open`), nikde se neprovádí `fetch()` na `idos.idnes.cz`.
- **CIS JŘ (portal.cisjr.cz)**: používá se jen pro **seznam názvů zastávek**; stahování a generování datasetu probíhá v CI skriptem `scripts/build_jr_stops_all.mjs`, ne v prohlížeči.
- Sekce **„Cestování“** v tomto repo slouží jako navigační sekce a obsahově je navázaná na „feed“ pipeline (generované články), nikoliv na CIS/IDOS.

## Seznam zdrojů dat (transport-related)

| Zdroj | Endpoint / soubor | Kde v kódu (soubor:řádek) | Kdy se volá | Co se ukládá | Kde se renderuje |
|---|---|---|---|---|---|
| CIS JŘ stoplist (open data) | `https://portal.cisjr.cz/pub/seznamy/zastavky.csv` | `scripts/build_jr_stops_all.mjs:17` (`URL_STOPS_LIST`) | GitHub Actions `update-jr-stops.yml` (cron hourly) | V repu: `projects/data/jr_stops_all_min.json` (jen názvy zastávek) | V prohlížeči: autocomplete dropdown v JR view |
| CIS JŘ fallback (FTP) | `ftp://ftp.cisjr.cz/pub/seznamy/zastavky.csv` | `scripts/build_jr_stops_all.mjs:138` (`ftpUrl`) | Pouze pokud HTTP download selže | Stejné jako výše | Stejné jako výše |
| JR stop dataset (runtime) | `/projects/data/jr_stops_all_min.json` | `assets/app.js:5311` (`JR_STOPS_URL`) | Při vstupu do sekce `jizdnirady` → `iuJRLoadStopsOnce()` | V paměti: indexované `display/norm/index` (nebo lazy režim) | `projects/index.html`: `#iuJizdniRadyView` inputs + suggestion listbox |
| IDOS (externí web) – trasy | `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?...` | `assets/app.js:5528` (`iuJRBuildIdosUrl`) | Klik na „Najít spojení“ (submit) | Nic (jen sestavení URL + `window.open`) | Externí stránka (nová záložka) |
| IDOS (externí web) – odjezdy | `https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/` (příp. parametry) | `assets/app.js:5533` / `5537` (`iuJRBuildIdosDeparturesUrl`) | Klik na „Zobrazit odjezdy“ | Nic (jen sestavení URL + `window.open`) | Externí stránka (nová záložka) |
| Feed pipeline (sekce „Doprava“ / „Cestování“) | `projects/data/articles.json` (+ `projects/data/articles/*.json`) | CI: `.github/workflows/update-articles.yml:44` (`python scripts/build_articles.py`) | GitHub Actions každých 15 min | JSON soubory v `projects/data/*` | `#feed` (sekce „media“; jiné sekce feed skrývají CSS/JS dle routing) |

## Odkazy / reference na IDOS a CIS JŘ (všechny výskyty)

### eIDOS (ověření „nenalezeno“)

- Příkaz:

```text
git grep -n -i -E -- "eidos|eidos\.cz" -- .
```

- Výsledek: **nenalezeno** (exit_code=1).

### IDOS (výskyty v repu)

Výskyty `idos.idnes.cz`:

```text
assets/app.js:5528:    return `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?f=${f}&t=${t}&date=${date}&time=${time}&byarr=${byarr}&direct=${direct}&submit=true`;
assets/app.js:5533:    if (!JR_DEPARTURES_SUPPORTS_PREFILL) return 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
assets/app.js:5537:    const base = 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
projects/index.html:547:                          <a href="https://idos.idnes.cz/" target="_blank" rel="noopener noreferrer">IDOS</a>
projects/index.html:549:                          <a href="https://idos.idnes.cz/smluvni-podminky/" target="_blank" rel="noopener noreferrer">Smluvní podmínky</a>
```

Otevírání externích URL (včetně JR):

```text
assets/app.js:4205:        window.open(url, "_blank", "noopener");
assets/app.js:4415:    window.open(url, '_blank', 'noopener,noreferrer');
assets/app.js:5545:      window.open(url, '_blank', 'noopener,noreferrer');
assets/app.js:5560:      window.open(url, '_blank', 'noopener,noreferrer');
assets/app.js:6243:        try { window.open(r.url, "_blank", "noopener,noreferrer"); } catch {}
```

### CIS JŘ / portal.cisjr.cz (výskyty v repu)

```text
projects/index.html:546:                          Našeptávač názvů zastávek je z otevřených dat CIS JŘ (portal.cisjr.cz). Vyhledávání tras/odjezdů a výsledky poskytuje IDOS – otevře se externí stránka.
scripts/build_jr_stops_all.mjs:17:const URL_STOPS_LIST = 'https://portal.cisjr.cz/pub/seznamy/zastavky.csv';
scripts/build_jr_stops_all.mjs:19:  'https://portal.cisjr.cz/pub/JDF/JDF.zip',
scripts/build_jr_stops_all.mjs:20:  'https://portal.cisjr.cz/pub/draha/mestske/JDF.zip'
scripts/build_jr_stops_all.mjs:138:      const ftpUrl = 'ftp://ftp.cisjr.cz/pub/seznamy/zastavky.csv';
```

## Datový tok end-to-end (JR)

### 1) Dataset update (CI)

- **Workflow**: `.github/workflows/update-jr-stops.yml`
  - Trigger: `schedule` cron `0 * * * *` + `workflow_dispatch`
  - Build: `node scripts/build_jr_stops_all.mjs`
  - Commit: pouze `projects/data/jr_stops_all_min.json` pokud se změnil

- **Builder skript**: `scripts/build_jr_stops_all.mjs`
  - Download: `downloadHttp(URL_STOPS_LIST)` (`https://portal.cisjr.cz/pub/seznamy/zastavky.csv`)
  - FTP fallback: `downloadViaCurl(ftpUrl)` (`ftp://ftp.cisjr.cz/pub/seznamy/zastavky.csv`)
  - Decode: `decodeCp852()` (TextDecoder `ibm852`) – vstup dekódován CP852
  - Validace:
    - `MIN_EXPECTED_STOPS = 30000`
    - `mustHave = ['5. května', 'Čáslav']`
  - Atomic write: zapisuje do `projects/data/jr_stops_all_min.json.tmp` a pak `renameSync` na finální JSON
  - Fail režim: při chybě/validaci neprojde → **nepřepíše** finální dataset, `exit 0`

### 2) Runtime (prohlížeč)

- **Vstup do sekce**: `assets/app.js` → `applySectionFromURL()` volá `iuJRInitView()` + `iuJRLoadStopsOnce()` při `section === 'jizdnirady'` (viz `assets/app.js` okolo `iuJRInitView` a `iuJRLoadStopsOnce`).
- **Fetch datasetu**: `iuJRLoadStopsOnce()`:
  - `fetch(JR_STOPS_URL)` (`/projects/data/jr_stops_all_min.json`)
  - In-memory cache (indexed režim): `__iuJRDisplay`, `__iuJRNorm`, `__iuJRIndex`
  - **Enterprise memory guard**: pokud `data.length > JR_MAX_INDEXED_STOPS`, přepne na `window.__iuJRMode='lazy'` a drží jen `window.__iuJRStopsRaw` (bez indexů)
- **Autocomplete**:
  - Normalizace dotazu: `iuJRNormalize()` (`normalize('NFD') + remove diacritics + lower + space collapse`)
  - Indexed režim: bucket dle 1. znaku + ranking (prefix / word-start / contains)
  - Lazy režim: lineární scan nad `__iuJRStopsRaw` s limitem `JR_LAZY_LIMIT`
- **Uložení v prohlížeči**:
  - `localStorage` klíče: `iuJR:mode` (mode) a `iuJR:favs` (oblíbené trasy)

### 3) Otevření výsledků (externě)

- Trasy: `iuJROpenIdos()` → `window.open(url, '_blank', 'noopener,noreferrer')`
- Odjezdy: `iuJROpenIdosDepartures()` → `window.open(...)` (a fallback-by-design dle flagů)
- Neprovádí se žádné parsování/ukládání výsledků spojů v repo.

## Rizika a single point of failure (technicky)

- **Upstream CIS JŘ nedostupný / změněný**:
  - Builder má HTTP retry + FTP fallback; pokud vše selže nebo validace neprojde → dataset zůstává poslední dobrý v repu (`keeping_existing_dataset=true`, exit 0).
- **Dataset runtime fetch failne (prohlížeč)**:
  - `iuJRLoadStopsOnce()` catch → `window.__iuJRMode='disabled'`, autocomplete vrací prázdné návrhy, ale free-text + IDOS deep-link funguje.
- **Budoucí růst datasetu**:
  - Memory guard (`JR_MAX_INDEXED_STOPS`) přepne na lazy režim bez indexů.

## Příkazy použité pro forenzní inventuru (repro)

### 1A) Klíčová slova (původní příkaz z auditu)

```text
git grep -n -i "eidos\|idos\|cis\|cendis\|jr\|jizdni\|jízdní\|timetable\|gtfs\|hafas\|transport\|spoj\|spojeni\|spojení\|praha\|brno" -- .
```

Pozn.: Výstup je rozsáhlý hlavně kvůli obecným výrazům („Praha“, „Brno“, „spojení“) v datech článků; transport‑specifické výskyty jsou vypsané výše v sekci „Reference na IDOS a CIS JŘ“.

### 1B) URL a fetchy (původní příkaz z auditu)

```text
git grep -n -i "https\?://\|fetch(\|XMLHttpRequest\|axios\|openapi\|graphql\|api\." -- projects assets scripts data *.md
```

### 1C) Externí otevření / odkazy (původní příkaz z auditu)

```text
git grep -n -i -E -- 'target="_blank"|window\.open|location\.href|href=.*idos|href=.*eidos' -- .
```

