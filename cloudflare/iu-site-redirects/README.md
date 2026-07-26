# InfoUzel site redirects (legacy `/projects/*`)

Cloudflare Worker that issues **HTTP 301** for public legacy paths under `/projects/*`
while **passthrough**-ing `/projects/data/*` and `/projects/version.json`.

Deploy: `.github/workflows/deploy-iu-site-redirects.yml`  
Manual Redirect Rules: `docs/ops/CLOUDFLARE_PROJECTS_301.md`
