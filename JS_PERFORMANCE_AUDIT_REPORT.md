# JS Performance Audit Report

## Scope

Audit only — **no refactor in Phase 1 PR**.

## Size Measurements (2026-06-09)

| File | Size (bytes) | Notes |
|------|-------------|-------|
| `assets/app.js` | ~3,126,360 | Monolith module |
| `assets/vendor/fontkit.umd.js` | ~1,506,282 | PDF/fonts lazy-loaded |
| `assets/vendor/html2pdf.bundle.min.js` | ~905,956 | Invoice/export lazy |
| `assets/vendor/mammoth.browser.min.js` | ~642,759 | DOCX lazy |
| `assets/app.css` | ~634,699 | Main stylesheet |
| `assets/vendor/pdf-lib.min.js` | ~525,099 | PDF lazy |
| `assets/vendor/jspdf.umd.min.js` | ~365,730 | PDF lazy |
| `assets/iu-info-center.js` | ~5,500 | Info Center V2.4 |
| `assets/iu-info-center.css` | ~12,000 | Info Center styles |
| `assets/iu-storage-notice.js` | ~1,800 | Phase 1 addition |

**Total JS (app + eager loads on index):** ~3.1 MB app.js dominates.

## Vendor Audit

- Heavy PDF/DOCX stack under `/assets/vendor/` — loaded on demand via `loadScript()` in finance/invoice paths.
- Leaflet bundled but weather maps use SVG path in current UI.

## Lazy-Load Potential (future PRs)

| Priority | Target | Risk | Benefit |
|----------|--------|------|---------|
| P1 | Split weather module from app.js | Medium | High |
| P1 | Split Silver engine / calendar | High | High |
| P2 | Dynamic import for invoice PDF stack | Low | Medium (already partial) |
| P2 | Route-level chunks (MindMenu, articles UI) | Medium | High |
| P3 | Dead code / unused vendor audit | Low | Medium |

## Unused JS

Full tree-shake analysis **NEEDS REVIEW** — requires coverage profiling (Playwright + Chrome coverage), not done in Phase 1.

## Recommendation

Dedicated performance PR after security baseline merge:

1. Establish `app.js` chunk boundaries without behavior change.
2. Measure LCP/TTI on mobile 3G with `?nosw=1` baseline.
3. Keep vendor lazy-load pattern; extend to Silver subsystems.

## Phase 1 Impact

+~2 KB (storage notice) — negligible vs app.js.
