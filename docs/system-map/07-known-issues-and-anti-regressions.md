# 07 – Known issues & anti-regressions

Tento dokument drží:
- **známé rizikové oblasti** (CLS, cache, SW, feed refresh)
- **anti-regresní kontrolní body** (co se nesmí vrátit)

## 1) CLS / layout shift

### Typické spouštěče

- animace výšky (např. `max-height` na accordion/`details`)
- pozdní vložení obsahu (feed/daily/mind panel) bez rezervované výšky
- „clear → append“ render pattern (krátké prázdno v DOM)

### Evidence: `scrollbar-gutter`

Výskyty v repu (doloženo `git grep`):

- `assets/app.css:103` → `scrollbar-gutter: stable;`

### Anti-regrese

- při reload/refresh:
  - feed nesmí „spadnout“ na prázdno na ~0.5s
  - pravý sloupec (MindMenu/accordion) nesmí poskakovat kvůli tranzicím

## 2) „Mizící feed“ při refresh

Riziko: během refresh může dojít k vyprázdnění DOM a následnému doplnění → vizuální flicker + CLS.

Anti-regrese:
- preferuj atomické DOM update operace (`replaceChildren`/fragment) místo `innerHTML=""` + postupné append
- v debug režimu `?debug=1` sleduj:
  - debug box / logy v `assets/app.js` (např. `debugBoxSet(...)` kolem `assets/app.js:2527+`)

## 3) Service Worker cache a build změny

Riziko: kombinace SW cache + změna runtime bundlu může způsobit nekonzistentní stav (stará app logika vs nová data).

Současné guardy:
- `assets/app.js` má „hard reset“ při změně build stampu: maže `caches` a odregistruje SW a reloadne stránku.
- `sw.js` má vlastní cache verzi a TTL tabulku pro JSON data.

Anti-regrese:
- build stamp (`<meta name="iu-build">`) musí být udržován a konzistentně používaný (viz `projects/index.html`)
- querystring verze pro `assets/app.css` a `assets/app.js` musí zůstat v `projects/index.html`

## 4) Data freshness / prázdná data

Riziko: pipeline vygeneruje prázdný nebo starý `articles.json` → web „nemá co zobrazit“.

Guards:
- `pages.yml` sanity check vyžaduje `projects/data/articles.json` non-empty + `generatedAt`.
- `ci-data-freshness.yml` hlídá max age.
- `ci-heartbeat.yml` pingá produkční endpointy.

Anti-regrese:
- nikdy neměň pipeline tak, aby `projects/data/articles.json` mohl být commitnut jako prázdný soubor.

## Co už je „hotové“ na `main` (ověřovat z historie)

Tahle sekce se má aktualizovat vždy z `git log`/PR historie, ne odhadem. Aktuální evidence z `git log --grep cls`:

- `847d3d9` **fix: add global CLS guards (scrollbar + media sizing)** → `assets/app.css`
- `06deb24` **fix: lock height for daily weather (CLS)** → `assets/app.css`
- `dbc6726` **fix: improve CLS debugging (debug=1)** → `assets/app.css`, `assets/app.js`
- `b444785` merge **fix/cls-feed-no-flicker-3**
  - HEAD feature commit `04bb63f` **fix: eliminate remaining feed render intermediate empty state** → `assets/app.js`

Minimální postup ověření:

```powershell
git log -20 --oneline
git show --name-only HEAD
```

