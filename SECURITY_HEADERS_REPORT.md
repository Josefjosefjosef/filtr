# Security Headers Audit Report

## Verdict

| Header | HEADER_PRESENT | HEADER_RECOMMENDED | CHANGE_APPLIED | RISK |
|--------|----------------|-------------------|----------------|------|
| Content-Security-Policy | YES (meta) | YES | Partial CSP tighten in meta | PASS |
| X-Content-Type-Options | YES | YES | **FIXED** in `_headers` | PASS |
| Referrer-Policy | YES | YES | **FIXED** `strict-origin-when-cross-origin` | PASS |
| Permissions-Policy | YES | YES | **FIXED** camera/mic/payment denied; geolocation self | PASS |
| X-Frame-Options | YES | YES | Already present `SAMEORIGIN` | PASS |
| Cross-Origin-Opener-Policy | NO | OPTIONAL | Not applied — **NEEDS REVIEW** | LOW |
| Cross-Origin-Resource-Policy | NO | OPTIONAL | Not applied — could break cross-origin imgs | SKIP |

## Files

- `_headers` — Cloudflare Pages / compatible static host
- `projects/index.html` — meta CSP + cache meta

## CHANGE_APPLIED (Phase 1)

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), payment=(), geolocation=(self)
  X-Frame-Options: SAMEORIGIN
```

## NOTES

- YouTube embeds: `frame-src` in CSP meta; `X-Frame-Options: SAMEORIGIN` applies to InfoUzel pages, not to embedded YouTube.
- PWA / JSON / maps links: unaffected by new headers.
- COOP `same-origin` deferred — otestovat dopad na `window.open` v MindMenu v samostatném PR.
