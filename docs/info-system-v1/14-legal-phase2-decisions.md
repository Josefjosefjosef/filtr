# Legal whitelist — phase 2 decisions (2026-07-20)

## Baseline

- Phase 1 merge: `d30f4bbe2794da92d021d09738b6e3afacf31b38`
- Phase 1 left 26 production-active sources mostly as interim `APPROVED_WITH_SPECIFIC_CONDITIONS` without `licenseUrl` / distribution evidence.

## Rule applied

A source stays production-active only with:

- concrete `licenseUrl` (HTTPS),
- external evidence URL(s),
- field allowlist,
- fresh `reauditDue`,
- all commercial/ad/combination/automation flags true.

## Production decisions

| sourceId | Decision | Status |
|----------|----------|--------|
| `chmi` | Keep — CC BY 4.0 documented on ČHMÚ FAQ + open-data hub | `APPROVED_CC_BY` |
| All other previously interim gov RSS/notice sources | Remove from production until distribution licence is proven | `LICENSE_UNCLEAR` |
| `ct24`, `irozhlas` | Remain out of production | `LEGAL_REVIEW_REQUIRED` |
| Commercial media (10) | Remain rejected | `REJECTED` |
| NDIC / eSbírka / CNB / … | Not production | `TECHNICAL_REVIEW_REQUIRED` / GDPR review where needed |

## NKOD deep-dive

- SPARQL inventory: `docs/info-system-v1/13-nkod-deep-dive-inventory.json` (180 unique datasets across weather/transport/safety/health/contracts buckets).
- Discovery rows are `DISCOVERED` only — not auto-approved.
- Licence of a catalogue record is never copied onto a distribution without distribution-level confirmation.

## Feed impact

- Production feed filtered to legally publishable sources (ČHMÚ) after phase-2 gate.
- Hard gate in refresh remains fail-closed.

## Public page

- `/projects/zdroje-a-licence/` renders only `productionSourceActive` + `APPROVED_*` rows from the registry.
