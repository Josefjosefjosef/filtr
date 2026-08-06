# Traffic publication, feed and card projection layer (InfoUzel.cz internal)

Offline layer that turns **normalized aggregated traffic events** into allowlisted **publication projections**, an internal **Dopravní feed**, **traffic card** projections, filter indexes and an **offline snapshot**.

Activation remains off:

```text
PUBLICATION_ENABLED=NO
PUBLIC_API_ENABLED=NO
TRAFFIC_UI_ENABLED=NO
```

## Entrypoint

`runTrafficPublicationLayer(aggregatedEvents, opts)` in `scripts/ndic-datex-v1/traffic-publication-layer.mjs`

## Pipeline

```text
aggregation snapshot
→ publication eligibility
→ allowlist projection + field provenance
→ projection validation (schema, canary)
→ feed generation (lastMeaningfulChangeAt DESC)
→ traffic card projections
→ history projections (allowlisted diffs)
→ filter indexes
→ offline snapshot validation
→ atomic finalize (never activates live publication)
```

## Publication eligibility

Only events that pass `evaluatePublicationEligibility` may become projections.

Precise public geo fields (road, km, section, direction, administrative area, verified map location) require **`RESOLVED_BASIC` / `locationPublishable`**.

Other resolver states never create precise public location data:

| Status | Effect |
| --- | --- |
| Unresolved | No precise geo; may be ineligible when location required |
| Ambiguous | `INELIGIBLE_AMBIGUOUS_LOCATION` |
| Invalid | `INELIGIBLE_INVALID_LOCATION` |
| Unsupported relationship | `INELIGIBLE_UNSUPPORTED_RELATIONSHIP` |
| Quarantine / conflict | `INELIGIBLE_CONFLICT` / security blocker |

Filters never upgrade eligibility.

## Allowlist and forbidden fields

Structural allowlist: `PUBLIC_PROJECTION_ALLOWLIST` (`additionalProperties: false`).

Forbidden in projections (canary-scanned): raw DATEX XML, `locationCode`, raw TMC rows, import paths, credentials/secrets, stack traces, RNLT/PES_LEV, subscription IDs, unverified coordinates/km/direction, internal conflict candidates.

## Public event ID

`buildPublicEventId(internalEventIdHash)` → `iu-te-` + domain-separated SHA-256 truncate (`peid-v1`).

Separated from `internalEventIdentity` / `eventIdHash`. Not used for fuzzy deduplication.

## Lifecycle vs change status

Kept distinct:

- `lifecycleStatus`: `NEW` | `CHANGED` | `ACTIVE` | `FUTURE` | `ENDED` | `CANCELLED` (operational life)
- `changeStatus`: last meaningful change class (`NEW` | `CHANGED` | `UNCHANGED` | `ENDED` | `CANCELLED` | `REOPENED`)

## Dopravní feed

Allowlisted change types: `EVENT_CREATED`, `EVENT_UPDATED`, validity start/extend/shorten, severity/location/direction/road/section/impact changes, ended/cancelled/reopened.

Headlines use **deterministic templates** only (no generative AI). Unsafe location → generic wording or omit precise place.

### Sorting

1. `lastMeaningfulChangeAt` DESC  
2. severity DESC  
3. `publicEventId` ASC  

If change time is unknown, `downloadedAt` may be used only with:

```text
changeTimeSource=DOWNLOAD_FALLBACK
```

Download time must never be presented as proven change time.

## Traffic card projection

Internal `TrafficCardProjection` (`iu-traffic-card-projection-v1`): status, type, road/km/section/direction/location, validity, impact, freshness, source, map target, feed headline, field provenance, eligibility. Optional fields omitted when unavailable. Live cards remain disabled.

## Field provenance

Each public field: `value`, `source`, `sourceTimestamp`, `lastChangedAt`, `validationStatus`, `confidenceClass`  
(`VERIFIED_SOURCE_FIELD` | `VERIFIED_RESOLVED_BASIC` | `VERIFIED_DERIVED_DIFF` | `NOT_PUBLIC`). No subjective percentage scores.

## Impact summary

Deterministic Czech templates from structured category + change type only. No free-text invention of delay/impassability/reopening.

## Metrics (delay, queue, speed, travel time)

Only `PROVEN` when explicitly supplied from verified source opts. Estimation flags are permanently off. Attempts to estimate delay fail closed.

## Map target

```text
OFFICIAL_EVENT | VERIFIED_LOCATION | GENERAL_RSD_MAP | NONE
```

No heuristic URL from internal IDs. Verified location does not emit raw coordinates into the projection.

## Freshness

`FRESH` | `STALE` | `EXPIRED` | `UNKNOWN` — model only; UI not activated.

## Offline snapshot

Contains only publication projections / feed / cards / history / filter indexes. Fields: `snapshotVersion`, `generatedAt`, `sourceFreshness`, `eventCount`, `feedCount`, `dataAge`, `publicationEnabled=false`, `schemaVersion`. Atomic finalize; partial snapshots rejected.

## Filters

Spatial: `MY_SELECTION`, `MY_ROUTES`, `NEAR_ME`, `WHOLE_CZ` (Celá ČR)  
Temporal: `NOW`, `TODAY`, `TOMORROW`, `WEEKEND`, `CUSTOM_DATETIME`  
Types: closures, restrictions, accidents, roadworks, queues, road/weather, future, ended, severe  

Synthetic preferences / corridors / near hashes only — no real user location storage, no reverse geocoding, no routing engine.

## Pre-trip overview

Contract overlaps planned interval with event validity. Does not compute travel duration.

## History

Allowlisted diff-derived items only — no raw source, locationCode, or internal IDs.

## Deduplication

Uses internal aggregation identity → stable `publicEventId`. Publication layer does not heuristically merge similar events.

## Security canaries

Any hit → `PUBLICATION_SECURITY_CANARY_DETECTED` and snapshot failure.

## Why publication stays disabled

This layer prepares audited projections for a future UI task. Live publication, public API, traffic UI, NDIC runners and production deploy remain out of scope until a separate end-to-end production-readiness audit passes.

## Tests

```text
npm run iu-ndic-traffic-publication-fixtures
npm run iu-ndic-traffic-publication-meta-fixtures
```

Synthetic fixtures only. Node.js 24.
