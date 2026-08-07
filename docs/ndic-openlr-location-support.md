# NDIC DATEX OpenLR location support

NDIC DATEX II may carry OpenLR as XML (`OpenlrLinear` /
`OpenlrLineLocationReference` / `OpenlrPoint*` / `OpenlrGeoCoordinate` /
area types) and/or as physical binary Base64. The adapter resolves only
unambiguous WGS84 coordinates included in the source payload. For a line, the
first LRP is the documented representative coordinate; no road ID, kilometre,
direction label, locality, or map match is inferred.

Binary input is decoded in-process with no dependency and is immediately
discarded. The implementation supports coordinate-bearing line, geo point,
point-along-line, POI access, circle, and rectangle shapes. Closed lines,
grids, and polygons that require a network interpretation fail closed as
`OPENLR_REFERENCE_DATA_MISSING`; unknown shapes are
`OPENLR_UNSUPPORTED_TYPE`. Malformed or truncated data returns
`OPENLR_INVALID` or `OPENLR_DECODE_FAILED`.

The trust order is `coordinates > openlr > tmc > text > national_fallback`.
OpenLR can only upgrade the latter three levels, never overrides explicit
coordinates or TMC. `OPENLR_RESOLVED` requires finite WGS84 payload
coordinates; all other statuses block precise-location publication. Retained
forensic data is status and aggregate counts only—never Base64, XML, or raw
binary.

References:

- OpenLR White Paper v1.5 (TomTom / openlr.org), physical binary format and
  LRP coordinate encoding. The decoder follows the published demo-compatible
  signed-24 scale `360 / 2^24`; this is necessary for the demo value near
  6.12682, 49.60852.
- [DATEX II OpenLR location packages](https://docs.datex2.eu/levels/mastering/location/openlr/):
  `OpenlrPointLocationReference`, `OpenlrLineLocationReference`,
  `OpenlrGeoCoordinate`, `OpenlrLocationReferencePoint`, `OpenlrOffsets`,
  and `OpenlrArea*`.
- ISO/TS 21219-22, referenced by the DATEX II documentation.
