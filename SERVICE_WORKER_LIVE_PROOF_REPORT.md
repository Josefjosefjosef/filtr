# Service Worker Live Proof Report (production, no `nosw=1`)

**Date:** 2026-06-09  
**URL:** https://infouzel.cz/projects/?section=media  
**Proof method:** Playwright headless against live production (SW enabled)

## Summary

| Field | Value |
|-------|-------|
| **SW_REGISTERED** | **YES** |
| **SW_ACTIVE** | **YES** |
| **SW_ERRORS** | none |
| **CACHE_ERRORS** | none |
| **CSP_VIOLATIONS** | 0 |
| **INFO_CENTER_WITH_SW** | **PASS** |
| **STORAGE_NOTICE_WITH_SW** | **PASS** |
| **ARTICLES_WITH_SW** | **PASS** |
| **WEATHER_WITH_SW** | **PASS** |

**Verdict:** Service Worker — **PRODUCTION_READY**

## Details

### Registration & state

```
swRegistered: true
swActive: true
swState: activated;active:activated
scriptURL: https://infouzel.cz/sw.js (via registration)
swErrors: []
```

### Cache API

- `caches.keys()` succeeded
- No cache API exceptions during session

### Functional checks (with SW active)

| Check | Result |
|-------|--------|
| Page loads | PASS |
| `publishable_pool.json` fetch | PASS (200, JSON valid) |
| Weather UI present | PASS |
| Storage notice first visit | PASS |
| Storage dismiss (Rozumím) | PASS |
| Info Center open | PASS |
| Cookies section | PASS |
| Reload with SW still active | PASS (`swStillActive: true`) |

### Security / quality

| Metric | Value |
|--------|-------|
| CSP violations | 0 |
| consoleErrors (filtered) | 0 |
| appErrors | 0 |
| overflowX | false |
| CLS (check_site, SW enabled) | 0.0017 |

### Notes

- **`check_site.js`** with SW enabled reported one transient `InvalidStateError` during SW update in puppeteer — did not reproduce in dedicated SW proof; no user-visible regression.
- Desktop proof: `#iuMindMenu` mobile id not visible at 1280px (sidebar layout); `hasMindMenu: true` in layout guard — **not a SW regression**.

## Proof command

Script: `%TEMP%\iu_sw_live_proof.cjs` (not committed per repo rules).  
Exit code: **0** (PASS).
