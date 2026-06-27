# STOP-SHIP Security Review — InfoUzel Phase 1

## Verdict

| Field | Value |
|-------|-------|
| **STOP_SHIP_REAL** | NO |
| **FALSE_POSITIVE** | YES |
| **SECRET_ROTATION_REQUIRED** | NO |

## Summary

Nightly CI hlásil STOP-SHIP=1 kvůli detekci řetězce `BEGIN PRIVATE KEY` v auditních/guard souborech (`.github/workflows/nightly-health-report.yml`, `scripts/generate_security_governance_reports.py`), kde jde o **self-reference** v guard logice, ne hardcoded tajemství.

Žádný skutečný PEM klíč, AWS access key ani hardcoded API secret v repozitáři nebyl nalezen.

## Files Reviewed

- `.github/workflows/nightly-health-report.yml` — STOP-SHIP grep guard (self-reference)
- `scripts/generate_security_governance_reports.py` — scanner + redaction + selftest
- Celorepový grep: `BEGIN PRIVATE KEY`, `AKIA…`, `api_key=` s literálem

## Findings Detail

### False positives (audit tooling)

| Path | Line | Reason |
|------|------|--------|
| `.github/workflows/nightly-health-report.yml` | 296–302, 410–420 | Guard grep hledá zakázané tokeny v reportech |
| `scripts/generate_security_governance_reports.py` | 150–173, 560–565 | Dokumentace/redakce PEM patternu + selftest |

## ACTION_TAKEN

1. **FIXED** — `scripts/generate_security_governance_reports.py`: allowlist audit guard paths + klasifikace env indirection (`is_audit_guard_hit`), STOP-SHIP počítá jen ne-dokumentované PEM/AWS hity.
2. Regenerovaný report: `STATUS: PASS`, `STOP-SHIP=0`, `RISK=0`.
3. **Žádná rotace klíčů** — nebyl nalezen uniklý secret v gitu.

## Recommendation

- Secrets zůstávají pouze v Cloudflare Wrangler / server env — bez commitu.
- Nightly guard v YAML ponechán (správně blokuje skutečné úniky v generovaných reportech).
