# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1–8 **DONE** · Etapa 9 **in progress** (backup/security/E2E closeout)  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF · Client API default: OFF  

## Etapa 8 closeout — admin ops

- PR [#7699](https://github.com/Josefjosefjosef/filtr/pull/7699) **MERGED**
- Migration `0009` · prod `schemaVersion=0009`
- Alert Cron deferred → Etapa 9 (now wired)

## Etapa 9 — backup / security / E2E closeout (this branch)

- Migration `0010_backup_security.sql`: backup indexes + `BACKUP_RETENTION_DAYS` / `ALERT_CRON_ENABLED` / emergency-pause tunable reaffirm; `schemaVersion` → `0010`
- New: `backup.ts`, `admin-backup.ts` (manifest create/list/get/drill/prune; main_admin `backups.*`)
- Alerts Cron: Worker `scheduled` + wrangler `crons = ["0 */6 * * *"]` → `runAlertsCron`
- Kap. 14 checklist documented with PASS evidence pointers (`03-security-threat-model.md`) — **ads stay OFF**
- Restore drill: automated inventory hash round-trip; full CF D1/R2 restore = operator runbook (`09-backup-restore.md`)
- **Wrangler defaults unchanged** (SAFE_MODE / public / admin / client fail-closed)
- **`BACKUPS` R2 binding committed** → `iu-ads-backups` (Deploy `ensure_bucket`); encryption key still operator secret
- Tests: backup-security (+ admin/cron) added; isolation guard PASS expected

### Remaining gaps (honest — do **not** call full goal done)

| Gap | Notes |
|-----|-------|
| E5 frontend inject | No `assets/` / `projects/` client calling delivery API |
| E7 client portal UI | Worker API only |
| E8 public-site admin UI | Worker `/admin` shell only |
| Kap. 35 | `deferred_by_spec` |
| `ADS_BACKUP_ENCRYPTION_KEY` | Operator secret put (without it: `manifest_only`) |
| Production ads ON | Explicit human operator later (Kap. 14 release gate) |

**Verdict after Etapa 9 + BACKUPS binding:** **v1 Worker complete / ads still OFF / technically awaiting human release gate for ads ON**

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680) |
| 2 | **done** (#7684) |
| 3 | **done** (#7687) |
| 4 | **done** (#7689) |
| 5 | **done** (#7690) — engine; frontend inject deferred |
| 6 | **done** (#7693) |
| 7 | **done** (#7695) — portal API; UI deferred |
| 8 | **done** (#7699) — ops APIs; public-site admin UI deferred |
| 9 | in progress — backup/security/E2E closeout (do **not** flip production ads ON) |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active** unless BEHIND treadmill after GREEN
