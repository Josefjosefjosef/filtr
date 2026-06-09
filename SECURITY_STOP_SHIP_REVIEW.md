# STOP-SHIP Security Review — InfoUzel Phase 1

## Verdict

| Field | Value |
|-------|-------|
| **STOP_SHIP_REAL** | NO |
| **FALSE_POSITIVE** | YES |
| **SECRET_ROTATION_REQUIRED** | NO |

## Summary

Nightly CI hlásil STOP-SHIP=1 kvůli detekci řetězce `BEGIN PRIVATE KEY` v auditních/guard souborech (`.github/workflows/nightly-health-report.yml`, `scripts/generate_security_governance_reports.py`) a kvůli pattern matchům `api_key` / `API_KEY` v `cloudflare/vin-worker/src/index.mjs`, kde jde o **env reference**, ne hardcoded tajemství.

Žádný skutečný PEM klíč, AWS access key ani hardcoded API secret v repozitáři nebyl nalezen.

## Files Reviewed

- `cloudflare/vin-worker/src/index.mjs` — `env.VIN_UPSTREAM_KEY`, `env.VIN_API_KEY`, `env.IMAGE_UPLOAD_SECRET` (runtime secrets via Wrangler)
- `cloudflare/vin-worker/wrangler.toml` — dokumentace secret setup
- `server/vin-decode-core.mjs`, `server/vin-decode-http.mjs` — env-only
- `docs/vin-api-deploy.md`, `cloudflare/vin-worker/DEPLOY-LIVE.md` — redacted docs
- `.github/workflows/nightly-health-report.yml` — STOP-SHIP grep guard (self-reference)
- `scripts/generate_security_governance_reports.py` — scanner + redaction + selftest
- Celorepový grep: `BEGIN PRIVATE KEY`, `AKIA…`, `api_key=` s literálem

## Findings Detail

### False positives (audit tooling)

| Path | Line | Reason |
|------|------|--------|
| `.github/workflows/nightly-health-report.yml` | 296–302, 410–420 | Guard grep hledá zakázané tokeny v reportech |
| `scripts/generate_security_governance_reports.py` | 150–173, 560–565 | Dokumentace/redakce PEM patternu + selftest |

### Env references (not secrets)

| Path | Line | Reason |
|------|------|--------|
| `cloudflare/vin-worker/src/index.mjs` | 146, 167 | `env.VIN_UPSTREAM_KEY` / HTTP header name `API_KEY` |
| `cloudflare/vin-worker/src/index.mjs` | 250 | `env.IMAGE_UPLOAD_SECRET` |

## ACTION_TAKEN

1. **FIXED** — `scripts/generate_security_governance_reports.py`: allowlist audit guard paths + klasifikace env indirection (`is_audit_guard_hit`), STOP-SHIP počítá jen ne-dokumentované PEM/AWS hity.
2. Regenerovaný report: `STATUS: PASS`, `STOP-SHIP=0`, `RISK=0`.
3. **Žádná rotace klíčů** — nebyl nalezen uniklý secret v gitu.

## Recommendation

- Secrets zůstávají pouze v Cloudflare Wrangler / server env — bez commitu.
- Nightly guard v YAML ponechán (správně blokuje skutečné úniky v generovaných reportech).
