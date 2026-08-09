# DATEX → basic TMC resolver (CID 11 / TABCD 25)

Offline fail-closed resolver that maps normalized DATEX Alert-C location references onto the validated basic TMC model.

Only `RESOLVED_BASIC` is publicly eligible. All other statuses must not produce precise public road/km/direction/municipality/coordinate claims.

## Entrypoint

- `resolveDatexTmcReference(ref, snapshot, ctx)`
- `resolveDatexEventLocations(event, snapshot, opts)`
- `resolveDatexTmcBatch(events, snapshot, opts)`

Modules: `scripts/ndic-datex-v1/datex-tmc-resolver*.mjs`, `tmc-resolution-snapshot.mjs`.

## Documented DATEX input variants (as parsed today)

```text
DATEX_LOCATION_INPUT_VARIANTS=TMC_POINT,TMC_LINEAR,DIRECT_COORDINATE,UNSUPPORTED(area/other)
DATEX_TMC_REFERENCE_VARIANTS=kind+countryCode+tableNumber+locationCode[+secondaryLocationCode]+direction[+offsetDistance]
DATEX_DIRECTION_VARIANTS=positive|negative|both|unknown|conflict (normalized to POSITIVE|NEGATIVE|BOTH|UNKNOWN|CONFLICT)
DATEX_OFFSET_VARIANTS=offsetDistance metres on alertCPoint (linear offsets not parsed)
DATEX_MULTI_LOCATION_VARIANTS=up to 40 refs/record; normalize uses records[0]; identical refs deduped; distinct/conflict classified
```

## NDIC Alert-C ↔ TISA contract

| DATEX Alert-C | TISA table |
| --- | --- |
| country code `2` | CID `11` |
| table number `25` | TABCD `25` |
| — | table version `11` |

Missing CC/LTN may inherit these defaults only under `ndic_datex_alertc_contract` (regression-tested). Wrong CC/LTN ⇒ mismatch errors.

## Resolution statuses

| Status | Publicly eligible |
| --- | --- |
| `RESOLVED_BASIC` | YES |
| `UNRESOLVED_MISSING_REFERENCE` | NO |
| `UNRESOLVED_INVALID_REFERENCE` | NO |
| `UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP` | NO |
| `UNRESOLVED_AMBIGUOUS` | NO |
| `REJECTED_INVALID_INPUT` | NO |

## Fail-closed flags (must remain false)

```text
RNLT_ADVANCED_RELATIONSHIPS_ENABLED=NO
PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED=NO
LANGUAGES_FIFTH_FIELD_USED=NO
FUZZY_LOCATION_MATCHING_ENABLED=NO
KILOMETER_ESTIMATION_ENABLED=NO
COORDINATE_INTERPOLATION_ENABLED=NO
UNPROVEN_FIELDS_INFERRED=NO
```

## Snapshot

Resolver reads a private `tmc-resolution-snapshot-v1` (synthetic in tests). Public `tmc-basic-index-v1` remains opaque. Batch pins `importRunId` for the whole run.

## Provenance / freshness / history

Per-field `{ value, source, sourceUpdatedAt, validationStatus }`. Freshness: `FRESH|STALE|EXPIRED|UNKNOWN`. History diff compares normalized fields only (no raw XML/rows).

## Tests

```text
npm run iu-ndic-datex-tmc-resolver-fixtures
npm run iu-ndic-datex-tmc-resolver-meta-fixtures
```

## Out of scope

Traffic cards, public API, production publication, NDIC network, RNLT/PES_LEV graphs.
