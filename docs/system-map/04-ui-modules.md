# 04 – UI modules (panely, overlaye, selektory)

Zdroj pravdy:
- HTML skeleton: `projects/index.html`
- Styly: `assets/app.css`
- Runtime logika: `assets/app.js`

## Přehled modulů (tabulka)

| Modul | HTML hooky (id/class) | Ovládání | Stav / JS poznámky | Data zdroje | Rizika |
|---|---|---|---|---|---|
| Feed (hlavní seznam) | `#feed`, `#newsList` (viz runtime/diagnostika) | sekce menu, filtry | renderuje `loadData()` | `projects/data/articles.json`, volitelně `videos.json` | CLS při „clear→append“, dočasné prázdno při refresh |
| Denní přehled | `.iu-daily-brief` (HTML v `projects/index.html`) | (závisí na runtime) | existují runtime timer hooky (`window.__iu_daily_timer`) | `projects/data/brief.json` (build pipeline) | CLS při pozdním naplnění obsahu |
| MindMenu (pravý sloupec) | `#iuMindPanel`, `.iu-mindDetails` (CSS cílení) | details/summary (accordion) | CSS a JS musí držet výšku stabilní | mix (část statická, část dynamická) | CLS kvůli `max-height` tranzicím a lazy renderu |
| Debug panel | `#iuDebugPanel` | tlačítka Copy/Clear/Close | pouze když `?debug=1` (`debug.js`) | diagnostika fetchů + SW | překryvy, z-index |
| CLS observer (debug) | inline script v `projects/index.html` | `?debug=1` | loguje layout-shift entries | PerformanceObserver | přidává DOM box (jen debug) |

Pozn.: konkrétní názvy dalších panelů („Rychlé odkazy“, apod.) jsou v HTML snapshotu a CSS, ale System Map drží jen ověřené hooky (viz grep výstupy).

## CLS guards (kde jsou)

### `scrollbar-gutter: stable`

V `assets/app.css` je guard:

- `assets/app.css:103` → `scrollbar-gutter: stable;`

Ověř vždy příkazem:

```bash
git grep -n "scrollbar-gutter" -- assets/app.css
```

### Globální pravidla pro sizing médií

Základní globální pravidla jsou např. na:

- `assets/app.css:107` → `img, svg, video, iframe{ ... max-width:100%; height:auto; }`

Ověř vždy příkazem:

```bash
git grep -n -E "img\\s*\\{|video\\s*\\{|max-width:\\s*100%|height:\\s*auto" -- assets/app.css
```

## Spouštěče (trigger points)

- **Debug režim**: query `?debug=1` (viz `projects/index.html` a `debug.js`)
- **SW/cache chování**: `assets/app.js` (build stamp + hard reset) a `sw.js` (cache strategie)

