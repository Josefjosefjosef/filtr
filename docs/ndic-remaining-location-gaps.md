# NDIC remaining location gaps (post-OpenLR)

Authoritative sources used for this phase:

- DATEX II SupplementaryPositionalDescription
  (https://docs.datex2.eu/levels/mastering/location/supplementarypositionaldescription/)
- DATEX II Location referencing / Alert-C packages
- LT CZE / TISA SP08001 basic tables (POINTS, SEGMENTS, OTHERAREAS,
  ADMINISTRATIVEAREA, LOCATIONCODES) already imported by the NDIC TMC
  basic importer
- Prior shadow `31186133302` forensic aggregates (no raw LCD/XML)

## Baseline after OpenLR closure

| Bucket | Count | Meaning |
| --- | --- | --- |
| TMC_LCD_NOT_FOUND | 42 | Alert-C LCD absent from POINTS; also absent from forensic P/L/A side-index |
| SUPPLEMENTARY_ONLY | 41 | Wrapper present; children previously unread |
| NO_LOCALIZATION_SIGNAL | 436 | No detected standard location profile |

## Policy

- No fuzzy match, geocoding, map API, or inferred km/direction/coordinates.
- `localizationTrust=tmc|coordinates|openlr` only for verified geo.
- Structured road/name from DATEX may yield `trust=text` labels but does
  **not** create publication-eligible precise location.
- LCD present only in LOCATIONCODES (no POINTS/SEGMENTS/AREA row) is
  classified as source-side incomplete/invalid, not invented geometry.
- Segment/area name bridges must not set `tmcOk` without coordinates.

## Cycle 2 — no-signal unrecognized detector

Root cause (proven on shadow `31196649894`): presence walk used a substring
regex (`location|point|area|linear|…`) on every descendant name. That marked
`LOC_HAS_UNRECOGNIZED≈3685` and forced all 432 no-signal events into
`UNRECOGNIZED_PROFILE`, including events with known Alert-C / OpenLR /
supplementary metadata children.

Fix (instrumentation only):

- Unrecognized applies only to **location method roots** that are DATEX
  standard-but-unsupported or vendor extensions.
- If any **known supported** profile is present, unrecognized stays false.
- No-signal subtypes: empty / no_location_element / unrecognized_standard /
  unrecognized_vendor / location_extension_only / other.

Out of scope for this cycle: LOCATIONCODES-only LCD (42), supplementary (41),
OpenLR, publication, trust changes.

## Cycle 3 — anonymized root inventory (6 + 413)

Goal: exact local-name inventory for
`NO_SIGNAL_UNRECOGNIZED_STANDARD_PROFILE` (6) and
`NO_SIGNAL_UNRECOGNIZED_VENDOR_EXTENSION` (413) from shadow `31198098934`.
No resolver / trust / publication changes.

Retained forensic fields (count-only):

- `STANDARD_ROOT_INVENTORY[]` — `{ localName, count }` (sum must equal 6 on feed)
- `VENDOR_ROOT_INVENTORY[]` — `{ localName, count }` (sum must equal 413 on feed)
- `VENDOR_CLASS_*` — classification totals (sum must equal 413)

### Documentation references (authoritative)

| Profile / root | STANDARD_OR_VENDOR | LOCATION_SEMANTICS | Docs |
| --- | --- | --- | --- |
| `alertCArea` | STANDARD | Alert-C area LCD | https://docs.datex2.eu/levels/mastering/location/alertc/ |
| `linearLocation` | STANDARD | DATEX linear container (needs nested method) | https://docs.datex2.eu/levels/mastering/location/ |
| `pointLocation` | STANDARD | DATEX point container | https://docs.datex2.eu/levels/mastering/location/ |
| `areaLocation` | STANDARD | DATEX area container | https://docs.datex2.eu/levels/mastering/location/ |
| `tpegPointLocation` / `tpegLinearLocation` / `tpegAreaLocation` / `tpegFramedPoint` | STANDARD | TPEG location package | DATEX II Location referencing / TPEG |
| `itinerary` / `itineraryByReference` | STANDARD | multi-point itinerary | DATEX II Location |
| `groupOfLocationsExtension` / `locationExtension` | STANDARD extension type | DATEX extension wrapper | DATEX II Location package XSD |
| NDIC / ŘSD `ndic*` / `rsd*` / `cze*` roots | VENDOR | vendor-specific | NDIC DATEX profile (ŘSD) |

### Safety policy for next cycle (not implemented here)

- SAFE_TO_IMPLEMENT only if documentation + current local reference data suffice
  **without** heuristic / fuzzy / geocode.
- LOCATIONCODES-only LCD and incomplete supplementary remain fail-closed.
- Exact 6 standard names and 413 vendor class split are confirmed only by the
  authorized Cycle 3 network shadow (inventory counters).
