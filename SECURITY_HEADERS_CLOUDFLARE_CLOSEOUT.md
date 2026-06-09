# Security Headers — Cloudflare Closeout (Phase 1)

**Date:** 2026-06-09  
**Production:** https://infouzel.cz/projects/  
**Main after PR #5033:** `499d567bd9d45b588b73ff74eb3f97b339f2f1ef`

## CURRENT_PROD_HEADERS (live probe)

HTTP response headers on `GET https://infouzel.cz/projects/` (2026-06-09):

| Header | Value |
|--------|-------|
| X-Content-Type-Options | **(missing)** |
| Referrer-Policy | **(missing)** |
| Permissions-Policy | **(missing)** |
| X-Frame-Options | **(missing)** |
| Content-Security-Policy | **(missing at HTTP layer)** — CSP active via `<meta>` in HTML |
| Strict-Transport-Security | present (Cloudflare) |
| Server | cloudflare |

## REQUIRED_HEADERS

| Header | Required value |
|--------|----------------|
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), payment=(), geolocation=(self)` |
| X-Frame-Options | `SAMEORIGIN` |

## WHY_HEADERS_MISSING

1. **`_headers` in repo** uses Netlify/Cloudflare Pages syntax. **GitHub Pages does not apply this file** to HTTP responses.
2. **Site stack:** GitHub Pages origin → Cloudflare proxy (custom domain `infouzel.cz` via `CNAME`).
3. **Existing Cloudflare Workers in repo** are **not** front-end proxies:
   - `cloudflare/vin-worker/` — VIN API only
   - `cloudflare/articles-watchdog/` — cron / GitHub Actions trigger only
4. No wrangler config routes `infouzel.cz/projects/*` through a Worker.

**Conclusion:** Repo `_headers` documents intent but **cannot activate HTTP headers on current stack without Cloudflare dashboard rules or a new edge Worker (not recommended — broad scope).**

## DEPLOYMENT_OPTION

| Option | Repo change? | Risk | Recommended |
|--------|--------------|------|-------------|
| A. Cloudflare **Transform Rules → Modify response header** | No | Low | **YES** |
| B. Cloudflare **Configuration Rules** (legacy Page Rules) | No | Low–Med | Alternative |
| C. New Cloudflare Worker proxying entire site | Yes (large) | **High** | **NO** |
| D. GitHub Pages native headers | N/A | N/A | **Not supported** |
| E. Keep meta CSP only | No | Med (partial) | Interim only |

## RECOMMENDED_OPTION

**Option A — Cloudflare Dashboard Transform Rules** (manual infra step by account owner).

Scope: start with `/projects/*`, expand to `/*` after smoke if no regression on other paths (e.g. `/bot/`).

### Step-by-step (Cloudflare Dashboard)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) → zone **infouzel.cz**.
2. **Rules** → **Transform Rules** → **Modify Response Header** → **Create rule**.
3. **Rule name:** `InfoUzel security headers — projects`
4. **When incoming requests match…**
   - Field: **URI Path**
   - Operator: **starts with**
   - Value: `/projects`
   - *(Optional second rule later for `/*` if needed)*
5. **Then…** — **Set static** (add each header):

   | Header name | Value |
   |-------------|-------|
   | `X-Content-Type-Options` | `nosniff` |
   | `Referrer-Policy` | `strict-origin-when-cross-origin` |
   | `Permissions-Policy` | `camera=(), microphone=(), payment=(), geolocation=(self)` |
   | `X-Frame-Options` | `SAMEORIGIN` |

6. **Deploy** / Save rule.
7. **Purge cache** (Caching → Configuration → Purge Everything) or purge `/projects/*` only.
8. Verify with:
   ```bash
   curl -sI "https://infouzel.cz/projects/" | grep -iE "x-content-type|referrer|permissions|x-frame"
   ```

### Optional second rule (whole site)

If `/bot/` or root paths need same headers:

- Duplicate rule with URI Path **starts with** `/` or use custom filter: `(http.request.uri.path starts_with "/projects") or (http.request.uri.path eq "/")`
- **Before global `/*`:** confirm `/bot/` and any API subpaths tolerate `X-Frame-Options: SAMEORIGIN` (they should — prevents embedding InfoUzel in third-party iframes, not outbound YouTube).

### Why these values are safe

| Concern | Assessment |
|---------|------------|
| YouTube embed | Uses **child iframe**; parent `X-Frame-Options: SAMEORIGIN` does not block outbound embeds |
| Maps / external links | Navigation — not blocked by response headers |
| PWA / SW | Unaffected |
| Web Share API | Not blocked by Permissions-Policy as configured |
| Weather GPS | `geolocation=(self)` allows same-origin geolocation prompt |

## RISK

| Risk | Level | Mitigation |
|------|-------|------------|
| Wrong rule scope breaks subdomain | Low | Start `/projects` only |
| Duplicate headers if multiple rules | Low | One rule set per path |
| `_headers` drift vs Cloudflare | Med | Document dashboard as source of truth; keep `_headers` as reference |
| New Worker proxy | **High** | Do not implement in Phase 1 |

## REPO ACTION TAKEN

- **No runtime code change** — headers cannot be safely applied from repo on GHPages+Cloudflare without new edge proxy.
- `_headers` retained as documentation / future migration reference.
- Manual Cloudflare step **required** to set `SECURITY_HEADERS_ACTIVE = YES`.

## VERIFICATION CHECKLIST (after Cloudflare apply)

- [ ] `curl -sI https://infouzel.cz/projects/` shows all four headers
- [ ] Homepage loads, Info Center, storage notice, Silver
- [ ] YouTube video modal plays
- [ ] Weather / GPS prompt still works on user action
- [ ] No new console CSP violations
