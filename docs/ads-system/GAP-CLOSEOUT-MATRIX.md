# InfoUzel Ads — Honest gap closeout matrix (chapters 1–48)

**As of:** after PR #7711 (Admin/Client UI) merged + Deploy IU Ads; follow-up #7714 in flight  
**Prod flags (live health):** `safeMode=true`, `publicDeliveryEnabled=false`, `adminApiEnabled=false`, `clientApiEnabled=false`  
**Human release gate:** production ads ON remains an explicit operator action (Kap. 14).

Legend: **DONE** · **PARTIAL** · **BLOCKED** · **DEFERRED** · **GUARD**

| Kap | Title (short) | Status | Evidence | Remaining |
|-----|---------------|--------|----------|-----------|
| 1 | Public web + label + no empty boxes | PARTIAL | Inject + delivery fail-closed; prod `ads:[]` | Ads ON = Kap.14 human gate |
| 2 | Standalone admin | DONE | Deployed `/admin` full SPA (#7711) | — |
| 3 | Internal login | PARTIAL | UI + APIs; live login → `admin_api_disabled` | Enable Admin API + seed main_admin |
| 4 | Users/roles | PARTIAL | RBAC + UI; needs API ON | Enable Admin API |
| 5 | Admin main menu | DONE | `/v1/admin/nav` + SPA (gated) | — |
| 6 | Dashboard | DONE | API + UI widgets | API ON for live data |
| 7 | New campaign form | DONE | Full create form in `/admin` (#7711) | Live create needs API ON |
| 8 | Devices PC/mobile/tablet | DONE | Engine + inject | — |
| 9 | Dynamic engine | PARTIAL | Engine OFF in prod | Kap.14 |
| 10–13 | Placements/reservations/creatives/states | DONE | APIs + UI + unit tests | Live ops need API ON |
| 14 | Auto start/stop + privacy | PARTIAL | Scheduler + checklist; ads OFF | **Human release gate** |
| 15–19 | Clients/search/filters/calendar/alerts | DONE | APIs + UI | API ON |
| 20–31 | Business/docs/orders/finance | PARTIAL | APIs + UI; some SPA depth JSON | Live E2E after API ON |
| 32 | InfoCentrum Reklama entry | DONE | Link to `/client` | — |
| 33–34 | Backup/security | PARTIAL | APIs + `backupsBound=true`; unit drill | Prod backup+isolated restore proof after API ON; optional encryption key |
| 35 | Future extensions | DEFERRED | Spec | `deferred_by_spec` |
| 36–37 | Client codes/auth | PARTIAL | APIs + UI; live → `client_api_disabled` | Enable Client API |
| 38 | Client report portal | PARTIAL | Tabbed `/client` (#7711); PDF deferred | API ON; PDF still deferred |
| 39–45 | Ops/measurement/isolation | PARTIAL | Unit coverage; signed-access e2e in #7714 | Prod E2E after API ON |
| 46 | Active guard #7617 | GUARD | OID `9be3e372025c0c148a7cdf30a40c6047a28597fe` | **Never touch** |
| 47–48 | Acceptance/closeout | PARTIAL | This honest matrix | Close only when PARTIAL rows cleared except Kap.14/35/46 |

## Residual blockers (honest)

1. **Kap. 14 human gate** — public ads ON (not done here).
2. **Admin/Client API enable** — requires GitHub secrets + Deploy IU Ads workflow_dispatch (`enable_admin_api` / `enable_client_api`) + D1-seeded `main_admin` (`INTERNAL-API-BOOTSTRAP.md`).
3. **Kap. 35** — deferred by spec.
4. **Kap. 46 / PR #7617** — active guard; OID unchanged.
5. **Prod E2E** (roles, creatives, docs, codes, backup drill, exports download) — blocked until (2).
6. **Optional** `ADS_BACKUP_ENCRYPTION_KEY` — without it backups stay `manifest_only`.

## Statement (honest)

**PR #7711 alone is NOT full-system completion.** Admin/Client UIs are deployed fail-closed; public delivery remains OFF. Remaining work is internal API enable + production proofs + honest closeout of PARTIAL chapters (except Kap.14/35/46).
