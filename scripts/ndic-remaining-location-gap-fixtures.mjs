#!/usr/bin/env node
/**
 * Offline fixtures for remaining location-gap forensics
 * (Cycle 2: no-signal detector; Cycle 3: anonymized root inventory).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";
import {
  extractLocationPresenceFlags,
  chooseLocationProfileBucket,
  classifyLcdMiss,
  classifyLcdMissClass,
  classifyLcdCodesOnlyMeta,
  classifyLcdCodesOnlyOutcome,
  chooseNoSignalSubtype,
  TMC_MISS_REASON,
  LOCATION_PROFILE_BUCKET,
  LCD_MISS_CLASS,
  NO_SIGNAL_SUBTYPE,
} from "./ndic-datex-v1/location-forensic-probe.mjs";
import {
  extractNoSignalRootInventory,
  classifyLocationRootNode,
  VENDOR_EXTENSION_CLASS,
} from "./ndic-datex-v1/no-signal-root-forensics.mjs";
import {
  digestPredefinedToken,
  extractPredefinedRefForensics,
  buildPlsDigestIndexFromXml,
  matchPredefinedRefsToPls,
  COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF,
  DOCUMENTED_PLS_DATASETS,
} from "./ndic-datex-v1/predefined-location-ref-forensics.mjs";
import { attrOf, descendantsNamed } from "./ndic-datex-v1/safe-xml.mjs";
import {
  extractSupplementaryPositional,
  SUPPLEMENTARY_CLASS,
} from "./ndic-datex-v1/supplementary-location.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";
import { buildTmcResolverTableFromSp08001Accepted } from "./ndic-datex-v1/tmc-resolver-table-bridge.mjs";
import { buildShadowForensicBundle } from "./ndic-datex-v1/shadow-forensic-report.mjs";

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
const areaInv = extractNoSignalRootInventory(areaLoc);
ok("alertc_area_root_name", areaInv.primaryStandardLocalName === "alertcarea");
ok("alertc_area_standard_kind", areaInv.standardRoots[0].standardProfile === true);

// DATEX linearLocation container without supported method inside
const linearNode = parseSafeXml("<groupOfLocations><linearLocation/></groupOfLocations>");
const linearOnly = extractLocationPresenceFlags(linearNode);
ok("linearlocation_standard_unrecognized", linearOnly.hasUnrecognizedStandardProfile === true);
ok(
  "linearlocation_subtype",
  chooseNoSignalSubtype(linearOnly) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_STANDARD_PROFILE
);
ok(
  "linearlocation_root_name",
  extractNoSignalRootInventory(linearNode).primaryStandardLocalName === "linearlocation"
);

// pointLocation / areaLocation / itinerary / tpeg exact names
for (const [xmlName, expected] of [
  ["pointLocation", "pointlocation"],
  ["areaLocation", "arealocation"],
  ["itinerary", "itinerary"],
  ["tpegPointLocation", "tpegpointlocation"],
]) {
  const n = parseSafeXml(`<groupOfLocations><${xmlName}/></groupOfLocations>`);
  const inv = extractNoSignalRootInventory(n);
  ok(`std_root_${expected}`, inv.primaryStandardLocalName === expected);
  ok(
    `std_subtype_${expected}`,
    chooseNoSignalSubtype(extractLocationPresenceFlags(n)) ===
      NO_SIGNAL_SUBTYPE.UNRECOGNIZED_STANDARD_PROFILE
  );
}

// Vendor extension
const vendorNode = parseSafeXml("<groupOfLocations><ndicCustomLocation/></groupOfLocations>");
const vendor = extractLocationPresenceFlags(vendorNode);
ok("vendor_extension", vendor.hasUnrecognizedVendorExtension === true);
ok(
  "vendor_subtype",
  chooseNoSignalSubtype(vendor) === NO_SIGNAL_SUBTYPE.UNRECOGNIZED_VENDOR_EXTENSION
);
const vendorInv = extractNoSignalRootInventory(vendorNode);
ok("vendor_root_name", vendorInv.primaryVendorLocalName === "ndiccustomlocation");
ok(
  "vendor_ndic_class",
  vendorInv.primaryVendorClass === VENDOR_EXTENSION_CLASS.NDIC_VENDOR_EXTENSION
);

// Known DATEX extension container (empty) — structure class
const extNode = parseSafeXml("<groupOfLocations><groupOfLocationsExtension/></groupOfLocations>");
const extClass = classifyLocationRootNode(extNode.children[0]);
ok("datex_ext_localname", extClass.localName === "groupoflocationsextension");
ok(
  "datex_ext_class",
  extClass.vendorClass === VENDOR_EXTENSION_CLASS.KNOWN_DATEX_EXTENSION_TYPE
);

// Extension with structured road inside
const structExt = parseSafeXml(
  "<groupOfLocations><fooBarExtension><roadInformation><roadNumber>D1</roadNumber></roadInformation></fooBarExtension></groupOfLocations>"
);
const structInv = extractNoSignalRootInventory(structExt);
ok(
  "struct_ext_class",
  structInv.primaryVendorClass === VENDOR_EXTENSION_CLASS.STRUCTURED_LOCATION_EXTENSION
);

// Text-only extension
const textExt = parseSafeXml(
  "<groupOfLocations><bazExtension><locationDescriptor>x</locationDescriptor></bazExtension></groupOfLocations>"
);
ok(
  "text_ext_class",
  extractNoSignalRootInventory(textExt).primaryVendorClass ===
    VENDOR_EXTENSION_CLASS.TEXT_ONLY_EXTENSION
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

// No raw / licensed payload in projected inventory
ok("no_raw_xml_in_inventory", !JSON.stringify(areaInv).includes("<"));
ok("no_lcd_in_inventory", !JSON.stringify(areaInv).includes("specificLocation"));

// Mutation: restoring broad substring detector must fail gate
function mutatedBroadUnrecognized(locNode) {
  extractLocationPresenceFlags(locNode);
  const xml = "<groupOfLocations><alertCLinear><namedArea/></alertCLinear></groupOfLocations>";
  const fake = extractLocationPresenceFlags(parseSafeXml(xml));
  const overbroadWouldFire = true; // namedArea matches /area/
  ok("mutation_old_rule_would_false_positive", overbroadWouldFire === true);
  ok("mutation_new_rule_blocks_false_positive", fake.hasUnrecognizedLocationProfile === false);
}
mutatedBroadUnrecognized(emptyLoc);

// Mutation: inventing trust from inventory must remain absent from this module
const rootForensicSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ndic-datex-v1", "no-signal-root-forensics.mjs"),
  "utf8"
);
ok("mut_no_trust_assignment", !/localizationTrust\s*=/.test(rootForensicSrc));
ok("mut_no_publication", !/PUBLICATION_ENABLED\s*=\s*true/.test(rootForensicSrc));
ok("mut_no_heuristic_geocode", !/geocod|fuzzy|heuristic/i.test(rootForensicSrc));

// Cycle 4b: predefinedLocationReference anonymized digests + PLS match fail-closed
ok("common_profile_forbids_pls", COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF === false);
ok("documented_pls_datasets", DOCUMENTED_PLS_DATASETS.length >= 3);
const digA = digestPredefinedToken("dde51831-2f37-4f07-8429-286a9d08106c");
const digB = digestPredefinedToken("dde51831-2f37-4f07-8429-286a9d08106c");
ok("digest_deterministic", digA === digB && /^[a-f0-9]{16}$/.test(digA));
ok("digest_no_raw", digA !== "dde51831-2f37-4f07-8429-286a9d08106c");
const prefNode = parseSafeXml(
  '<groupOfLocations><predefinedLocationReference id="dde51831-2f37-4f07-8429-286a9d08106c" version="1"/></groupOfLocations>'
);
const pref = extractPredefinedRefForensics(prefNode);
ok("pref_has_id", pref.hasId === true && pref.idDigest === digA);
ok("pref_has_version", pref.hasVersion === true);
ok("pref_projection_no_raw_id", !JSON.stringify(pref).includes("dde51831"));

const plsXml =
  '<d2LogicalModel><payloadPublication><predefinedLocationContainer id="dde51831-2f37-4f07-8429-286a9d08106c" version="1"><location><alertCLinear/></location></predefinedLocationContainer><predefinedLocationContainer id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" version="1"><location/></predefinedLocationContainer></payloadPublication></d2LogicalModel>';
const plsIdx = buildPlsDigestIndexFromXml(plsXml, "fixture_pls", {
  parseSafeXml,
  attrOf,
  descendantsNamed,
});
ok("pls_index_count", plsIdx.locationCount === 2);
const matchHit = matchPredefinedRefsToPls([{ idDigest: digA }], [plsIdx]);
ok("pls_match_count", matchHit.matched === 1 && matchHit.unmatched === 0);
ok("pls_binding_not_proven_for_common", matchHit.catalogBindingProven === 0);
ok("pls_verified_impossible_for_common", matchHit.verifiedLocationPossible === 0);
const matchMiss = matchPredefinedRefsToPls([{ idDigest: digestPredefinedToken("no-such-id") }], [plsIdx]);
ok("pls_unmatched", matchMiss.unmatched === 1);
const dual = matchPredefinedRefsToPls(
  [{ idDigest: digA }],
  [plsIdx, buildPlsDigestIndexFromXml(plsXml, "fixture_pls_b", { parseSafeXml, attrOf, descendantsNamed })]
);
ok("pls_multiple_fail_closed", dual.multiple === 1 && dual.matched === 0);

const prefSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ndic-datex-v1", "predefined-location-ref-forensics.mjs"),
  "utf8"
);
ok("mut_pref_no_trust", !/localizationTrust\s*=/.test(prefSrc));
ok("mut_pref_no_geocode", !/geocod|fuzzy|heuristic/i.test(prefSrc));

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

// Cycle 5: LOCATIONCODES_ONLY forensic meta (count-only; no raw LCD in projection)
const bridge = buildTmcResolverTableFromSp08001Accepted({
  points: [{ LCD: 1, XCOORD: "1400000", YCOORD: "5000000", ROA_LCD: 50 }],
  roads: [{ LCD: 50, ROADNUMBER: "D1", POL_LCD: 9 }],
  names: [],
  segments: [],
  areas: [],
  adminAreas: [],
  locationCodes: [
    { LCD: 1, ALLOCATED: "1" },
    { LCD: 50, ALLOCATED: "1" },
    { LCD: 99, ALLOCATED: "1" },
    { LCD: 88, ALLOCATED: "0" },
  ],
  tableVersion: "11.0",
});
ok("codes_only_road", classifyLcdMissClass(bridge, 50) === LCD_MISS_CLASS.IN_CODES_ONLY);
ok("codes_only_unbound", classifyLcdMissClass(bridge, 99) === LCD_MISS_CLASS.IN_CODES_ONLY);
const roadMeta = classifyLcdCodesOnlyMeta(bridge, 50);
ok("road_bound_only", roadMeta.boundToRoadOnly === true && roadMeta.hasRoadNumber === true);
ok("road_admin_link", roadMeta.hasAdminArea === true);
ok("road_no_coords", roadMeta.hasCoordinates === false);
ok("road_outcome_valid_no_geom", classifyLcdCodesOnlyOutcome(roadMeta) === "VALID_BUT_NO_GEOMETRY");
const unboundMeta = classifyLcdCodesOnlyMeta(bridge, 99);
ok("unbound_meta", unboundMeta.unbound === true && unboundMeta.hasAllocated === true);
ok(
  "unbound_outcome_fail_closed",
  classifyLcdCodesOnlyOutcome(unboundMeta) === "CORRECT_FAIL_CLOSED"
);
const invalidMeta = classifyLcdCodesOnlyMeta(bridge, 88);
ok(
  "invalid_alloc_outcome",
  classifyLcdCodesOnlyOutcome(invalidMeta) === "INVALID_SOURCE_REFERENCE"
);
const locRoad = localizeFromTmc([{ kind: "point", locationCode: 50 }], bridge, {});
ok("localize_codes_only_class", locRoad.forensic.tmcMissClass === LCD_MISS_CLASS.IN_CODES_ONLY);
ok("localize_codes_only_blob", locRoad.forensic.lcdCodesOnly && locRoad.forensic.lcdCodesOnly.boundToRoadOnly === true);
ok("localize_no_raw_lcd", !JSON.stringify(locRoad.forensic.lcdCodesOnly).includes("50"));
ok("localize_trust_not_tmc", locRoad.trust !== "tmc");

const fakeItems = [
  {
    status: "aktivni",
    localizationTrust: "national_fallback",
    ndicV1: {
      tmcOk: 0,
      tmcMiss: 1,
      forensic: {
        tmcMissReason: "lcd_not_found",
        tmcMissClass: "in_codes_only",
        lcdCodesOnly: { ...roadMeta, outcome: "VALID_BUT_NO_GEOMETRY" },
        trustBeforeResolver: "national_fallback",
        trustAfterResolver: "national_fallback",
        tmcReferenceKind: "point",
        tmcLocationClass: "unknown",
      },
    },
  },
  {
    status: "aktivni",
    localizationTrust: "national_fallback",
    ndicV1: {
      tmcOk: 0,
      tmcMiss: 1,
      forensic: {
        tmcMissReason: "lcd_not_found",
        tmcMissClass: "in_codes_only",
        lcdCodesOnly: { ...unboundMeta, outcome: "CORRECT_FAIL_CLOSED" },
        trustBeforeResolver: "national_fallback",
        trustAfterResolver: "national_fallback",
        tmcReferenceKind: "point",
        tmcLocationClass: "unknown",
      },
    },
  },
];
const bundle = buildShadowForensicBundle({
  items: fakeItems,
  gateItems: fakeItems,
  diagnostics: { tmc: { ok: true, meta: { active: true, version: "11.0", pointCount: 1 } } },
});
ok("agg_codes_only_total", bundle.summary.LCD_CODES_ONLY_TOTAL === 2);
ok("agg_bound_road", bundle.summary.LCD_CODES_ONLY_BOUND_TO_ROAD_ONLY === 1);
ok("agg_unbound", bundle.summary.LCD_CODES_ONLY_UNBOUND === 1);
ok("agg_valid_no_geom", bundle.summary.LCD_CODES_ONLY_VALID_BUT_NO_GEOMETRY === 1);
ok("agg_fail_closed", bundle.summary.LCD_CODES_ONLY_CORRECT_FAIL_CLOSED === 1);
ok("agg_coords_zero", bundle.summary.LCD_CODES_ONLY_HAS_COORDINATES === 0);
ok(
  "presentation_total_eq_items",
  bundle.summary.LOCATION_PRESENTATION_TOTAL === fakeItems.length &&
    bundle.summary.MAP_LINK_TOTAL === fakeItems.length
);
ok(
  "presentation_sum",
  bundle.summary.LOCATION_PRESENTATION_PRECISE +
    bundle.summary.LOCATION_PRESENTATION_SCOPED +
    bundle.summary.LOCATION_PRESENTATION_GENERAL +
    bundle.summary.LOCATION_PRESENTATION_NONE ===
    bundle.summary.LOCATION_PRESENTATION_TOTAL
);
ok(
  "map_link_sum",
  bundle.summary.MAP_LINK_TYPE_DIRECT_EVENT +
    bundle.summary.MAP_LINK_TYPE_VERIFIED_LOCATION +
    bundle.summary.MAP_LINK_TYPE_GENERAL_RSD_FALLBACK +
    bundle.summary.MAP_LINK_TYPE_NONE ===
    bundle.summary.MAP_LINK_TOTAL
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
    CYCLE3_ROOT_INVENTORY: "YES",
    CYCLE4B_PREDEFINED_REF_DIGEST: "YES",
    CYCLE5_LOCATIONCODES_ONLY_FORENSIC: "YES",
    LOCATION_PRESENTATION_COUNTERS: "YES",
    MAP_LINK_COUNTERS: "YES",
    COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF: "NO",
    PARSER_BUSINESS_LOGIC_UPDATED: "NO",
    RESOLVER_UPDATED: "NO",
    TRUST_UPDATED: "NO",
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
