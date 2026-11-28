# Pages deploy skew: retained hashed assets

## Problem
`pages.yml` publishes per-deploy hashed copies (`/assets/iu-info-system-core-v1.<SHA8>.js`, `app.<SHA8>.css`, ...).
GitHub Pages swaps the whole artifact, so the previous `<oldSHA8>` files return 404 immediately after a deploy.
Open tabs, CDN-cached HTML, or SW last-good HTML that still reference the old hash then fail to load
(P0 proof: `7f9d8fda` 404 while HTML referenced `ae31a0d3`).

## Fix
`scripts/iu-pages-retain-prev-assets-v1.mjs` runs in `pages.yml` after staging `dist-pages` and before the artifact guard/upload:

1. Reads the retained manifest (`/assets/iu-retained-assets-v1.json`) from the live site (older generations, TTL-bounded).
2. Reads the live home HTML, extracts `/assets/<name>.<8hex>.(js|css)` refs and follows hashed `import` deps in JS.
3. Downloads those files and copies them into `dist-pages/assets/` (never overwrites files shipped by the new deploy).
4. Writes the new manifest with `firstSeenUtc`; entries older than TTL (default 24 h, `IU_PAGES_RETAIN_TTL_HOURS`) are dropped.

Best-effort and fail-open: if the live site is unreachable the deploy continues (manifest is not rewritten).
Cap: `IU_PAGES_RETAIN_MAX_FILES` (default 60).

Selftest (local fake origin, runs in smoke): `npm run iu-pages-retain-prev-assets-selftest`.

## Service Worker audit (`sw.js`)
- HTML (`/`, `/index.html`, ...) is **network-first, `cache: "no-store"`**; navigations are network-first as well. HTML is
  only served from cache when the network fails (`HTML_LAST_GOOD_CACHE`, offline fallback) — an old shell in that path may
  reference an old hash, which is now covered by retention for the TTL window.
- `install` calls `skipWaiting()`, `activate` calls `clients.claim()` and wipes versioned `iu-app-*` caches; no precached HTML.
- Hashed assets are immutable per URL, so the generic SWR rule for `/assets/*.js|css` is safe; no SW change required.
- Remaining gap: a tab opened before deploy that lazily imports a hashed module after TTL expiry still 404s; reload fixes it
  (`IU_SW_DEPLOY_RELOAD` is broadcast on SW update).
