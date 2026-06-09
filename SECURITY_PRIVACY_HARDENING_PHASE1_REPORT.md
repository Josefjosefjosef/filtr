# Security & Privacy Hardening — Phase 1 Summary Report

**Date:** 2026-06-09  
**Branch:** `chore/security-privacy-hardening-phase1`  
**Scope:** Audit + narrow safe fixes (no RSS/article/layout refactor)

## Executive Summary

Phase 1 dokončena: STOP-SHIP false positive opraven v audit skriptu, CSP částečně zpřísněna, security headers doplněny, technická storage lišta implementována, retention policy doplněna do Info Center, GitHub Actions read-only u audit workflow.

## Status Table

| Bod | Název | Stav | Fix proveden | Riziko | Další krok |
|-----|-------|------|--------------|--------|------------|
| 1 | STOP-SHIP | **FIXED** | Ano — `generate_security_governance_reports.py` allowlist | LOW | Monitor nightly CI PASS |
| 2 | CSP | **FIXED** (partial) | Ano — meta CSP tighten | LOW–MED | `CSP_TIGHTENING_PLAN.md` Phase 2 img-src |
| 3 | Font Awesome / SRI | **PASS** | Ne (already local) | LOW | Update proof scripts cdnjs note |
| 4 | Security headers | **FIXED** | Ano — `_headers` | LOW | COOP review optional PR |
| 5 | Service Worker | **PASS** | Ne (audit only) | LOW | Operational CACHE_VERSION policy |
| 6 | Info Center | **PASS** | Ne (verify + retention text) | LOW | Manual UI smoke post-deploy |
| 7 | Provozovatel + kontakty | **PASS** | Ne (already unified in /projects/) | LOW | Bot pages admin@ review |
| 8 | Storage notice | **FIXED** | Ano — lišta + JS/CSS | LOW | CLS check on mobile |
| 9 | Retention policy | **FIXED** | Ano — Info Center privacy | LOW | Legal review wording |
| 10 | GitHub Actions | **FIXED** (partial) | Ano — 2 workflows read-only | LOW | Org default permissions |
| 11 | JS performance | **PASS** (audit) | Ne | N/A | Dedicated perf PR |
| 12 | NIS2 | **LIKELY_OUT_OF_SCOPE** | Ne (document only) | N/A | Legal review if scope grows |

## Code Changes (vs reports-only)

| File | Change |
|------|--------|
| `scripts/generate_security_governance_reports.py` | STOP-SHIP false positive fix + FA narrative |
| `_headers` | Security headers |
| `projects/index.html` | CSP, storage bar, retention text, asset links |
| `assets/iu-storage-notice.js` | New |
| `assets/iu-storage-notice.css` | New |
| `.github/workflows/nightly-health-report.yml` | `permissions: contents: read` |
| `.github/workflows/pr-health-report-audit.yml` | `permissions: contents: read` |

## Reports Generated (this phase)

- `SECURITY_STOP_SHIP_REVIEW.md`
- `CSP_AUDIT_REPORT.md`
- `CSP_TIGHTENING_PLAN.md`
- `THIRD_PARTY_ASSET_REVIEW.md`
- `SECURITY_HEADERS_REPORT.md`
- `SERVICE_WORKER_SECURITY_REPORT.md`
- `INFO_CENTER_REGRESSION_REPORT.md`
- `PUBLIC_CONTACTS_REPORT.md`
- `STORAGE_NOTICE_REPORT.md`
- `RETENTION_POLICY_REPORT.md`
- `GITHUB_ACTIONS_HARDENING_REPORT.md`
- `JS_PERFORMANCE_AUDIT_REPORT.md`
- `NIS2_SCOPE_REVIEW.md`

## Proof Status

| Gate | Status |
|------|--------|
| Security governance selftest | PASS |
| Regenerated security report | PASS (STOP-SHIP=0) |
| Python compile | PASS |
| Full layout-guard / smoke CI | Pending PR CI |

## Risks

1. **CSP connect-src** — only Open-Meteo; new fetch APIs need CSP update.
2. **img-src https:** wildcard remains for RSS images.
3. **Storage bar** — verify no overlap with bottom nav on real devices.

## Recommendation

**SECURITY_PRIVACY_PHASE1_READY_FOR_PR** — scope is reviewable in single PR; no STOP-SHIP blocker.
