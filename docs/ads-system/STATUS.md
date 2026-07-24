# InfoUzel Ads — implementation STATUS

**Current stage:** Etapa 0–9 **DONE** · product closeout **technically complete**  
**Safe mode:** ON · Public delivery: OFF · Admin API default: OFF · Client API default: OFF  
**Human release gate:** production ads ON still awaits explicit operator flip (Kap. 14)  
**Statement:** **Technically complete. Activation awaits human release gate.**

## Closeout PRs

| PR | Scope | Status |
|----|-------|--------|
| #7705 | `BACKUPS` R2 binding `iu-ads-backups` | MERGED · prod `r2.backupsBound=true` |
| #7706 | Admin `/admin` + client `/client` SPA-lite | MERGED |
| (this) | Public inject + InfoCentrum link + gap matrix | in flight |

## Remaining (ONLY)

| Item | Notes |
|------|-------|
| Production ads ON | Human Kap. 14 release gate — do **not** flip committed wrangler defaults |
| Kap. 35 | `deferred_by_spec` |
| PR #7617 | `active_guard` — never touch |
| `ADS_BACKUP_ENCRYPTION_KEY` | Optional operator secret (without it: `manifest_only`) |

See `docs/ads-system/GAP-CLOSEOUT-MATRIX.md` for chapters 1–48.

## Stage checklist

| Etapa | Stav |
|-------|------|
| 0 | done |
| 1 | **done** (#7680) |
| 2 | **done** (#7684) |
| 3 | **done** (#7687) |
| 4 | **done** (#7689) |
| 5 | **done** (#7690) + public inject asset |
| 6 | **done** (#7693) |
| 7 | **done** (#7695) + `/client` SPA-lite (#7706) |
| 8 | **done** (#7699) + `/admin` SPA-lite (#7706) |
| 9 | **done** (#7702/#7705) |

## Guards

- PR #7617 OID `9be3e372025c0c148a7cdf30a40c6047a28597fe` OPEN unchanged
- `stash@{0}` `iu-v3-wip-unrelated-cnb` preserved
- Data Bot workflows remain **active** unless BEHIND treadmill after GREEN
