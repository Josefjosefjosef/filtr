# Service Worker Security Report

## Verdict

| Field | Value |
|-------|-------|
| **SW_PRESENT** | YES |
| **CACHE_API_USED** | YES |
| **CACHE_POISONING_RISK** | PASS |
| **TTL_DEFINED** | YES |
| **INVALIDATION_OK** | YES |
| **FIX_APPLIED** | NO (audit only) |

## Architecture (`sw.js`)

| Cache | Purpose |
|-------|---------|
| `APP_SHELL_CACHE` (`iu-app-{version}`) | CSS/JS shell — stale-while-revalidate |
| `DATA_CACHE` | JSON data with network-first |
| `DATA_META_CACHE` | TTL metadata per request |

## TTL

```javascript
articles: 300s, videos: 600s, weather: 1800s, namedays: 86400s, meta: 600s
MAX_STALE_MS for fallback by generatedAt
```

## Security Controls

1. **Same-origin only** — fetch handler scopes `url.origin === self.location.origin` for cache logic.
2. **No external HTML/JS caching** — cross-origin requests not intercepted for cache.put.
3. **Feed-critical passthrough** — `/projects/data/articles*.json`, `publishable_pool.json`, `videos.json` network-only with seed fallback (same-origin JSON only).
4. **HTML network-first** — `/projects/` document not preferentially cached.
5. **Activate wipes all caches** — `CACHE_VERSION` bump + full `caches.delete` on activate.
6. **Kill switch** — `?nosw=1` in `assets/app-crash-shield.js` unregisters SW (not in sw.js itself).

## Cache Poisoning Assessment

**PASS** — SW does not cache third-party responses; JSON cache validates content-type and `generatedAt` staleness before offline fallback.

## Recommendations (future)

- Document `CACHE_VERSION` bump policy in release checklist (operational, not code change).
- Monitor seed JSON fallback usage in telemetry (optional).
