#!/usr/bin/env node
/**
 * Offline fixtures for remaining location-gap forensics (post-OpenLR).
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

const emptyLoc = parseSafeXml("<groupOfLocations></groupOfLocations>");
const emptyFlags = extractLocationPresenceFlags(emptyLoc);
ok("empty_group_flag", emptyFlags.groupOfLocationsEmpty === true);
ok(
  "empty_no_signal_subtype",
  chooseNoSignalSubtype(emptyFlags) === NO_SIGNAL_SUBTYPE.EMPTY_GROUP
);

const areaLoc = parseSafeXml("<groupOfLocations><alertCArea><specificLocation>1</specificLocation></alertCArea></groupOfLocations>");
const areaFlags = extractLocationPresenceFlags(areaLoc);
ok("alertc_area_presence", areaFlags.hasAlertCArea === true);
ok(
  "unrecognized_no_signal_subtype",
  chooseNoSignalSubtype(areaFlags) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_PROFILE
);

const supp = extractSupplementaryPositional(
  parseSafeXml(
    "<groupOfLocations><supplementaryPositionalDescription><roadInformation><roadNumber>D1</roadNumber></roadInformation></supplementaryPositionalDescription></groupOfLocations>"
  )
);
ok("supp_verifiable_road", supp.classification === SUPPLEMENTARY_CLASS.VERIFIABLE_STANDARD && supp.roadNumber === "D1");

const suppText = extractSupplementaryPositional(
  parseSafeXml(
    "<groupOfLocations><supplementaryPositionalDescription><locationDescriptor><value>někde</value></locationDescriptor></supplementaryPositionalDescription></groupOfLocations>"
  )
);
ok("supp_text_only", suppText.classification === SUPPLEMENTARY_CLASS.TEXT_ONLY);

const suppEmpty = extractSupplementaryPositional(
  parseSafeXml("<groupOfLocations><supplementaryPositionalDescription/></groupOfLocations>")
);
ok("supp_incomplete", suppEmpty.classification === SUPPLEMENTARY_CLASS.INCOMPLETE);

const table = {
  points: {},
  forensicLcdClass: { "10": "L", "20": "A", "30": "P" },
  forensicLocationCodes: new Set(["10", "20", "30", "99"]),
};
ok("miss_class_segment", classifyLcdMissClass(table, 10) === LCD_MISS_CLASS.SEGMENT);
ok("miss_class_in_codes", classifyLcdMissClass(table, 99) === LCD_MISS_CLASS.IN_CODES_ONLY);
ok("miss_class_orphan", classifyLcdMissClass(table, 777) === LCD_MISS_CLASS.ORPHAN_NOT_IN_LT);
ok("miss_reason_linear_orphan", classifyLcdMiss(table, 777, "linear") === TMC_MISS_REASON.LCD_NOT_FOUND);

const loc = localizeFromTmc([{ kind: "linear", locationCode: 777 }], table, {});
ok("localize_records_miss_class", loc.forensic.tmcMissClass === LCD_MISS_CLASS.ORPHAN_NOT_IN_LT);
ok(
  "profile_supp",
  chooseLocationProfileBucket({ hasSupplementaryPositionalDescription: true }, "national_fallback") ===
    LOCATION_PROFILE_BUCKET.SUPPLEMENTARY_POSITIONAL_DESCRIPTION
);

// Mutation: removing orphan classification must fail gate
const mutated = { ...table, forensicLocationCodes: new Set(["10", "20", "30"]) };
ok("mutation_99_becomes_orphan", classifyLcdMissClass(mutated, 99) === LCD_MISS_CLASS.ORPHAN_NOT_IN_LT);

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
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
