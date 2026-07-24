# InfoUzel Ads — Honest gap closeout matrix (chapters 1–48)

**As of:** after PR #7714 + safe main_admin bootstrap PR (in flight)  
**Prod flags (live health before bootstrap):** `safeMode=true`, `publicDeliveryEnabled=false`, `adminApiEnabled=true`, `clientApiEnabled=true`, `backupsBound=true`  
**Live login before secrets/bootstrap:** `auth_not_configured`  
**Human release gate:** production ads ON remains an explicit operator action (Kap. 14).

Legend: **DONE** · **PARTIAL** · **BLOCKED** · **DEFERRED** · **GUARD**

| Kap | Title (short) | Status | Evidence | Remaining |
|-----|---------------|--------|----------|-----------|
| 1 | Public web + label + no empty boxes | PARTIAL | Inject + delivery fail-closed; prod `ads:[]` | Ads ON = Kap.14 human gate |
| 2 | Standalone admin | DONE | Deployed `/admin` full SPA (#7711) | — |
| 3 | Internal login | BLOCKED | UI + APIs ON; needs secrets + main_admin activation | Run **Bootstrap IU Ads Main Admin** (`INTERNAL-API-BOOTSTRAP.md`) |
| 4 | Users/roles | PARTIAL | RBAC + UI; API ON | First main_admin login |
| 5 | Admin main menu | DONE | `/v1/admin/nav` + SPA | Live after login |
| 6 | Dashboard | DONE | API + UI widgets | Live after login |
| 7 | New campaign form | DONE | Full create form in `/admin` (#7711) | Live create after login |
| 8 | Devices PC/mobile/tablet | DONE | Engine + inject | — |
| 9 | Dynamic engine | PARTIAL | Engine OFF in prod | Kap.14 |
| 10–13 | Placements/reservations/creatives/states | DONE | APIs + UI + unit tests | Live ops after login |
| 14 | Auto start/stop + privacy | PARTIAL | Scheduler + checklist; ads OFF | **Human release gate** |
| 15–19 | Clients/search/filters/calendar/alerts | DONE | APIs + UI | Live after login |
| 20–31 | Business/docs/orders/finance | PARTIAL | APIs + UI | Live E2E after login |
| 32 | InfoCentrum Reklama entry | DONE | Link to `/client` | — |
| 33–34 | Backup/security | PARTIAL | APIs + `backupsBound=true`; unit drill | Prod backup+isolated restore after login; optional encryption key |
| 35 | Future extensions | DEFERRED | Spec | `deferred_by_spec` |
| 36–37 | Client codes/auth | PARTIAL | APIs + UI ON | Client code + session after secrets |
| 38 | Client report portal | PARTIAL | Tabbed `/client` (#7711); PDF deferred | Login/code; PDF still deferred |
| 39–45 | Ops/measurement/isolation | PARTIAL | Unit + signed-access e2e (#7714) | Prod E2E after login |
| 46 | Active guard #7617 | GUARD | OID `9be3e372025c0c148a7cdf30a40c6047a28597fe` | **Never touch** |
| 47–48 | Acceptance/closeout | PARTIAL | This honest matrix | Close only when PARTIAL rows cleared except Kap.14/35/46 |

## Residual blockers (honest)

1. **Kap. 14 human gate** — public ads ON (not done here).
2. **Secrets + first main_admin** — create GitHub Actions `ADS_*` secrets, run **Bootstrap IU Ads Main Admin**, activate via private artifact URL (`INTERNAL-API-BOOTSTRAP.md`). No password in chat/CI.
3. **Kap. 35** — deferred by spec.
4. **Kap. 46 / PR #7617** — active guard; OID unchanged.
5. **Prod E2E** (roles, creatives, docs, codes, backup drill, exports, logout-all, password change) — blocked until (2) completes with real `/admin` login.
6. **Optional** `ADS_BACKUP_ENCRYPTION_KEY` — without it backups stay `manifest_only`.

## Statement (honest)

**System is NOT complete until main_admin can sign in at `/admin` and remaining PARTIAL prod proofs pass.** Public delivery remains OFF. Safe bootstrap path exists; the remaining external step is operator secrets + activation (never paste secrets into Cursor).
