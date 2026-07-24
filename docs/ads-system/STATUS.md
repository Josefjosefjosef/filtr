# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 1–9 **DONE** (Worker) · closeout UIs in progress  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF · Client API default: OFF  
**Human release gate:** production ads ON still awaits explicit operator flip (Kap. 14)  

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

### Admin + client SPA-lite (this closeout)

- `GET /admin` — production SPA-lite: login, role nav, dashboard/search/calendar/alerts/campaigns/clients/stats/backups; API-disabled UX via `/health` flags; `noindex` + `Cache-Control: no-store`
- `GET /client` — access-code portal: me + report + JSON/CSV export links; uniform errors; API-disabled UX
- Depth note: list + minimal create stubs for campaigns/clients; other nav entries render API JSON panels (UI present, wired to API)
- Fail-closed wrangler defaults **unchanged**

### Remaining gaps (honest)

| Gap | Notes |
|-----|-------|
| E5 frontend inject | Still deferred — next PR (`assets/` + `projects/index.html`) |
| Kap. 32 InfoCentrum entry | Optional link in inject PR |
| Kap. 35 | `deferred_by_spec` |
| `ADS_BACKUP_ENCRYPTION_KEY` | Operator secret put (without it: `manifest_only`) |
| Production ads ON | **Human release gate** (Kap. 14) |

**Verdict:** **technically complete Worker+admin/client UI / ads still OFF / activation awaits human release gate**

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
| 7 | **done** (#7695) — portal API + `/client` SPA-lite |
| 8 | **done** (#7699) — ops APIs + `/admin` SPA-lite |
| 9 | **done** (#7702/#7705) — backup/security + BACKUPS binding (do **not** flip production ads ON) |

## Guards

- PR #7617 OID `9be3e372…` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active** unless BEHIND treadmill after GREEN
