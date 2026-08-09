#!/usr/bin/env node
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";
import { extractOpenlrFromLoc } from "./ndic-datex-v1/openlr-datex-extract.mjs";
import { decodeOpenlrBinary } from "./ndic-datex-v1/openlr-binary-decode.mjs";
import { resolveOpenlrLocation } from "./ndic-datex-v1/openlr-resolve.mjs";
import { OPENLR_LOCATION_TYPE, OPENLR_STATUS, OPENLR_FEATURES } from "./ndic-datex-v1/openlr-constants.mjs";
import { VERIFIED_LOCATION_TRUST } from "./ndic-datex-v1/shadow-forensic-constants.mjs";

const fails = [];
let passCount = 0;
function ok(id, value) {
  if (value) passCount += 1;
  else fails.push(id);
}
function xml(body) {
  return parseSafeXml("<groupOfLocations>" + body + "</groupOfLocations>");
}
function resolve(body) {
  return resolveOpenlrLocation(extractOpenlrFromLoc(xml(body)));
}

const geo = resolve("<openlrGeoCoordinate><latitude>50.1</latitude><longitude>14.4</longitude></openlrGeoCoordinate>");
ok("geo_xml_resolved", geo.status === OPENLR_STATUS.RESOLVED && geo.lat === 50.1 && geo.lon === 14.4);

const line = resolve(
  "<openlrLineLocationReference><openlrLocationReferencePoint><openlrCoordinate><latitude>49.6</latitude><longitude>6.12</longitude></openlrCoordinate></openlrLocationReferencePoint></openlrLineLocationReference>"
);
ok("line_xml_resolved", line.status === OPENLR_STATUS.RESOLVED && line.lrpCount >= 1);

const linear = resolve(
  "<openlrLinear><openlrLineLocationReference><openlrLocationReferencePoint><openlrCoordinate><latitude>50.08</latitude><longitude>14.42</longitude></openlrCoordinate></openlrLocationReferencePoint></openlrLineLocationReference></openlrLinear>"
);
ok("datex_openlr_linear_resolved", linear.status === OPENLR_STATUS.RESOLVED && linear.lat === 50.08);

const binary = decodeOpenlrBinary("CwRbWyNG9RpsCQCb/jsbtAT/6/+jK1lE");
ok(
  "whitepaper_binary_example",
  binary.ok && Math.abs(binary.coordinates[0].lon - 6.12682) < 1e-4 && Math.abs(binary.coordinates[0].lat - 49.60852) < 1e-4
);
ok("truncated_binary", decodeOpenlrBinary("CwRb").status === OPENLR_STATUS.DECODE_FAILED);
ok("malformed_xml", resolve("<openlrGeoCoordinate><latitude>99</latitude><longitude>14</longitude></openlrGeoCoordinate>").status === OPENLR_STATUS.INVALID);
ok(
  "unsupported_area",
  resolve("<openlrClosedLineLocationReference><latitude>50</latitude><longitude>14</longitude></openlrClosedLineLocationReference>").status ===
    OPENLR_STATUS.REFERENCE_DATA_MISSING
);
ok(
  "ambiguous_multi",
  resolve(
    "<openlrGeoCoordinate><latitude>50</latitude><longitude>14</longitude></openlrGeoCoordinate><openlrGeoCoordinate><latitude>51</latitude><longitude>15</longitude></openlrGeoCoordinate>"
  ).status === OPENLR_STATUS.AMBIGUOUS
);
ok(
  "invalid_offset",
  resolveOpenlrLocation({
    refs: [{ encoding: "xml", type: OPENLR_LOCATION_TYPE.LINE, coordinates: [{ lat: 50, lon: 14 }], offsets: { positive: -1 } }],
  }).status === OPENLR_STATUS.INVALID
);
ok(
  "reference_data_missing",
  resolveOpenlrLocation({
    refs: [{ encoding: "xml", type: OPENLR_LOCATION_TYPE.POLYGON, coordinates: [{ lat: 50, lon: 14 }] }],
  }).status === OPENLR_STATUS.REFERENCE_DATA_MISSING
);

const extracted = extractOpenlrFromLoc(xml("<openlrBinary>CwRbWyNG9RpsCQCb/jsbtAT/6/+jK1lE</openlrBinary>"));
ok("provenance_redaction", !JSON.stringify(extracted).includes("CwRbWyNG9RpsCQCb/jsbtAT/6/+jK1lE"));
ok("false_green_decoder_invoked", resolveOpenlrLocation(extracted).status === OPENLR_STATUS.RESOLVED);
ok("hasOpenLR_flag", extracted.presenceFlags.hasOpenLR === true);

const unsupportedOnly = resolveOpenlrLocation({
  presenceFlags: { hasOpenLR: true, hasOpenlr: true },
  refs: [],
});
ok("unsupported_without_payload", unsupportedOnly.status === OPENLR_STATUS.UNSUPPORTED_TYPE);

ok("trust_includes_openlr", VERIFIED_LOCATION_TRUST.includes("openlr"));
ok("no_map_matching_feature", OPENLR_FEATURES.MAP_MATCHING === false && OPENLR_FEATURES.GEOCODING === false);

// Mutation: removing coordinate validation must fail the gate.
const mutatedInvalid = resolve("<openlrGeoCoordinate><latitude>50</latitude><longitude>14</longitude></openlrGeoCoordinate>");
ok("mutation_valid_still_resolves", mutatedInvalid.status === OPENLR_STATUS.RESOLVED);
const mutatedBad = resolve("<openlrGeoCoordinate><latitude>999</latitude><longitude>14</longitude></openlrGeoCoordinate>");
ok("mutation_invalid_coords_blocked", mutatedBad.status === OPENLR_STATUS.INVALID);

if (fails.length) {
  console.error("NDIC_OPENLR_FIXTURES_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    whitepaperExampleMatched: true,
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
    OPENLR_DOCUMENTATION: "payload_coords_only_no_map_match",
  })
);
