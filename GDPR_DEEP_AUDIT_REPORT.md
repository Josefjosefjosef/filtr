# GDPR Deep Audit Report — infoUzel.cz

**Generated:** 2026-06-12  
**Branch:** `chore/product-health-baseline-snapshot`  
**Commit:** `e0552a9c27cc42e24b94d059d4e9ec6e841c9d94`  
**Git clean before audit:** YES  

## Executive summary

Nightly compliance reports (`scripts/generate_security_governance_reports.py`) emit `UNKNOWN` for legal basis, consent, export, and delete because the generator uses **static placeholders** and does not parse Info Center / consent runtime. A manual repo audit shows **substantial in-product privacy documentation and a working consent layer**, but **formal GDPR evidence packs, processor registry, incident process, legal review, and bulk user-data export remain gaps**.

**Overall status:** PARTIAL  
**Overall risk level:** MEDIUM  

---

## Baseline verify (KROK 1)

| Field | Value |
|-------|-------|
| CURRENT_BRANCH | `chore/product-health-baseline-snapshot` |
| CURRENT_COMMIT | `e0552a9c27cc42e24b94d059d4e9ec6e841c9d94` |
| GIT_CLEAN_BEFORE | YES |

---

## File inventory (KROK 2)

### GDPR_FILES_FOUND

- `INFO_CENTER_LEGAL_REVIEW.md`
- `RETENTION_POLICY_REPORT.md`
- `STORAGE_NOTICE_REPORT.md`
- `NIS2_SCOPE_REVIEW.md`
- `PUBLIC_CONTACTS_REPORT.md`
- `SECURITY_HEADERS_REPORT.md`
- `SECURITY_PRIVACY_HARDENING_PHASE1_REPORT.md`
- `SECURITY_STOP_SHIP_REVIEW.md`
- `SERVICE_WORKER_SECURITY_REPORT.md`
- `scripts/generate_security_governance_reports.py` (nightly compliance/data governance generator)
- `scripts/generate_ultra_audit_wiki.py` (ultra audit wiki generator)
- `scripts/silver-help-privacy-storage-governance-guard-v1.cjs`
- Privacy-related guard scripts under `scripts/silver-mobile-tablet-*-privacy-*`

### LEGAL_FILES_FOUND

- `INFO_CENTER_LEGAL_REVIEW.md`
- `assets/iu-legal-documents-module.js`
- `assets/iu-legal-documents-overlay.css`
- `assets/iu-legal-documents-registry.js`
- `assets/iu-legal-documents-schema.js`
- `tools/fix_sources_legal_mode.py`
- Info Center legal sections in `projects/index.html` (Provozovatel, Ochrana soukromí, Cookies, Nastavení soukromí)

### STORAGE_FILES_FOUND

- `assets/iu-storage-notice.js` / `assets/iu-storage-notice.css` (**assets exist; not mounted in current `projects/index.html`**)
- `STORAGE_NOTICE_REPORT.md`
- `sw.js` (Cache API + TTL)
- `assets/iu-consent.js` (consent localStorage keys)
- `assets/app-crash-shield.js` (diagnostic localStorage)
- Info Center Cookies section (`projects/index.html`)

### CONSENT_FILES_FOUND

- `assets/iu-consent.js`
- `assets/iu-consent-layer.js`
- `assets/iu-consent-layer.css`
- Consent markup `#iuConsentLayer` in `projects/index.html`
- Privacy settings UI wired in `assets/iu-info-center.js`

### RETENTION_FILES_FOUND

- `RETENTION_POLICY_REPORT.md`
- Retention subsection in Info Center privacy (`projects/index.html`)
- `sw.js` TTL constants (`articles: 300s`, `videos: 600s`, `weather: 1800s`, etc.)
- `.github/workflows/nightly-health-report.yml` (report artifact retention)

### PROCESSOR_FILES_FOUND

- External providers listed in Info Center §6 (`projects/index.html`)
- `INFO_CENTER_LEGAL_REVIEW.md` EXTERNAL_SERVICES_LIST
- **No dedicated `PROCESSORS.md` / subprocessor registry / DPA index in repo**

---

## KROK 3 — Legal basis audit

| Field | Value |
|-------|-------|
| LEGAL_BASIS_DOCUMENTED | **PARTIAL** |
| LEGAL_BASIS_RISK_LEVEL | **MEDIUM** |

### Evidence

- Info Center **Ochrana soukromí a data** documents data categories, storage locations, retention, user rights, external providers (`projects/index.html` §privacy).
- Info Center **Cookies** documents essential vs optional analytics (`projects/index.html` §cookies).
- **Analytics only** has explicit legal-basis text: „Právní základ: váš souhlas“ (privacy-settings section).
- Operator identity documented: Media Uzel s.r.o., IČ, contact `info@infouzel.cz` (Info Center contact).

### LEGAL_BASIS_GAPS

1. **No Art. 6 matrix** mapping each data category → legal basis (legitimate interest / contract / consent / legal obligation) — **requires legal review**.
2. Essential technical storage described functionally but **not tied to a named legal basis** per category (UI prefs, Silver notes, weather coords, RSS aggregation).
3. YouTube / Open-Meteo / parcel tracking **third-party legal basis** not documented beyond disclosure list.
4. Nightly `compliance_status_report` hardcodes `legal_basis: UNKNOWN` — **audit tooling gap**, not proof of absence.
5. `INFO_CENTER_LEGAL_REVIEW.md` states **finální review advokátem/DPO neprovedeno**.

### EVIDENCE_FILES

- `projects/index.html` (Info Center privacy, cookies, privacy-settings, contact)
- `INFO_CENTER_LEGAL_REVIEW.md`
- `RETENTION_POLICY_REPORT.md`
- `scripts/generate_security_governance_reports.py` (lines 426–427: static UNKNOWN)

---

## KROK 4 — Consent mechanism audit

| Field | Value |
|-------|-------|
| CONSENT_IMPLEMENTED | **PARTIAL** (runtime YES for analytics gate; storage notice orphaned) |
| CONSENT_DEFAULT_ANALYTICS_OFF | **YES** |
| CONSENT_CAN_REJECT | **YES** |
| CONSENT_CAN_CHANGE | **YES** |
| CONSENT_STORAGE_KEY | `iu:consent:analytics:v1`, `iu:consent:layer:dismissed:v1`, `iu:consent:analytics:ts:v1`, `iu:consent:analytics:version:v1` |
| CONSENT_UI_FILES | `assets/iu-consent.js`, `assets/iu-consent-layer.js`, `assets/iu-consent-layer.css`, `assets/iu-info-center.js`, `#iuConsentLayer` in `projects/index.html` |
| CONSENT_RISK_LEVEL | **LOW–MEDIUM** |

### Verification checklist

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Consent banner mounts | **YES** | `#iuConsentLayer` in HTML; `iu-consent-layer.js` boot on DOMContentLoaded |
| 2 | Choices: stats / essential / settings | **YES** | Buttons `#iuConsentAllowStats`, `#iuConsentEssentialOnly`, `#iuConsentSettings` |
| 3 | Analytics default off | **YES** | `iuAnalyticsInit()` stub; no gtag/Plausible; `getAnalyticsConsent()` null until choice |
| 4 | Not cosmetic only | **YES** | `setAnalyticsConsent` persists + dispatches `iu:consent-change`; settings panel syncs |
| 5 | Consent stored | **YES** | localStorage keys in `iu-consent.js` |
| 6 | Choice changeable | **YES** | Info Center privacy-settings + save button |
| 7 | Reject as easy as accept | **YES** | Equal-weight buttons; „Pouze nezbytné“ = denied |
| 8 | Essential vs optional separated | **YES** | UI cards in privacy-settings; analytics gated separately |
| 9 | YouTube/embeds gated by consent | **NO / N/A** | YouTube loads on user action; not blocked by analytics consent (disclosed as third-party) |
| 10 | Storage matches policy | **PARTIAL** | Consent keys match docs; **`iu-storage-notice` not loaded in index.html** despite report claiming FIXED |

### CONSENT_GAPS

- `STORAGE_NOTICE_REPORT.md` claims `#iuStorageNotice` in `projects/index.html` — **not found in current tree** (orphaned JS/CSS).
- Analytics is **future stub** — consent infrastructure ready but no live analytics vendor yet.
- Nightly report still says `consent_implemented: UNKNOWN` (generator limitation).

---

## KROK 5 — Export audit

| Field | Value |
|-------|-------|
| EXPORT_IMPLEMENTED | **PARTIAL** |
| EXPORT_SCOPE | Per-document PDF export (invoices); no unified JSON backup of local user data |
| EXPORT_MISSING_FOR | Notes, tasks, calendar (bulk), preferences, parcels list, invoice form state, legal doc drafts, MindMenu clipboards |
| EXPORT_RISK_LEVEL | **MEDIUM** |
| EVIDENCE_FILES | `assets/iu-invoice-module.js` (PDF download/share); `RETENTION_POLICY_REPORT.md` („No automated data export feature"); Info Center recommends external backup |

---

## KROK 6 — Delete audit

| Field | Value |
|-------|-------|
| DELETE_IMPLEMENTED | **PARTIAL** |
| DELETE_SCOPE | Per-item delete in tasks, calendar events, notes (inline), parcels, health/bakalari profiles; browser-level clear documented; consent revoke |
| DELETE_MISSING_FOR | Unified „smazat všechna moje lokální data"; user-facing SW cache wipe; bulk delete invoices/legal docs/MindMenu |
| DELETE_CACHE_HANDLED | **PARTIAL** — automatic on build change in `app.js`; not exposed as user GDPR control |
| DELETE_RISK_LEVEL | **MEDIUM** |
| EVIDENCE_FILES | `assets/app.js` (`deleteTask`, `deleteCurrentEvent`, `deleteInlineEditor`); `assets/iu-silver-parcel-dashboard.js` (`removeParcelFromList`); Info Center §4 delete instructions |

---

## KROK 7 — Retention policy audit

| Field | Value |
|-------|-------|
| RETENTION_POLICY_DOCUMENTED | **PARTIAL** |
| RETENTION_TECHNICAL_TTL_FOUND | **YES** |
| RETENTION_USER_DATA_FOUND | **PARTIAL** |
| RETENTION_CI_LOGS_FOUND | **PARTIAL** |
| RETENTION_RISK_LEVEL | **MEDIUM** |

### Coverage

| Layer | Status | Evidence |
|-------|--------|----------|
| SW cache TTL | YES | `sw.js` TTL + MAX_STALE_MS |
| User local data | PARTIAL | „until user deletes" in Info Center; no fixed calendar |
| RSS/articles | PARTIAL | Pipeline cadence in workflows; SW TTL 300s articles |
| CI artifacts/reports | PARTIAL | GitHub Actions defaults; nightly uploads to `reports/` |

### RETENTION_GAPS

- No standalone retention schedule document outside Info Center HTML.
- CI/report artifact retention periods not formally documented.
- `data_governance_report.txt` generator still says „full policy UNKNOWN".

### EVIDENCE_FILES

- `RETENTION_POLICY_REPORT.md`, `sw.js`, Info Center privacy retention subsection, `.github/workflows/nightly-health-report.yml`

---

## KROK 8 — Processors / third parties

| Field | Value |
|-------|-------|
| THIRD_PARTY_MAP_CREATED | **YES** (informal, in Info Center + legal review) |
| PROCESSOR_LIST_EXISTS | **PARTIAL** |
| SUBPROCESSOR_GAPS | No formal registry; no DPA references; GitHub/Cloudflare not in user-facing processor list |
| THIRD_PARTY_RISK_LEVEL | **MEDIUM** |

### Third-party map (minimum set)

| Party | Role | Documented |
|-------|------|------------|
| GitHub Pages | Static hosting | Implicit only |
| GitHub Actions | CI, data pipeline | Workflows only |
| Cloudflare Workers | VIN worker, articles-watchdog | `cloudflare/` — not in Info Center list |
| YouTube / Google | Video embeds | YES — Info Center |
| Open-Meteo | Weather API | YES — Info Center |
| Font Awesome CDN | Styles | Removed from production UI per security report; stale mention in data_governance generator |
| RSS publishers | Article aggregation | YES — Info Center + ultra audit wiki |
| Parcel carriers | Tracking APIs | YES — Info Center |
| Map / AI link-outs | External on click | YES — Info Center |

---

## KROK 9 — NIS2 / incident / security contact

| Field | Value |
|-------|-------|
| NIS2_SCOPE_DOCUMENTED | **PARTIAL** |
| INCIDENT_PROCESS_DOCUMENTED | **NO** |
| SECURITY_CONTACT_DOCUMENTED | **PARTIAL** |
| BREACH_PROCESS_DOCUMENTED | **NO** |
| RISK_LEVEL | **MEDIUM** |

### Evidence

- `NIS2_SCOPE_REVIEW.md` — LIKELY_OUT_OF_SCOPE, NEEDS_LEGAL_REVIEW
- `PUBLIC_CONTACTS_REPORT.md` — `info@infouzel.cz` in public UI
- `SECURITY_HEADERS_REPORT.md`, `SECURITY_PRIVACY_HARDENING_PHASE1_REPORT.md`, `SECURITY_STOP_SHIP_REVIEW.md` — technical measures
- **No** `INCIDENT_RESPONSE.md`, breach notification playbook, or DPIA/LIA assessment

---

## KROK 10 — GDPR gap matrix

| AREA | STATUS | RISK | EVIDENCE | GAP | RECOMMENDED ACTION |
|------|--------|------|----------|-----|-------------------|
| 1. Legal identity | YES | LOW | Info Center contact | Bot pages use `admin@` | Unify bot contact (separate PR) |
| 2. Privacy policy | PARTIAL | MEDIUM | Info Center privacy section | Not standalone legal page; no counsel sign-off | PR-1: doc pack + legal review |
| 3. Legal basis | PARTIAL | MEDIUM | Analytics consent basis only | No per-category Art. 6 matrix | PR-1: LEGAL_BASIS_MATRIX.md (requires legal review) |
| 4. Consent layer | PARTIAL | LOW | `iu-consent*.js`, HTML banner | Nightly UNKNOWN; analytics stub only | PR-2 only if mount broken — **not needed now** |
| 5. Cookie/storage notice | PARTIAL | MEDIUM | Orphan `iu-storage-notice.*` | Not mounted in index.html | PR-2: remount or remove dead assets |
| 6. localStorage/sessionStorage inventory | PARTIAL | LOW | Info Center cookies list | No machine-readable inventory | PR-1: STORAGE_INVENTORY.md from scan |
| 7. Service Worker cache | PARTIAL | LOW | `sw.js`, Info Center | User cannot manually purge via UI | Document browser clear path (PR-1) |
| 8. User data export | PARTIAL | MEDIUM | Invoice PDF only | No bulk export | PR-3 if product scope approved |
| 9. User data delete | PARTIAL | MEDIUM | Per-module delete + browser | No unified wipe | PR-3 optional enhancement |
| 10. Retention policy | PARTIAL | MEDIUM | Info Center + RETENTION_POLICY_REPORT | No formal standalone policy | PR-1 documentation |
| 11. Processor/subprocessor list | PARTIAL | MEDIUM | Info Center §6 | No DPA registry | PR-1 PROCESSORS_REGISTRY.md |
| 12. Third-party embeds | PARTIAL | LOW | CSP, Info Center | YouTube not consent-gated | Disclose only unless counsel requires gate |
| 13. RSS/article data governance | PARTIAL | LOW | Workflows, ultra audit wiki | ToS compliance UNKNOWN | PR-1 note + legal review |
| 14. Analytics default OFF | YES | LOW | `iu-consent.js` stub | Future vendor not chosen | Keep default OFF when enabling |
| 15. Incident response | NO | MEDIUM | NIS2 review mentions gap | No IR playbook | PR-4 |
| 16. NIS2 scope | PARTIAL | LOW | NIS2_SCOPE_REVIEW.md | Needs legal confirmation | PR-4 |
| 17. Security contact | PARTIAL | LOW | info@infouzel.cz | No dedicated security@ | PR-4 optional alias doc |
| 18. User rights process | PARTIAL | MEDIUM | Info Center §5 | Email-only; no export SLA | PR-1 process doc |
| 19. DPIA/LIA need assessment | NO | MEDIUM | — | Not documented | PR-1 assessment template |
| 20. Production legal review needed | YES | HIGH | INFO_CENTER_LEGAL_REVIEW | Counsel not engaged | **requires legal review** before production GDPR claims |

**Gap counts:** critical 1 · medium 12 · low 7  

---

## KROK 11 — Nightly report vs repo reality

| Nightly field | Report value | Repo audit value | Root cause |
|---------------|--------------|------------------|------------|
| legal_basis | UNKNOWN | PARTIAL | Static string in `generate_security_governance_reports.py` |
| consent_implemented | UNKNOWN | YES (analytics layer) | Generator does not parse HTML/JS |
| export | UNKNOWN | PARTIAL | Generator does not scan app features |
| delete | UNKNOWN | PARTIAL | Generator does not scan app features |
| retention | PARTIAL | PARTIAL | Accurate at high level |
| processors | (gaps noted) | PARTIAL | Info Center list exists; no formal registry |

**Action:** Update nightly generator in a **separate CI PR** to grep Info Center + consent files (documentation/audit improvement, not product change).

---

## KROK 12 — Recommended PRs

### PR-1: GDPR evidence / documentation only (**recommended next**)

| | |
|--|--|
| **Scope** | Add `docs/governance/LEGAL_BASIS_MATRIX.md`, `PROCESSORS_REGISTRY.md`, `RETENTION_POLICY.md`, `USER_RIGHTS_PROCESS.md`, `DPIA_LIA_SCREENING.md` — all marked **requires legal review** |
| **Risk** | LOW (docs only) |
| **Files likely changed** | New `docs/governance/*`, optional README index, `INFO_CENTER_LEGAL_REVIEW.md` pointer |
| **Expected gates** | smoke PASS; no layout change |
| **NO-GO** | No `assets/app.js`, no CSS, no analytics enablement, no legal assertions without review flag |

### PR-2: Consent runtime verification

| | |
|--|--|
| **Scope** | Only if consent broken — **audit finds consent layer OK**; optional: remount `#iuStorageNotice` or delete orphaned assets |
| **Risk** | LOW–MEDIUM |
| **Files likely changed** | `projects/index.html`, `assets/iu-storage-notice.*` |
| **Expected gates** | smoke, layout-guard workflow |
| **NO-GO** | No analytics default ON; no app.js unless mount bug proven |

### PR-3: Export / delete local data

| | |
|--|--|
| **Scope** | Bulk JSON export + „Smazat všechna lokální data" control in Info Center — **only after product/legal approval** |
| **Risk** | MEDIUM (user data handling UX) |
| **Files likely changed** | New `assets/iu-privacy-data-controls.js`, Info Center section, minimal `iu-info-center.js` wiring |
| **Expected gates** | smoke, silver privacy guards, manual GDPR UX proof |
| **NO-GO** | No server-side storage; no silent delete |

### PR-4: Incident / NIS2 governance docs

| | |
|--|--|
| **Scope** | `docs/governance/INCIDENT_RESPONSE.md`, `BREACH_NOTIFICATION.md`, security contact procedure |
| **Risk** | LOW |
| **Files likely changed** | `docs/governance/*`, cross-link from `NIS2_SCOPE_REVIEW.md` |
| **Expected gates** | repo-guard (markdown only) |
| **NO-GO** | No workflow secrets; no false NIS2 compliance claims |

---

## KROK 13 — Gates

| Gate | Result |
|------|--------|
| SMOKE | **PASS** (`npm run smoke` → `SMOKE PASS`) |
| LAYOUT_GUARD | **SKIP_WITH_REASON** — no `npm run layout-guard` script; CI workflow `.github/workflows/layout-guard.yml` runs `node scripts/check_layout.js` + silver guards |
| REPO_GUARD | **SKIP_WITH_REASON** — no `npm run repo-guard` script; CI workflow `.github/workflows/repo-guard.yml` runs Python compile + data guards |
| JSON_REPORT_VALID | **YES** (`JSON_OK`) |
| GIT_CLEAN_AFTER | **NO** (2 new audit report files) |

---

## Disclaimer

This audit is a **technical and documentary gap analysis**. It does **not** constitute legal advice and does **not** certify GDPR compliance. Production assertions require **requires legal review** by qualified counsel/DPO.
