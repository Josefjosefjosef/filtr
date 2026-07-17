# Řízený UI Freeze — pre-aggregator-stable-20260717

## Účel

Zamknout vizuální a shell povrchy před kompletní přestavbou agregátoru, aby se UI neregresovalo „po cestě“.

## Pravidla

1. Soubory v `freeze-manifest.json` se **nemění**, pokud změna není:
   - bezpečnostní / crash fix s důkazem,
   - PWA kompatibilita nutná pro produkci,
   - explicitní freeze bump (nový hash + zápis do reportu).
2. Zakázáno: redesign, nové hero/layout experimenty, „cleanup CSS“ bez gate.
3. Povoleno mimo freeze: docs, guards, diagnostika, data bot JSON (oddělené PR).

## Guard

```
npm run iu-pre-aggregator-stable-freeze-guard
```

Zapojeno do `layout-guard.yml`.

## Sdílené komponenty (chráněné)

Viz `03-shared-components.md` — MindMenu, Quicktools, Tasks overlay, Info panel shell, SW registration path, backup/export UI.

## Výjimky

Jakákoliv výjimka musí mít:
- ticket/PR důvod,
- před/po screenshot nebo guard PASS,
- aktualizaci `freeze-manifest.json`.
