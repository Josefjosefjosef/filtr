# Security & Privacy Hardening — Phase 1 Closeout Report

**Date:** 2026-06-09  
**Production:** https://infouzel.cz/projects/  
**Merged PR:** #5033 (`499d567bd9d45b588b73ff74eb3f97b339f2f1ef`)  
**Closeout PR:** reports + Cloudflare header guide (this commit)

## Phase status

### **SECURITY_PRIVACY_PHASE1_INFRA_ACTION_REQUIRED**

Reason: HTTP security headers require **manual Cloudflare Transform Rules** (cannot be applied from repo on GitHub Pages + Cloudflare proxy stack). All other Phase 1 items are production-ready.

---

## Status table (12 bodů)

| Bod | Název | Stav | Poznámka |
|-----|-------|------|----------|
| 1 | STOP-SHIP | **PRODUCTION_READY** | False positive fixed; nightly PASS |
| 2 | CSP | **PRODUCTION_READY** | Meta CSP live; `connect-src` tightened |
| 3 | Font Awesome / SRI | **PRODUCTION_READY** | Self-hosted; no external FA CDN |
| 4 | Security headers | **NEEDS_INFRA_ACTION** | `_headers` not applied by GHPages; see `SECURITY_HEADERS_CLOUDFLARE_CLOSEOUT.md` |
| 5 | Service Worker | **PRODUCTION_READY** | Live proof without `nosw=1` PASS |
| 6 | Info Center | **PRODUCTION_READY** | Regression PASS (live + SW) |
| 7 | Provozovatel + kontakty | **PRODUCTION_READY** | `info@` in /projects/; bot admin@ out of scope |
| 8 | Storage notice | **PRODUCTION_READY** | Live + SW PASS |
| 9 | Retention policy | **PRODUCTION_READY** | In Info Center privacy section |
| 10 | GitHub Actions hardening | **PRODUCTION_READY** | Read-only on audit workflows |
| 11 | JS performance | **PRODUCTION_READY** | Audit only; no refactor in Phase 1 |
| 12 | NIS2 | **PRODUCTION_READY** | LIKELY_OUT_OF_SCOPE doc |

---

## Live production gates (2026-06-09)

| Gate | Value |
|------|-------|
| CSP_ACTIVE | **YES** |
| SECURITY_HEADERS_ACTIVE | **NO** (pending Cloudflare) |
| STORAGE_NOTICE_ACTIVE | **YES** |
| INFO_CENTER_REGRESSION | **PASS** |
| SW live (no nosw=1) | **PASS** |
| consoleErrors | **0** |
| appErrors | **0** |
| overflowX | **false** |
| CLS | **0.0017** |

---

## Remaining action (single owner task)

1. Apply Cloudflare **Transform Rules → Modify Response Header** per `SECURITY_HEADERS_CLOUDFLARE_CLOSEOUT.md`
2. Re-run header verification:
   ```text
   curl -sI https://infouzel.cz/projects/
   ```
3. When all four headers present → set Phase 1 to **SECURITY_PRIVACY_PHASE1_PRODUCTION_READY**

---

## Related reports

- `SECURITY_HEADERS_CLOUDFLARE_CLOSEOUT.md` — header deploy guide
- `SERVICE_WORKER_LIVE_PROOF_REPORT.md` — SW live proof
- `SECURITY_PRIVACY_HARDENING_PHASE1_REPORT.md` — original Phase 1 summary
- `SECURITY_STOP_SHIP_REVIEW.md`, `CSP_AUDIT_REPORT.md`, etc.

---

## Do not change in closeout

- No `assets/app.js` changes
- No RSS / articles pipeline changes
- No new Cloudflare Worker for full-site proxy
