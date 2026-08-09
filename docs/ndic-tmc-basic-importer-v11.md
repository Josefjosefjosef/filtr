# Basic TMC location-table importer v11 (CID 11 / TABCD 25)

Internal, non-public importer for the documented SP08001 / LTEF exchange layer used by NDIC/ŘSD location tables.

## Supported basic format

| Field | Value |
| --- | --- |
| CID | 11 |
| TABCD | 25 |
| Table version | 11 |
| Standard tables | 25 (Table 4-2) |
| Extra DAT | `README.DAT` (metadata only) |
| Expected DAT files | 26 (25 + README) |

## Entrypoint

- `importBasicTmcArchive(zipPath, opts)` in `scripts/ndic-datex-v1/tmc-basic-importer.mjs`
- Sync gate `analyzeAndGateTmcZipFile` reports `BASIC_IMPORTER_READY` / `TMC_BASIC_IMPORT_REQUIRED` for TISA-like ZIPs (does not replace the async import)

## Pipeline

```text
archive → preflight → lock → stream DAT parse → header/row validation
→ basic relationships → staging → atomic activate → last-good / rollback
```

## Fail-closed advanced features (must stay disabled)

| Flag | Value |
| --- | --- |
| `ADVANCED_RNLT_RELATIONSHIPS_ENABLED` | `false` |
| `PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED` | `false` |
| `LANGUAGES_FIFTH_FIELD_USED` | `false` |
| `UNPROVEN_FIELDS_INFERRED` | `false` |

### RNLT (`ROAD_NETWORK_LEVEL_TYPES` / basename `RNLT.DAT`)

Detected and classified (`PRESENT_EMPTY`, `PRESENT_VALID_BASIC`, …). Empty data rows do not block basic import. Advanced hierarchy resolution is never enabled.

### PES_LEV (ROADS column index 11, 0-based)

Empty values stay `null` (never coerced to `0`). Non-empty values are type-checked only. No RNLT linkage.

### LANGUAGES 5th field

Documented schema has 4 fields. A known 5-field variant is accepted with:

- `languagesExtensionFieldPresent=YES`
- `languagesExtensionFieldSupported=NO`
- fifth field ignored (never used for parsing or publication)

Any other field count fails closed.

## Staging / activation / rollback

- Task-owned staging under a random `importRunId`
- Single-flight lock (`.locks/tmc-import.lock`) with stale reclaim
- Atomic activate via `atomicActivateTmcIndex`
- Previous active copied to last-good; `rollbackBasicTmcImport` restores it
- Failures leave active/last-good unchanged; staging wiped when possible

## Unresolved model (future public use)

Only `RESOLVED_BASIC` may later be published. Other states (`UNRESOLVED_*`, `REJECTED_INVALID_ROW`) stay internal.

## Security limits

Reuses `TMC_ZIP_LIMITS_V11` / disk preflight (`tmc-disk-v2`). Streaming peek (STORE/DEFLATE). Allowlisted error codes only — no raw rows, location names, paths, or credentials in messages.

## Tests

```text
npm run iu-ndic-tmc-basic-importer-fixtures
```

Synthetic fixtures only. Real NDIC archives must not be used as fixtures.

## Out of scope

- DATEX → TMC resolver → see `docs/ndic-datex-tmc-basic-resolver.md`
- Traffic cards / public API / production publication
- NDIC network download / runner / workflow dispatch
- Advanced RNLT / PES_LEV relationship graphs
