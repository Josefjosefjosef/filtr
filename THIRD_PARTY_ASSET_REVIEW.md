# Third-Party Asset Review — Font Awesome / SRI

## Verdict

| Field | Value |
|-------|-------|
| **FONT_AWESOME_EXTERNAL** | NO (production `/projects/`) |
| **MOVED_LOCAL** | N/A (already removed) |
| **SRI_ADDED** | NO (not needed) |
| **THIRD_PARTY_ASSET_RISK** | PASS |

## Scan Results

| Location | Font Awesome / external icon CDN |
|----------|----------------------------------|
| `projects/index.html` | **Not found** — inline SVG / emoji icons in Info Center |
| `assets/app.css` / `assets/app.js` | Self-hosted assets only |
| `assets/iu-external-origins.js` | `use.fontawesome.com` marked `active: false` |
| `scripts/*proof*.mjs` | pdf.js from cdnjs — **dev/proof only**, not production UI |
| `scripts/generate_security_governance_reports.py` | **FIXED** stale FA narrative |

## Production Scripts (index.html)

All `<script src>` point to `/assets/…` — no external CDN.

## Vendor Bundle

`/assets/vendor/*` — self-hosted (pdf-lib, leaflet, jspdf, mammoth, html2pdf, fontkit).

## Recommendation

- PASS for production.
- Proof scripts using cdnjs: acceptable out-of-band; no SRI required for CI-only HTML fixtures.
