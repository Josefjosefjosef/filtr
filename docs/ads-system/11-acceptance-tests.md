# Acceptance tests catalog (kap. 45)

Každý test má být dohledatelný z `01-traceability-matrix.json`.

## Etapa 0 (povinné teď)

| ID | Test | Gate |
|----|------|------|
| E0-T1 | Unit: feature flags default fail-closed | `npm test` in `cloudflare/iu-ads` |
| E0-T2 | Unit: public response strip forbidden keys | vitest |
| E0-T3 | Unit: schema isolation — no `daily_traffic` in ads SQL | vitest / guard |
| E0-T4 | Docs matrix obsahuje kapitoly 1–48 + goal | JSON parse |
| E0-T5 | PR #7617 OID nezměněn reklamním PR | gh pr view |
| E0-T6 | stash@{0} zachován | git stash list |

## Etapa 2 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E2-T1 | Unit: PBKDF2+pepper hash/verify round-trip, wrong password/pepper rejected | `test/auth-crypto.test.ts` |
| E2-T2 | Unit: server-side password strength policy | `test/auth-crypto.test.ts` |
| E2-T3 | Unit: HMAC session token sign/verify, expiry, bad signature, tamper rejection | `test/session.test.ts` |
| E2-T4 | Unit: session cookie is HttpOnly+Secure+SameSite=Strict; logout cookie Max-Age=0 | `test/session.test.ts` |
| E2-T5 | Unit: brute-force lockout after N consecutive failures, auto-unlock after window, reset on success | `test/bruteforce.test.ts` |
| E2-T6 | Unit: RBAC hardcoded map matches `07-roles-permissions.md` (main_admin full, ads_manager/sales scoped, read_only read-only, unknown role denied) | `test/rbac.test.ts` |
| E2-T7 | Unit: audit redaction strips password/token/session/code_hash from before/after JSON | `test/audit.test.ts` |
| E2-T8 | Admin API gate: `ADS_ADMIN_API_ENABLED=false` → `503`; secrets missing → `503 auth_not_configured`; safeMode alone never blocks admin routes | manual/health + `index.ts` review |

## Etapa 3 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E3-T1 | Unit: document visibility values + `filterDocumentForVisibility` hides `internal_only` from client/public scope, fails closed on unknown value | `test/visibility.test.ts` |
| E3-T2 | Unit: `buildSignedDocumentAccess` always returns a short-lived `/v1/objects/get` path (never a raw/public R2 URL), signature verifies, TTL clamped to `MAX_SIGNED_URL_TTL_SECONDS` | `test/visibility.test.ts` |
| E3-T3 | Unit: document upload validation accepts PDF, rejects HTML/JS-disguised content and oversized files; `contentHashHex`/`extForMime` helpers | `test/documents.test.ts` |
| E3-T4 | Integration (fake D1+R2): admin-documents upload + `/access` — `public` visibility document still only returns a signed path; `object_access_audit` row written; non-`documents.write` role gets 403 | `test/documents.test.ts` |
| E3-T5 | Integration (fake D1): inquiry→order conversion creates a `draft` order, marks inquiry `converted`, rejects double-convert (409) and missing-client (400); requires both `inquiries.write` and `orders.write` (403 for `ads_manager`); 401 without session | `test/business-crud.test.ts` |
| E3-T6 | Unit: RBAC Etapa 3 extension — `sales` gets `invoices.write` + documents/complaints/exports/finance.read; `ads_manager` gets `rights.*`; `read_only` gets all new `*.read`; `main_admin` unaffected (already `ALL_PERMISSIONS`) | `test/rbac.test.ts` |
| E3-T7 | Admin API gate unchanged: all Etapa 3 routes still behind `ADS_ADMIN_API_ENABLED` + session + RBAC via `requireAdminPermission` (index.ts review) | manual/index.ts review |

## Etapa 4 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E4-T1 | Unit: campaign status state machine — full happy path draft→...→active, cancel from any non-terminal state, ended/cancelled only reach `archived`, invalid skips rejected | `test/campaign-state.test.ts` |
| E4-T2 | Unit: `requiresActivatePermission` true only for approved/scheduled/active; `requiresRightsConfirmation` true only for active | `test/campaign-state.test.ts` |
| E4-T3 | Unit: exclusive-mode reservation overlap detected (scoped by placement/device/section/region); shared-mode never collides; cancelled reservations ignored | `test/collision.test.ts` |
| E4-T4 | Unit: target URL allowlist rejects `javascript:`/`data:`/`vbscript:`/`file:`/protocol-relative/other schemes; accepts http(s) + root-relative paths; rejects CRLF injection | `test/url-safety.test.ts` |
| E4-T5 | Integration (fake D1): campaign creation + full transition pipeline; entering `active` blocked with `409 rights_confirmation_required` until a `rights_confirmations` row exists, then succeeds; invalid transition → `409`; `sales` denied (403, no `campaigns.write`); `read_only` denied; no session → `401`; unsafe `target_url` rejected at creation | `test/campaigns.test.ts` |
| E4-T6 | Integration (fake D1): reservation collision → `409 reservation_collision` on exclusive overlap; free window succeeds; shared-mode placement allows overlap; `read_only` denied; inverted window rejected | `test/reservations.test.ts` |
| E4-T7 | Unit + integration: creative MIME/magic-byte validation (accepts PNG, rejects SVG/oversized/disguised-HTML); upload never leaks `r2_key`; approve/reject only from `pending` (`409 already_reviewed` otherwise); `read_only` denied upload; `/access` returns a short-lived signed path, never a permanent R2 URL, and records `object_access_audit` | `test/creatives.test.ts` |
| E4-T8 | Integration (fake D1): preview returns `published:false` and a signed (never permanent) creative path; performs **zero** side-effect DB writes (excluding the shared session `last_seen_at` touch); 404 for unknown campaign without any write; works with no approved creative yet | `test/preview.test.ts` |

## Etapa 5 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E5-T1 | Unit: `shouldAutoActivate`/`shouldAutoEnd` pure predicates — scheduled→active only once `start_at<=now`, active→ended only once `end_at<=now`, no-op otherwise | `test/scheduler.test.ts` |
| E5-T2 | Integration (fake D1): `runAutoScheduler` auto-activates a `scheduled` campaign with a `rights_confirmations` row, writes `campaign_status_events`+`audit_logs`; **never** auto-activates one missing the rights confirmation (fail-closed, kap. 30); auto-ends an `active` campaign past `end_at`; ignores draft/paused/cancelled/archived | `test/scheduler.test.ts` |
| E5-T3 | Unit+integration: `selectPublicAds` fail-closed — `[]` with no `DB`, no `ADS_R2_SIGNING_SECRET`, `EMERGENCY_PAUSE_ALL=true`, or if that setting can't be read | `test/delivery-engine.test.ts` |
| E5-T4 | Integration (fake D1): delivered ad passes `assertNoForbiddenPublicKeys`/`sanitizePublicAds` (allowlist shape only); `creative.cdn_url` is a signed `/v1/objects/get` Worker path, never `r2.cloudflarestorage.com` | `test/delivery-engine.test.ts` |
| E5-T5 | Integration (fake D1): unapproved (`pending`/`rejected`) creatives are never delivered; wrong `device_category` filtered out; `section_id=null` (global) placements match any requested section, section-scoped placements only match on exact `section`; non-`active` campaign/placement excluded; `start_at`/`end_at` window re-checked in application code | `test/delivery-engine.test.ts` |
| E5-T6 | Integration (fake D1): `exclusive` `collision_mode` keeps only the lowest-`priority` candidate per placement/device/section; `shared` mode serves every eligible match | `test/delivery-engine.test.ts` |
| E5-T7 | Integration (fake D1): a `scheduled` campaign auto-promoted by `runAutoScheduler` is delivered in the same request; one correctly skipped (missing rights confirmation) is not; one auto-ended is no longer delivered | `test/delivery-engine.test.ts` |

## Etapa 6 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E6-T1 | Unit: `fetchAdsReport` fail-closed — missing `ANALYTICS_ADMIN_REPORT_URL` setting, missing `ANALYTICS_ADMIN_TOKEN` secret, or no `DB` binding → `503 stats_not_configured`; never calls `fetch` in those cases | `test/analytics-client.test.ts` |
| E6-T2 | Unit: `fetchAdsReport` upstream failures — network error → `503 stats_upstream_unreachable`; non-2xx or invalid JSON → `503 stats_upstream_error` | `test/analytics-client.test.ts` |
| E6-T3 | Unit: `fetchAdsReport` sends `Authorization: Bearer <ANALYTICS_ADMIN_TOKEN>` and forwards filter params (`campaign_id`/`from`/`to`/`device_category`/etc.) in the query string to `<base>/v1/ads/report` | `test/analytics-client.test.ts` |
| E6-T4 | Unit: `fetchAdsReport` rebuilds every row/total from an explicit allowlist — upstream fields like `price_cents`/`email`/`client_code` never survive, even if Analytics ever emitted them by mistake | `test/analytics-client.test.ts` |
| E6-T5 | Integration (fake D1 + mocked fetch): `/v1/admin/stats/summary` and `/v1/admin/stats/campaigns/:id` require `stats.read` — `401` no session, `403` for `sales` (no `stats.read`), `200` for `ads_manager`/`read_only` | `test/admin-stats.test.ts` |
| E6-T6 | Integration: test campaigns (`STATS_TEST_CAMPAIGN_PREFIX`, default `test`) are excluded from every stats response — `campaigns/:id` returns `404` for a `test_*` id even though the campaign exists in D1; `summary` strips `test_*` rows even if Analytics forgot to filter them; an explicit `campaign_id=test_*` on `summary` short-circuits without even calling Analytics | `test/admin-stats.test.ts` |
| E6-T7 | Integration: `/v1/admin/stats/campaigns/:id` response never contains `price`/`email`/`client_code` (or any non-allowlisted field) even if the upstream report includes them; `campaign` object is limited to `campaign_id`/`evidence_code`/`title`/`status` | `test/admin-stats.test.ts` |
| E6-T8 | Integration: both stats routes return `503 stats_not_configured` when `ANALYTICS_ADMIN_REPORT_URL` is empty or `ANALYTICS_ADMIN_TOKEN` is unset | `test/admin-stats.test.ts` |
| E6-T9 | Schema isolation (carried over): `iu-ads` migrations (incl. `0007`) still define no `daily_*`/`ingest_audit` tables — `ANALYTICS_ONLY_TABLES` check in `test/isolation.test.ts` | `test/isolation.test.ts` |

## Etapa 7 (implemented — #7695)

| ID | Test | Gate |
|----|------|------|
| E7-T1 | Unit: client code hash is deterministic SHA-256+pepper, never equals plaintext; different pepper → different hash | `test/client-portal.test.ts` |
| E7-T2 | Unit: `resolveCodeStatus` marks past `expires_at` as `expired`; audit redaction strips `access_code`/`code_hash` | `test/client-portal.test.ts` |
| E7-T3 | Integration: issue returns plaintext once; DB + list + audit never contain plaintext; `sales` denied (`403`); campaign must belong to client | `test/client-portal.test.ts` |
| E7-T4 | Integration: regen revokes old + returns new plaintext once; revoke blocks status; sessions revoked | `test/client-portal.test.ts` |
| E7-T5 | Integration: client login uniform `invalid_credentials`; cookie HttpOnly/Secure/SameSite=Strict; expired/revoked codes rejected | `test/client-portal.test.ts` |
| E7-T6 | Integration: brute-force lockout (5 failures on same `IU-XXXX` prefix → `429 locked_out` even for correct code) | `test/client-portal.test.ts` |
| E7-T7 | Integration: cross-token reject — client cookie fails `requireAdminSession`; admin cookie fails `requireClientSession`; admin token as access code fails | `test/client-portal.test.ts` |
| E7-T8 | Integration: report scoped to code campaigns; hides `note_internal`/price/`r2_key`/internal docs; other client's campaign → `403`; logout invalidates session | `test/client-portal.test.ts` |
| E7-T9 | RBAC: `ads_manager` has `codes.read`/`codes.write`; isolation guard still PASS | `test/rbac.test.ts`, `scripts/iu-ads-isolation-guard.mjs` |

## Etapa 8 (implemented now)

| ID | Test | Gate |
|----|------|------|
| E8-T1 | Dashboard widgets omit surfaces the role cannot read (`ads_manager` no invoices/inquiries/audit; `sales` has inquiries/invoices) | `test/admin-ops.test.ts` |
| E8-T2 | Search never returns `code_hash`/`password_hash`/`access_code`/`r2_key`; role-scoped entity set | `test/admin-ops.test.ts` |
| E8-T3 | Calendar requires `from`/`to`; exclusive overlapping reservations flagged `has_collision` | `test/admin-ops.test.ts` |
| E8-T4 | Alert lifecycle: ack → read, resolve → resolved, double-resolve → `409`; `read_only` cannot ack | `test/admin-ops.test.ts` |
| E8-T5 | Nav filtering: `ads_manager` lacks users/clients; `sales` lacks users/codes | `test/admin-ops.test.ts` |
| E8-T6 | RBAC `alerts.read`/`alerts.write`; migration `0009` indexes-only + schema bump; isolation guard PASS | `test/rbac.test.ts`, `test/isolation.test.ts`, guard |

## Etapa 9 (implemented now — Worker closeout; ads stay OFF)

| ID | Test | Gate |
|----|------|------|
| E9-T1 | Unit: backup inventory redacts `password_hash`/`access_code`/secret key names; `assertNoForbiddenBackupKeys` | `test/backup-security.test.ts` |
| E9-T2 | Unit: restore drill hash round-trip PASS; mismatch → fail; leaky inventory → fail | `test/backup-security.test.ts` |
| E9-T3 | Unit: AES-GCM encrypt/decrypt with backup key material; retention selects expired ids | `test/backup-security.test.ts` |
| E9-T4 | Unit: privacy fail-closed seed + wrangler defaults keep public delivery inactive | `test/backup-security.test.ts` |
| E9-T5 | Integration: `main_admin` create+drill backup; `ads_manager` → `403`; prune deletes expired only | `test/backup-security-admin.test.ts` |
| E9-T6 | Cron: `runAlertsCron` seeds alerts; `ALERT_CRON_ENABLED=false` skips | `test/backup-security-admin.test.ts` |
| E9-T7 | Migration `0010` settings/indexes only; isolation guard PASS; schemaVersion health `0010` | `test/isolation.test.ts`, guard, `/health` |
| E9-T8 | Kap. 14 checklist documented with PASS evidence pointers (ads remain OFF) | `03-security-threat-model.md` |

## Deferred / remaining gaps (honest)

| Gap | Status |
|-----|--------|
| E5 public-site frontend inject (`assets/` / `projects/index.html`) | **deferred** — next closeout PR |
| E7 client portal HTML/JS UI | **done** — Worker `GET /client` SPA-lite |
| E8 full public-site admin UI | **done** — Worker `GET /admin` SPA-lite (list + minimal create depth) |
| PDF export / `client_report_snapshots` (38.13) | **deferred** |
| Kap. 35 future extensions | `deferred_by_spec` |
| Production ads ON (SAFE_MODE off + public delivery on) | **human release gate** |
| Full D1/R2 cold restore in CF | **operator runbook** (`09-backup-restore.md`); automated drill is inventory hash round-trip |
| `iu-ads-backups` R2 binding | **committed** — Deploy ensures bucket; health `r2.backupsBound=true` |
| `ADS_BACKUP_ENCRYPTION_KEY` secret | **operator** — without key, manifests stay `manifest_only` |

## Pozdější etapy (katalog)

UI inject / portal / public-site admin; PDF snapshots; produkční ads ON po explicitním operator go-live.
