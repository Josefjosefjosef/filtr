# 04 – UI modules (panely, overlaye, selektory)

Zdroj pravdy:
- HTML skeleton: `projects/index.html`
- Styly: `assets/app.css`
- Runtime logika: `assets/app.js`

## Přehled modulů (tabulka)

| Modul | HTML hooky (id/class) | Ovládání | Stav / JS poznámky | Data zdroje | Rizika |
|---|---|---|---|---|---|
| Feed (hlavní seznam) | `#feed` (`projects/index.html:14` pro debug CSS) | (řízení v JS) | renderuje `loadData()` (`assets/app.js:2477`) | `https://infouzel.cz/projects/data/articles.json` (`assets/app.js:2531`) + `videos.json` (`assets/app.js:2532`) | CLS při „clear→append“, dočasné prázdno při refresh |
| Denní panel (čas/svátek/počasí) | `.iuDailyPanel` (`projects/index.html:233`), `#iuDailyWeather` (`projects/index.html:241`), `#iuDailyNameday` (`projects/index.html:239`) | (bez tlačítek) | init: `window.iuDailyPanelInit` (`assets/app.js:3264`) | nameday: `assets/app.js:3320` (externí fetch), počasí: `assets/app.js:3354+` | CLS při pozdním naplnění obsahu, stabilita výšek |
| AI panel (modal) | `#iu-aiPanel` (`projects/index.html:312`), quick button `[data-action="ai-panel"]` (`projects/index.html:104`) | otevření přes quick button, zavření ESC/klik | init: `initAiPanel()` (`assets/app.js:3777-3875`) | statické odkazy (HTML) | CLS/overlay (z-index), focus/scroll lock |
| Balíky (popover) | `#iuParcelsPopover` (`projects/index.html:1666`), `.iu-parcels-overlay` (`projects/index.html:1665`), `#iuParcelsBtn` (`projects/index.html:288`), `#iuParcelsBtnMobile` (`projects/index.html:112`) | tlačítko „Balíky“ (desktop/mobile) | izolovaný modul (`assets/app.js:3582+`) | externí tracking URL dle dopravce (v JS mapě) | overlay + reflow při otevření |
| Mind panel (pravý sloupec) | `#iuMindPanel` (`projects/index.html:415`) | (dle HTML/CSS) | hook je v HTML, další logika dle `assets/app.js`/CSS | mix (část statická, část dynamická) | CLS kvůli výškám a přechodům |

Pozn.: konkrétní názvy dalších panelů („Rychlé odkazy“, apod.) jsou v HTML snapshotu a CSS, ale System Map drží jen ověřené hooky (viz grep výstupy).

## CLS guards (kde jsou)

### `scrollbar-gutter: stable`

V `assets/app.css` je guard:

- `assets/app.css:103` → `scrollbar-gutter: stable;`

Ověř vždy příkazem:

```powershell
git grep -n 'scrollbar-gutter' -- assets/app.css
```

### Globální pravidla pro sizing médií

Základní globální pravidla jsou např. na:

- `assets/app.css:107` → `img, svg, video, iframe{ ... max-width:100%; height:auto; }`

Ověř vždy příkazem:

```powershell
git grep -n 'max-width' -- assets/app.css
git grep -n 'height:auto' -- assets/app.css
git grep -n 'height: auto' -- assets/app.css
```

## Spouštěče (trigger points)

- **Debug režim**: query `?debug=1` (viz `projects/index.html` a `debug.js`)
- **SW/cache chování**: `assets/app.js` (build stamp + hard reset) a `sw.js` (cache strategie)

