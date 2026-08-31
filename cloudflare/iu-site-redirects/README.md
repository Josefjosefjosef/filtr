# InfoUzel site redirects (legacy `/projects/*`) + HTML CSP edge

Cloudflare Worker that:

1. Issues **HTTP 301** for public legacy paths under `/projects/*`
   while **passthrough**-ing `/projects/data/*` and `/projects/version.json`.
2. On HTML documents (`/`, `/statistiky*`, …), **promotes** the page’s meta
   `Content-Security-Policy` to a real **HTTP response header** (XSS-CSP-01/02),
   and adds HTTP-only `frame-ancestors 'self'`.

### Why not repo `_headers`?

Production is **GitHub Pages behind Cloudflare** (Fastly cache on origin).
GitHub Pages does **not** apply Netlify/CF-Pages-style `_headers`. That file
remains a sync target for CSP hash tooling / guards, but is **not** live HTTP CSP.

### Canonical CSP source

| Layer | Role |
|-------|------|
| `projects/index.html` meta CSP | **Canonical** policy (hashes via `iu-csp-apply-script-hashes`) |
| `_headers` | Mirror for guards / historical Pages headers format |
| Worker `csp-promote` | Derives HTTP CSP from meta at the edge (no second policy authoring) |

Early inline scripts may still appear **before** the meta tag in HTML; with the
HTTP header present, the browser enforces CSP **before** parser execution, so
the pre-meta window is **closed** without reordering vault/PWA boot scripts.

Deploy: `.github/workflows/deploy-iu-site-redirects.yml`  
Manual Redirect Rules: `docs/ops/CLOUDFLARE_PROJECTS_301.md`

