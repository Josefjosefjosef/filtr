#!/usr/bin/env node
/**
 * Offline unit fixtures for location-forensic probes.
 * Proves diagnostics do not alter resolver business outcomes.
 */
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";
import {
  extractLocationPresenceFlags,
  chooseLocationProfileBucket,
  classifyLcdMiss,
  choosePrimaryTmcMissReason,
  TMC_MISS_REASON,
  LOCATION_PROFILE_BUCKET,
} from "./ndic-datex-v1/location-forensic-probe.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";

const fails = [];
let passCount = 0;
function ok(id, condition, detail) {
  if (condition) passCount += 1;
  else fails.push(id + (detail ? ":" + detail : ""));
}

const locationNode = parseSafeXml(`
  <groupOfLocations>
    <alertCPoint><specificLocation>1</specificLocation></alertCPoint>
    <alertCLinear><specificLocation>2</specificLocation></alertCLinear>
    <pointCoordinates><latitude>50</latitude><longitude>14</longitude></pointCoordinates>
    <openlrLinearLocationReference />
    <Point /><LineString /><Polygon />
    <networkLocation /><supplementaryPositionalDescription />
  </groupOfLocations>
`);
const presence = extractLocationPresenceFlags(locationNode);
ok(
  "presence_detects_all_profiles",
  presence.hasAlertCPoint &&
    presence.hasAlertCLinear &&
    presence.hasSpecificLocation &&
    presence.hasPointCoordinates &&
    presence.hasOpenLR &&
    presence.hasGmlPoint &&
    presence.hasGmlLineString &&
    presence.hasGmlPolygon &&
    presence.hasNetworkLocation &&
    presence.hasSupplementaryPositionalDescription
);
ok(
  "profile_priority_openlr",
  chooseLocationProfileBucket({ hasOpenLR: true, hasGmlPolygon: true }, "none") === LOCATION_PROFILE_BUCKET.OPENLR
);
ok(
  "profile_priority_gml_polygon",
  chooseLocationProfileBucket({ hasGmlPolygon: true, hasGmlLineString: true }, "none") ===
    LOCATION_PROFILE_BUCKET.GML_POLYGON
);
ok(
  "profile_text_only",
  chooseLocationProfileBucket({}, "text") === LOCATION_PROFILE_BUCKET.TEXT_ONLY
);
ok(
  "profile_no_signal",
  chooseLocationProfileBucket({}, "national_fallback") === LOCATION_PROFILE_BUCKET.NO_LOCALIZATION_SIGNAL
);

const indexedTable = { points: new Map(), forensicLcdClass: { "10": "L", "20": "A", "30": "P" } };
ok("miss_segment_classification", classifyLcdMiss(indexedTable, 10, "linear") === TMC_MISS_REASON.SEGMENT_LOOKUP_MISS);
ok("miss_area_classification", classifyLcdMiss(indexedTable, 20, "point") === TMC_MISS_REASON.AREA_LOOKUP_MISS);
ok("miss_point_classification", classifyLcdMiss(indexedTable, 30, "point") === TMC_MISS_REASON.POINT_LOOKUP_MISS);
ok(
  "miss_priority_cid",
  choosePrimaryTmcMissReason([TMC_MISS_REASON.LCD_NOT_FOUND, TMC_MISS_REASON.CID_MISMATCH]) ===
    TMC_MISS_REASON.CID_MISMATCH
);
ok(
  "miss_default_other",
  choosePrimaryTmcMissReason(["unknown"]) === TMC_MISS_REASON.OTHER
);

const refs = [{ kind: "point", locationCode: 30 }];
const withForensicIndex = localizeFromTmc(refs, indexedTable, { roadNumber: "D1" });
const withoutForensicIndex = localizeFromTmc(refs, { points: new Map() }, { roadNumber: "D1" });
ok(
  "localize_business_tmc_counts_identical",
  withForensicIndex.tmcOk === withoutForensicIndex.tmcOk && withForensicIndex.tmcMiss === withoutForensicIndex.tmcMiss
);
ok("localize_business_trust_identical", withForensicIndex.trust === withoutForensicIndex.trust);
ok(
  "localize_business_golden",
  withForensicIndex.tmcOk === 0 &&
    withForensicIndex.tmcMiss === 1 &&
    withForensicIndex.trust === "text" &&
    withoutForensicIndex.trust === "text"
);
ok(
  "localize_forensic_reason_only_diff",
  withForensicIndex.forensic.tmcMissReason === TMC_MISS_REASON.POINT_LOOKUP_MISS &&
    withoutForensicIndex.forensic.tmcMissReason === TMC_MISS_REASON.POINT_LOOKUP_MISS
);

if (fails.length) {
  console.error("NDIC_LOCATION_FORENSIC_PROBE_FIXTURES_FAIL");
  fails.forEach((failure) => console.error(failure));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, passCount, failCount: 0 }));
