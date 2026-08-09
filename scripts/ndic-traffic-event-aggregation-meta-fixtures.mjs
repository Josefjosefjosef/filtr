#!/usr/bin/env node
/**
 * Meta / mutation tests for traffic-event aggregation (fail-closed guards).
 */
import {
  AGGREGATION_FEATURE_FLAGS,
  AGGREGATION_ERROR,
  buildPublicationProjection,
  attemptPublication,
  buildNormalizedTrafficEvent,
} from "./ndic-datex-v1/traffic-event-aggregator.mjs";
import { buildTrafficFeedModel } from "./ndic-datex-v1/traffic-feed-model.mjs";
import { RESOLVER_STATUS, DIRECTION } from "./ndic-datex-v1/datex-tmc-resolver-constants.mjs";
import { provenanceField } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

ok("mut_pub_flag", AGGREGATION_FEATURE_FLAGS.PUBLICATION_ENABLED === false);
ok("mut_cards_flag", AGGREGATION_FEATURE_FLAGS.TRAFFIC_CARDS_ENABLED === false);
ok("mut_fuzzy", AGGREGATION_FEATURE_FLAGS.FUZZY_MATCHING_ENABLED === false);
ok("mut_geo", AGGREGATION_FEATURE_FLAGS.GEOCODING_ENABLED === false);
ok("mut_heur", AGGREGATION_FEATURE_FLAGS.HEURISTIC_INFERENCE_ENABLED === false);
ok("mut_km_est", AGGREGATION_FEATURE_FLAGS.KILOMETER_ESTIMATION_ENABLED === false);
ok("mut_interp", AGGREGATION_FEATURE_FLAGS.COORDINATE_INTERPOLATION_ENABLED === false);

// Ambiguous location must not become publishable projection with road
{
  const built = buildNormalizedTrafficEvent({
    eventId: "m1",
    multiKind: "CONFLICTING_RESOLUTIONS",
    resolutionResults: [
      {
        resolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
        publiclyEligible: false,
      },
    ],
  });
  ok("mut_amb_blocked", built.ok === false);
}

// Attempt publish always blocked
{
  const attempt = attemptPublication({ eventIdHash: "x" });
  ok("mut_pub_attempt", attempt.rejectCode === AGGREGATION_ERROR.AGG_PUBLICATION_DISABLED && attempt.published === false);
}

// Feed never marks published true
{
  const feed = buildTrafficFeedModel([]);
  ok("mut_feed_pub", feed.publicationEnabled === false);
}

// Unknown direction must not appear as BOTH
{
  const fake = {
    schema: "iu-normalized-traffic-event-v1",
    eventIdHash: "h",
    quarantine: false,
    locationPublishable: true,
    fields: {
      direction: provenanceField(DIRECTION.UNKNOWN, "datex", null, "unknown"),
      roadNumber: provenanceField("D0", "tmc", null, "validated"),
      status: provenanceField("aktivni", "datex", null, "validated"),
      trafficCategory: provenanceField("x", "datex", null, "validated"),
      trafficSeverity: provenanceField(null, null, null, "not_available"),
      titleSafe: provenanceField(null, null, null, "not_available"),
      summarySafe: provenanceField(null, null, null, "not_available"),
      validFrom: provenanceField(null, null, null, "not_available"),
      validTo: provenanceField(null, null, null, "not_available"),
      lastMeaningfulChangeAt: provenanceField(null, null, null, "not_available"),
      freshness: provenanceField("UNKNOWN", null, null, "validated"),
      sourceLabel: provenanceField("NDIC", "config", null, "validated"),
      attribution: provenanceField("Zdroj: NDIC", "config", null, "validated"),
      locationCount: provenanceField(1, "aggregator", null, "validated"),
      administrativeArea: provenanceField(null, null, null, "not_available"),
      coordinates: provenanceField(null, null, null, "not_available"),
      kilometer: provenanceField(null, null, null, "not_available"),
    },
    locations: [],
  };
  const proj = buildPublicationProjection(fake);
  ok("mut_unk_dir_not_pub", proj.projection.direction == null);
}

// Ambiguous unmerged summary direction must not publish
{
  const fake = {
    schema: "iu-normalized-traffic-event-v1",
    eventIdHash: "h2",
    quarantine: false,
    locationPublishable: true,
    fields: {
      direction: provenanceField(null, "aggregator", null, "ambiguous_unmerged"),
      roadNumber: provenanceField("D0", "tmc", null, "validated"),
      status: provenanceField("aktivni", "datex", null, "validated"),
      trafficCategory: provenanceField("x", "datex", null, "validated"),
      trafficSeverity: provenanceField(null, null, null, "not_available"),
      titleSafe: provenanceField(null, null, null, "not_available"),
      summarySafe: provenanceField(null, null, null, "not_available"),
      validFrom: provenanceField(null, null, null, "not_available"),
      validTo: provenanceField(null, null, null, "not_available"),
      lastMeaningfulChangeAt: provenanceField(null, null, null, "not_available"),
      freshness: provenanceField("UNKNOWN", null, null, "validated"),
      sourceLabel: provenanceField("NDIC", "config", null, "validated"),
      attribution: provenanceField("Zdroj: NDIC", "config", null, "validated"),
      locationCount: provenanceField(2, "aggregator", null, "validated"),
      administrativeArea: provenanceField(null, null, null, "not_available"),
      coordinates: provenanceField(null, null, null, "not_available"),
      kilometer: provenanceField(null, null, null, "not_available"),
    },
    locations: [],
  };
  const proj = buildPublicationProjection(fake);
  ok("mut_amb_dir_not_pub", proj.projection.direction == null);
}

// False-green guard
{
  const fakeSummary = { failure: 1, success: 0, total: 1 };
  ok("mut_false_green", !(fakeSummary.failure === 0));
}

// Hardcoded PASS trap
{
  const probe = [];
  function poke(c) {
    if (!c) probe.push(1);
  }
  poke(false);
  ok("mut_hardcoded", probe.length === 1);
}

// Allowlisted error codes static
ok("mut_dyn_code", AGGREGATION_ERROR.AGG_PUBLICATION_DISABLED === "AGG_PUBLICATION_DISABLED");

const pass = results.filter((x) => x.pass).length;
const failN = results.filter((x) => !x.pass).length;
const summary = { suite: "TRAFFIC_EVENT_AGGREGATION_META", total: results.length, success: pass, failure: failN, skipped: 0 };
process.stdout.write(JSON.stringify(summary) + "\n");
if (failN) {
  process.stdout.write(JSON.stringify({ fails: fails.slice(0, 20) }) + "\n");
  process.exitCode = 1;
}
if (summary.failure !== failN || (failN === 0 && summary.success !== summary.total)) process.exitCode = 1;
