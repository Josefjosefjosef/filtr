# Normalized traffic-event aggregation (InfoUzel.cz internal)

Builds a single internal event model from normalized DATEX fields and **only** `RESOLVED_BASIC` TMC locations. Prepares traffic feed, filters, and a publication projection — **none of which are publicly enabled**.

## Entrypoint

`aggregateTrafficEvents(datexEvents, opts)` in `scripts/ndic-datex-v1/traffic-event-aggregator.mjs`

## Pipeline

```text
DATEX-like events (+ optional live resolve against TMC snapshot)
→ buildNormalizedTrafficEvent (RESOLVED_BASIC only)
→ deduplicate by eventIdHash (never merge direction/segment conflicts)
→ diff vs previous store (normalized fields only)
→ buildTrafficFeedModel (sort by lastMeaningfulChangeAt)
→ applyTrafficFilters (spatial + temporal prep)
→ buildPublicationProjection (allowlisted fields, unpublished)
→ attemptPublication → always AGG_PUBLICATION_DISABLED
```

## Fail-closed rules

| Rule | Behavior |
| --- | --- |
| Non-`RESOLVED_BASIC` locations | Excluded from event locations |
| `CONFLICTING_RESOLUTIONS` | Event build fails (`AGG_LOCATION_CONFLICT`) |
| Distinct opposite directions | Kept as separate location branches; summary direction `ambiguous_unmerged` (not published) |
| Same identity, conflicting merge | Dedupe rejects merge |
| Unknown direction | Not published as BOTH |
| Kilometer | Only if `PROVEN`; never estimated |
| Coordinates / road / direction | Only validated provenance fields |
| Publication / cards / public API | Always disabled |

## Diff kinds

`NEW_EVENT`, `EVENT_UPDATED`, `DIRECTION_CHANGED`, `ROAD_CHANGED`, `SEGMENT_CHANGED`, `START_TIME_CHANGED`, `END_TIME_CHANGED`, `SEVERITY_CHANGED`, `DESCRIPTION_CHANGED`, `LOCATION_ADDED`, `LOCATION_REMOVED`, `STATUS_ENDED`, `STATUS_CANCELLED`, `CONFLICT_UNMERGED`, `NO_CHANGE`

## Feed signals (internal labels only)

`NEW_ACCIDENT`, `CLOSURE_EXTENDED`, `RESTRICTION_ENDED`, `NEW_ROADWORKS`, `WEATHER_CHANGE`, `GENERIC_*` — sorted by **last meaningful change**, never download time.

## Filters (prep only)

Spatial: `MY_SELECTION`, `MY_ROUTES`, `NEAR_ME`, `WHOLE_CZ`  
Temporal: `NOW`, `TODAY`, `TOMORROW`, `WEEKEND`, `CUSTOM_RANGE`  

No geocoding, fuzzy matching, or distance heuristics — only opaque allowlists / validity windows.

## Tests

```text
npm run iu-ndic-traffic-event-aggregation-fixtures
npm run iu-ndic-traffic-event-aggregation-meta-fixtures
```

## Out of scope

Public API, traffic cards, production publication, UI, NDIC network, real archives.

See also: `docs/ndic-datex-tmc-basic-resolver.md`, `docs/ndic-tmc-basic-importer-v11.md`.
