# InfoUzel Ads — Gap closeout matrix (chapters 1–48)

**As of:** closeout PRs after Etapa 9 (`#7702`) + BACKUPS (`#7705`) + admin/client UI + public inject  
**Prod flags (committed defaults):** `safeMode=true`, `publicDeliveryEnabled=false`, `adminApiEnabled=false`, `clientApiEnabled=false`  
**Human release gate:** production ads ON remains an explicit operator action (Kap. 14). Technical complete ≠ ads ON.

Legend: **I**=implemented · **T**=tested · **D**=deployed · **P**=prod-verified · **R**=remaining

| Kap | Title (short) | I | T | D | P | Evidence | Remaining |
|-----|---------------|---|---|---|---|----------|-----------|
| 1 | Public web + label + no empty boxes | Y | Y | Y | partial | Worker delivery + `assets/iu-ads-public-v1.js` inject; empty→zero DOM | Ads ON = human gate |
| 2 | Standalone admin | Y | Y | Y | Y | `GET /admin` SPA-lite | — |
| 3 | Internal login | Y | Y | Y | Y | Admin auth APIs + UI form | API enable out-of-band |
| 4 | Users/roles | Y | Y | Y | Y | Admin users/RBAC | — |
| 5 | Admin main menu | Y | Y | Y | Y | `/v1/admin/nav` + SPA nav | — |
| 6 | Dashboard | Y | Y | Y | Y | `/v1/admin/dashboard` + UI | — |
| 7 | New campaign form | Y | Y | Y | Y | List + minimal create stub in `/admin` | Deep multi-step wizard not required for closeout |
| 8 | Devices PC/mobile/tablet | Y | Y | Y | Y | Engine + inject device detect | — |
| 9 | Dynamic engine | Y | Y | Y | Y | `delivery-engine` + route tests | Public ON = human gate |
| 10 | Placement catalog | Y | Y | Y | Y | Admin API + SPA JSON panel | — |
| 11 | Reservations/collisions | Y | Y | Y | Y | Reservation/collision tests + calendar UI | — |
| 12 | Creatives | Y | Y | Y | Y | Creative APIs + SPA panel | — |
| 13 | Campaign states | Y | Y | Y | Y | State machine tests | — |
| 14 | Auto start/stop + privacy | Y | Y | Y | Y | Scheduler + kap.14 checklist; ads OFF | **Human release gate for ads ON** |
| 15 | Clients | Y | Y | Y | Y | Clients API + SPA list/create | — |
| 16 | Search | Y | Y | Y | Y | Search API + UI | — |
| 17 | Filters | Y | Y | Y | Y | List filters module | — |
| 18 | Calendar | Y | Y | Y | Y | Calendar API + UI | — |
| 19 | Alerts | Y | Y | Y | Y | Alerts API/cron + UI ack | — |
| 20–31 | Business docs/orders/etc. | Y | Y | Y | Y | Etapa 3–8 APIs | Depth notes in STATUS where SPA shows JSON panels |
| 32 | InfoCentrum Reklama entry | Y | Y | Y | Y | Minimal safe link to Worker `/client` + reklama note | — |
| 33–34 | Backup/security | Y | Y | Y | Y | Backup APIs + `BACKUPS` bound | Encryption key secret optional |
| 35 | Future extensions | — | — | — | — | Spec | **`deferred_by_spec`** |
| 36–37 | Client codes/auth | Y | Y | Y | Y | Client auth APIs | API enable out-of-band |
| 38 | Client report portal | Y | Y | Y | Y | `/client` SPA-lite + exports | PDF snapshot deferred |
| 39–45 | Ops/measurement/isolation | Y | Y | Y | Y | Etapa 6–9 | — |
| 46 | Active guard #7617 | — | — | — | — | PR open | **`active_guard` — never touch** |
| 47–48 | Acceptance/closeout | Y | Y | Y | Y | This matrix + STATUS | Human gate residual |

## Residual (only)

1. **Human release gate** — flip SAFE_MODE / public delivery (and optionally admin/client API) out-of-band; never in committed defaults.
2. **Kap. 35** — `deferred_by_spec`.
3. **Kap. 46 / PR #7617** — `active_guard` OID must remain untouched.
4. **Optional:** `ADS_BACKUP_ENCRYPTION_KEY` secret put (without it: `manifest_only`).

## Statement

**Technically complete. Activation awaits human release gate.**
