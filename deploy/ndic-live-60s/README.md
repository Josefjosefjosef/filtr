# NDIC 60s live DATEX path (Phase 3)

## Authoritative live store

`AUTHORITATIVE_LIVE_TRAFFIC_STORE=cloudflare-r2:iu-ndic-traffic-live`

Served at the **same** URL the UI already reads:

`/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json`

via Worker `infouzel-site-redirects` when `LIVE_TRAFFIC_ENABLED=true`.

## Components

| Piece | Role |
|-------|------|
| `scripts/ndic-datex-v1-live-60s-run.mjs` | Oneshot tick: lock → conditional DATEX → process → publish |
| `deploy/ndic-live-60s/*.service|timer` | systemd start-to-start (`OnCalendar=*:*:00`) |
| `.github/workflows/ndic-live-60s.yml` | install / shadow-window / cutover / rollback on Czech VPS |
| Worker R2 publish POST | `__iu_live_publish` (Bearer `LIVE_TRAFFIC_PUBLISH_TOKEN`) |

## Modes

- `IU_NDIC_LIVE_MODE=off|shadow|active`
- Shadow: full process, `PRODUCTION_WRITE=NO`
- Active: atomic publish to R2

## GitHub 15min role after cutover

`BACKUP_OR_RECONCILIATION` — git/Pages audit trail. Does **not** write R2.
Repo var `NDIC_LIVE_60S_AUTHORITATIVE=true` marks single production writer = VPS.

## Secrets

- NDIC pull: existing `IU_NDIC_PULL_*` (VPS / live-60s workflow only)
- Publish: `LIVE_TRAFFIC_PUBLISH_TOKEN` (Worker secret + VPS env)
