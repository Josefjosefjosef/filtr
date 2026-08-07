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

## Forensic extensions in this cycle

- Anonymous LCD miss class: `in_codes_only` | `orphan_not_in_lt` | P/L/A
- Supplementary subtype: verifiable_standard | text_only | incomplete
- No-signal subtype: empty_group | unrecognized_profile | other
- Presence for `alertCArea` / TPEG / itinerary (unsupported until decoded)
