# CSP Audit Report — InfoUzel Phase 1

## Verdict

| Field | Value |
|-------|-------|
| **CSP_PRESENT** | YES |
| **CSP_TIGHTENED** | YES (partial) |
| **RISK** | PASS (residual img-src wildcard) |

## Location

- Primary: `<meta http-equiv="Content-Security-Policy">` in `projects/index.html`
- HTTP headers: `_headers` (cache + security headers; CSP zatím meta-only)

## Before vs After (Phase 1)

| Directive | Before | After |
|-----------|--------|-------|
| `default-src` | `'self' https:` | `'self' https:` (unchanged) |
| `base-uri` | *(missing)* | `'self'` |
| `object-src` | *(missing)* | `'none'` |
| `connect-src` | inherited `https:` | `'self' https://api.open-meteo.com` |
| `script-src` | `'self' 'unsafe-inline' 'wasm-unsafe-eval' https:` | `'self' 'unsafe-inline' 'wasm-unsafe-eval'` |
| `worker-src` | `'self' blob: https:` | `'self' blob:` |
| `style-src` | `'self' 'unsafe-inline' https:` | `'self' 'unsafe-inline'` |
| `font-src` | inherited | `'self' data:` |
| `frame-src` | YouTube domains | unchanged |
| `img-src` | `'self' data: blob: https://i.ytimg.com https:` | unchanged |

## Allowed Domains (effective)

| Directive | Allowed |
|-----------|---------|
| **CONNECT_SRC_ALLOWED** | `'self'`, `https://api.open-meteo.com` |
| **SCRIPT_SRC_ALLOWED** | `'self'`, `'unsafe-inline'`, `'wasm-unsafe-eval'` |
| **STYLE_SRC_ALLOWED** | `'self'`, `'unsafe-inline'` |
| **FRAME_SRC_ALLOWED** | `https://www.youtube.com`, `https://www.youtube-nocookie.com` |
| **IMG_SRC_ALLOWED** | `'self'`, `data:`, `blob:`, `https://i.ytimg.com`, `https:` *(wildcard)* |

## WILDCARDS_REMAINING

- `default-src https:` — fallback pro navigaci/odkazy
- `img-src https:` — nutné pro RSS/article thumbnail hosty (stovky domén)
- `'unsafe-inline'` — PWA bootstrap + inline critical CSS (P0)

## Functional Verification Targets

- YouTube embed — `frame-src` explicit ✅
- Open-Meteo — `connect-src` explicit ✅
- Same-origin JSON/articles/PWA — `'self'` ✅
- Self-hosted JS/CSS/vendor — `script-src`/`style-src` self ✅
- Externí mapy/odkazy — navigace (ne fetch), mimo connect-src ✅

## Residual Risk

Střední: `img-src https:` ponecháno kvůli agregovaným článkům. Další fáze: allowlist CDN hostů nebo proxy obrázků.

## Further Plan

See `CSP_TIGHTENING_PLAN.md` for Phase 2 (img-src allowlist, CSP header migration, nonce/hash for inline scripts).
