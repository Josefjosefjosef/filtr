# CSP Tightening Plan — Phase 2+ (not implemented in Phase 1)

## Goal

Postupně odstranit `https:` wildcardy bez rozbití článků, PWA, YouTube, počasí a Silver.

## Phase 2 — img-src

1. Inventura top 50 img hostů z `projects/data/articles*.json` (pipeline report).
2. Přidat explicitní hosty: `i.ytimg.com`, common RSS CDNs.
3. Zvážit `img-src 'self' data: blob: https://i.ytimg.com` + dynamický allowlist v `_headers` (Cloudflare transform rules) — **NEEDS REVIEW**.

## Phase 3 — inline scripts

1. PWA inline bootstrap v `projects/index.html` → externí `iu-pwa-inline-boot.js` s hash/nonce.
2. Odstranit `'unsafe-inline'` ze `script-src` po migraci.

## Phase 4 — CSP v `_headers`

1. Duplikovat meta CSP do `_headers` pro `/projects/` a `/projects/index.html`.
2. Jednotný zdroj pravdy: generátor z `assets/iu-external-origins.js`.

## Phase 5 — connect-src rozšíření

Před přidáním nových fetch API (VIN worker, geocoding) aktualizovat registry + CSP v jednom PR.

## Do Not Change Without Proof

- `'wasm-unsafe-eval'` — PDF/vendor knihovny
- `frame-src` YouTube domény
- `connect-src` Open-Meteo bez regression testu počasí
