# CHMI CAP temporal status unification

## Problem
`status=aktivni` was assigned to every non-cancelled, non-past-expires hazard,
including future onsets and items with missing `expires`. Monitoring
`activeCount` counted that publish set, not temporally in-force warnings.

## Model
| temporalState | status (public) | publishable | badgeActive |
|---|---|---|---|
| active | aktivni | yes | yes |
| scheduled | naplanovano | yes | no |
| expired | ukonceno | no | no |
| cancelled | zruseno | no | no |
| invalid | nezaraditelne | no | no |

Rules (Europe/Prague wall times from CAP ISO offsets):
- active: validFrom ≤ now < validTo
- scheduled: now < validFrom < validTo
- expired: validTo ≤ now
- cancelled: CAP msgType Cancel
- invalid: missing validFrom/validTo or invalid interval — never invent times

## Separation of meanings
1. CAP message state — msgType / CAP status
2. Temporal validity — `capV2.temporalState` + public `status`
3. Publishability — `publishable` / `capV2.publishable`
4. Feed visibility — sync publishes only publishable; UI uses same lifecycle

## Monitoring
`activeCount` = temporally in-force only.
Also: `scheduledCount`, `expiredCount`, `cancelledCount`, `invalidCount`,
`publishableCount`, `visibleCount`, `totalItems`, `sourceCount`, `activeSourceCount`.

## Code
- `scripts/chmi-cap-v2/normalize-feed.mjs` — `classifyChmiTemporalState`
- `scripts/chmi-cap-v2-prod-sync.mjs` — publish filter + counters; cache epoch 4
- `assets/iu-info-system-core-v1.js` — lifecycle from same rules
- `scripts/iu-chmi-cap-status-consistency-guard.mjs`
