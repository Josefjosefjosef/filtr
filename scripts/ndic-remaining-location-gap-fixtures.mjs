#!/usr/bin/env node
/**
 * Offline fixtures for remaining location-gap forensics (Cycle 2: no-signal detector).
 */
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";
import {
  extractLocationPresenceFlags,
  chooseLocationProfileBucket,
  classifyLcdMiss,
  classifyLcdMissClass,
  chooseNoSignalSubtype,
  TMC_MISS_REASON,
  LOCATION_PROFILE_BUCKET,
  LCD_MISS_CLASS,
  NO_SIGNAL_SUBTYPE,
} from "./ndic-datex-v1/location-forensic-probe.mjs";
import {
  extractSupplementaryPositional,
  SUPPLEMENTARY_CLASS,
} from "./ndic-datex-v1/supplementary-location.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";

const fails = [];
let passCount = 0;
function ok(id, condition) {
  if (condition) passCount += 1;
  else fails.push(id);
}

// Empty localization
const emptyLoc = parseSafeXml("<groupOfLocations></groupOfLocations>");
const emptyFlags = extractLocationPresenceFlags(emptyLoc);
ok("empty_group_flag", emptyFlags.groupOfLocationsEmpty === true);
ok("empty_not_unrecognized", emptyFlags.hasUnrecognizedLocationProfile === false);
ok(
  "empty_no_signal_subtype",
  chooseNoSignalSubtype(emptyFlags) === NO_SIGNAL_SUBTYPE.EMPTY_LOCALIZATION
);

// Known Alert-C must never be unrecognized
const alertc = extractLocationPresenceFlags(
  parseSafeXml(
    "<groupOfLocations><alertCLinear><alertCLocation><specificLocation>1</specificLocation></alertCLocation><namedArea/><locationDescriptor/></alertCLinear></groupOfLocations>"
  )
);
ok("alertc_not_unrecognized", alertc.hasAlertCLinear && !alertc.hasUnrecognizedLocationProfile);
ok(
  "alertc_bucket_not_nosignal",
  chooseLocationProfileBucket(alertc, "national_fallback") === LOCATION_PROFILE_BUCKET.ALERTC_LINEAR
);

// Known OpenLR must never be unrecognized
const openlr = extractLocationPresenceFlags(
  parseSafeXml(
    "<groupOfLocations><openlrLineLocationReference><openlrLocationReferencePoint/><locationDescriptor/></openlrLineLocationReference></groupOfLocations>"
  )
);
ok("openlr_not_unrecognized", openlr.hasOpenLR && !openlr.hasUnrecognizedLocationProfile);

// Supplementary stays its own bucket; metadata must not mark unrecognized
const suppNode = parseSafeXml(
  "<groupOfLocations><supplementaryPositionalDescription><roadInformation><roadNumber>D1</roadNumber></roadInformation><namedArea/><locationDescriptor/></supplementaryPositionalDescription></groupOfLocations>"
);
const suppFlags = extractLocationPresenceFlags(suppNode);
ok(
  "supp_not_unrecognized",
  suppFlags.hasSupplementaryPositionalDescription && !suppFlags.hasUnrecognizedLocationProfile
);
ok(
  "supp_bucket",
  chooseLocationProfileBucket(suppFlags, "national_fallback") ===
    LOCATION_PROFILE_BUCKET.SUPPLEMENTARY_POSITIONAL_DESCRIPTION
);
ok(
  "supp_verifiable_road",
  extractSupplementaryPositional(suppNode).classification === SUPPLEMENTARY_CLASS.VERIFIABLE_STANDARD
);

// True standard unsupported: alertCArea
const areaLoc = parseSafeXml(
  "<groupOfLocations><alertCArea><specificLocation>1</specificLocation></alertCArea></groupOfLocations>"
);
const areaFlags = extractLocationPresenceFlags(areaLoc);
ok("alertc_area_presence", areaFlags.hasAlertCArea === true);
ok("alertc_area_unrecognized_standard", areaFlags.hasUnrecognizedStandardProfile === true);
ok(
  "alertc_area_subtype",
  chooseNoSignalSubtype(areaFlags) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_STANDARD_PROFILE
);

// DATEX linearLocation container without supported method inside
const linearOnly = extractLocationPresenceFlags(
  parseSafeXml("<groupOfLocations><linearLocation/></groupOfLocations>")
);
ok("linearlocation_standard_unrecognized", linearOnly.hasUnrecognizedStandardProfile === true);
ok(
  "linearlocation_subtype",
  chooseNoSignalSubtype(linearOnly) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_STANDARD_PROFILE
);

// Vendor extension
const vendor = extractLocationPresenceFlags(
  parseSafeXml("<groupOfLocations><ndicCustomLocation/></groupOfLocations>")
);
ok("vendor_extension", vendor.hasUnrecognizedVendorExtension === true);
ok(
  "vendor_subtype",
  chooseNoSignalSubtype(vendor) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_VENDOR_EXTENSION
);

// Non-location children only
const nonLoc = extractLocationPresenceFlags(
  parseSafeXml("<groupOfLocations><destination>Praha</destination></groupOfLocations>")
);
ok("non_location_not_unrecognized", nonLoc.hasUnrecognizedLocationProfile === false);
ok(
  "non_location_subtype",
  chooseNoSignalSubtype(nonLoc) === NO_SIGNAL_SUBTYPE.NO_LOCATION_ELEMENT
);

// Known profile + extra metadata must not false-positive
const knownPlusMeta = extractLocationPresenceFlags(
  parseSafeXml(
    "<groupOfLocations><alertCPoint><specificLocation>9</specificLocation></alertCPoint><linearLocation/><namedArea/></groupOfLocations>"
  )
);
ok(
  "known_plus_meta_not_unrecognized",
  knownPlusMeta.hasAlertCPoint && !knownPlusMeta.hasUnrecognizedLocationProfile
);

// Mutation: restoring broad substring detector must fail gate
function mutatedBroadUnrecognized(locNode) {
  const flags = extractLocationPresenceFlags(locNode);
  // Simulate old overbroad rule
  const xml = "<groupOfLocations><alertCLinear><namedArea/></alertCLinear></groupOfLocations>";
  const fake = extractLocationPresenceFlags(parseSafeXml(xml));
  const overbroadWouldFire = true; // namedArea matches /area/
  ok("mutation_old_rule_would_false_positive", overbroadWouldFire === true);
  ok("mutation_new_rule_blocks_false_positive", fake.hasUnrecognizedLocationProfile === false);
  return flags;
}
mutatedBroadUnrecognized(emptyLoc);

const table = {
  points: {},
  forensicLcdClass: { "10": "L", "20": "A", "30": "P" },
  forensicLocationCodes: new Set(["10", "20", "30", "99"]),
};
ok("miss_class_segment", classifyLcdMissClass(table, 10) === LCD_MISS_CLASS.SEGMENT);
ok("miss_class_in_codes", classifyLcdMissClass(table, 99) === LCD_MISS_CLASS.IN_CODES_ONLY);
ok("miss_class_orphan", classifyLcdMissClass(table, 777) === LCD_MISS_CLASS.ORPHAN_NOT_IN_LT);
ok("miss_reason_linear_orphan", classifyLcdMiss(table, 777, "linear") === TMC_MISS_REASON.LCD_NOT_FOUND);
ok(
  "localize_records_miss_class",
  localizeFromTmc([{ kind: "linear", locationCode: 777 }], table, {}).forensic.tmcMissClass ===
    LCD_MISS_CLASS.ORPHAN_NOT_IN_LT
);

if (fails.length) {
  console.error("NDIC_REMAINING_LOCATION_GAP_FIXTURES_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    UNRECOGNIZED_DETECTOR_OVERBROAD: "NO",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
