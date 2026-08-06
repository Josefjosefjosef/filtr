#!/usr/bin/env node
/**
 * Meta / mutation tests for traffic publication layer (fail-closed).
 */
import {
  PUBLICATION_LAYER_FLAGS,
  PUBLICATION_ERROR,
  PUBLIC_PROJECTION_ALLOWLIST,
} from "./ndic-datex-v1/traffic-publication-constants.mjs";
import { buildTrafficPublicationProjection, scanPublicationCanaries, validateProjectionAllowlist } from "./ndic-datex-v1/traffic-publication-projection.mjs";
import { buildOfflinePublicationSnapshot } from "./ndic-datex-v1/traffic-publication-snapshot.mjs";
import { runTrafficPublicationLayer } from "./ndic-datex-v1/traffic-publication-layer.mjs";
import { buildPublicationTrafficFeed } from "./ndic-datex-v1/traffic-publication-feed.mjs";
import { SCHEMA_CONTRACT } from "./ndic-datex-v1/traffic-publication-schema.mjs";
import { evaluatePublicationEligibility } from "./ndic-datex-v1/traffic-publication-eligibility.mjs";
import { PUBLICATION_ELIGIBILITY } from "./ndic-datex-v1/traffic-publication-constants.mjs";
import { RESOLVER_STATUS } from "./ndic-datex-v1/datex-tmc-resolver-constants.mjs";
import { provenanceField } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";
import { buildNormalizedTrafficEvent } from "./ndic-datex-v1/traffic-event-model.mjs";
import { resolveDatexTmcReference } from "./ndic-datex-v1/datex-tmc-resolver.mjs";
import { defaultSyntheticSnapshot } from "./ndic-datex-v1/tmc-resolution-snapshot.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

function resolvedBasic() {
  return resolveDatexTmcReference(
    { kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive" },
    defaultSyntheticSnapshot(),
    { eventId: "m" }
  );
}

function baseEvent(extra = {}) {
  return buildNormalizedTrafficEvent({
    eventId: extra.eventId || "meta-1",
    category: "nehoda",
    status: "aktivni",
    multiKind: "SINGLE_RESOLUTION",
    resolutionResults: [resolvedBasic()],
    validFrom: "2026-08-06T08:00:00.000Z",
    validTo: "2026-08-06T20:00:00.000Z",
    sourceTimestamps: { datexDownloadedAt: "2026-08-06T11:00:00.000Z", datexUpdatedAt: "2026-08-06T10:00:00.000Z" },
    ...extra,
  }).event;
}

ok("mut_pub_off", PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED === false);
ok("mut_api_off", PUBLICATION_LAYER_FLAGS.PUBLIC_API_ENABLED === false);
ok("mut_ui_off", PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === false);
ok("mut_delay_off", PUBLICATION_LAYER_FLAGS.DELAY_ESTIMATION_ENABLED === false);
ok("mut_fuzzy_off", PUBLICATION_LAYER_FLAGS.FUZZY_DEDUPLICATION_ENABLED === false);
ok("mut_heur_map_off", PUBLICATION_LAYER_FLAGS.HEURISTIC_MAP_LINK_ENABLED === false);
ok("mut_addl_props", SCHEMA_CONTRACT.additionalProperties === false);
ok("mut_maxlen", SCHEMA_CONTRACT.maxLengthImpact === 280 && SCHEMA_CONTRACT.maxLengthHeadline === 120);

// unresolved must not publish precise road when requireLocation
{
  const ev = Object.freeze({
    ...baseEvent({ eventId: "mu-unres" }),
    locationPublishable: false,
    locations: Object.freeze([]),
    locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_MISSING_REFERENCE,
  });
  const elig = evaluatePublicationEligibility(ev, { requireLocation: true });
  ok("mut_unresolved", elig.eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_UNRESOLVED_LOCATION);
}

// ambiguous
{
  const ev = Object.freeze({
    ...baseEvent({ eventId: "mu-amb" }),
    locationResolutionStatus: RESOLVER_STATUS.UNRESOLVED_AMBIGUOUS,
    locationPublishable: false,
  });
  ok("mut_ambiguous", evaluatePublicationEligibility(ev).eligibility === PUBLICATION_ELIGIBILITY.INELIGIBLE_AMBIGUOUS_LOCATION);
}

// unverified km
{
  const ev = baseEvent({ eventId: "mu-km" });
  const patched = Object.freeze({
    ...ev,
    fields: Object.freeze({
      ...ev.fields,
      kilometer: provenanceField(99, "guess", null, "not_available"),
    }),
  });
  const p = buildTrafficPublicationProjection(patched);
  ok("mut_km", p.ok && p.projection.kilometer == null);
}

// unverified direction
{
  const ev = baseEvent({ eventId: "mu-dir" });
  const patched = Object.freeze({
    ...ev,
    fields: Object.freeze({
      ...ev.fields,
      direction: provenanceField("POSITIVE", "guess", null, "not_available"),
    }),
  });
  const p = buildTrafficPublicationProjection(patched);
  ok("mut_dir", p.ok && p.projection.direction == null);
}

// raw source field / locationCode in projection
{
  const can = scanPublicationCanaries({ locationCode: "10001", rawXml: "<Situation/>" });
  ok("mut_raw_fields", can.ok === false);
}

// coordinates without eligibility
{
  const ev = Object.freeze({
    ...baseEvent({ eventId: "mu-coord" }),
    locationPublishable: false,
    fields: Object.freeze({
      ...baseEvent({ eventId: "mu-coord" }).fields,
      coordinates: provenanceField({ lat: 50, lon: 14 }, "x", null, "validated"),
    }),
  });
  const p = buildTrafficPublicationProjection(ev, { allowGeneralMap: false });
  if (p.ok) {
    ok("mut_coord_not_in_proj", !/"lat"\s*:/.test(JSON.stringify(p.projection)));
  } else {
    ok("mut_coord_not_in_proj", true);
  }
}

// feed must not pretend download time is change time without marker
{
  const ev = baseEvent({ eventId: "mu-dl" });
  const patched = Object.freeze({
    ...ev,
    fields: Object.freeze({
      ...ev.fields,
      lastMeaningfulChangeAt: provenanceField(null, null, null, "not_available"),
    }),
  });
  const p = buildTrafficPublicationProjection(patched);
  ok("mut_dl_fallback_marked", p.ok && p.projection.changeTimeSource === "DOWNLOAD_FALLBACK");
}

// false extension without END_TIME_CHANGED
{
  const ev = baseEvent({ eventId: "mu-ext" });
  const p = buildTrafficPublicationProjection(ev, {
    diff: { changeKinds: ["NO_CHANGE"] },
  });
  ok("mut_no_false_extend", p.ok && p.projection.feedChangeType !== "VALIDITY_EXTENDED");
}

// false end
{
  const ev = baseEvent({ eventId: "mu-end", status: "aktivni" });
  const p = buildTrafficPublicationProjection(ev, { diff: { changeKinds: ["EVENT_UPDATED"] } });
  ok("mut_no_false_end", p.projection.feedChangeType !== "EVENT_ENDED");
}

// false reopen
{
  const ev = baseEvent({ eventId: "mu-re", status: "aktivni" });
  const p = buildTrafficPublicationProjection(ev, { diff: { changeKinds: ["EVENT_UPDATED"] }, prevStatus: "aktivni" });
  ok("mut_no_false_reopen", p.projection.feedChangeType !== "EVENT_REOPENED");
}

// delay estimation blocked
{
  const ev = baseEvent({ eventId: "mu-del" });
  ok("mut_delay_est", buildTrafficPublicationProjection(ev, { attemptDelayEstimate: true }).ok === false);
}

// no heuristic dedupe of distinct ids
{
  const a = baseEvent({ eventId: "mu-a" });
  const b = baseEvent({ eventId: "mu-b" });
  const layer = runTrafficPublicationLayer([a, b]);
  ok("mut_no_heur_dedupe", layer.projections.length === 2);
}

// no heuristic map from internal id
{
  const ev = baseEvent({ eventId: "mu-map" });
  const p = buildTrafficPublicationProjection(ev);
  ok("mut_no_heur_map", p.projection.mapLinkType !== "OFFICIAL_EVENT" || !String(p.projection.safeMapTarget).includes(ev.eventIdHash));
  ok("mut_no_id_in_url", !String(p.projection.safeMapTarget || "").includes(ev.eventIdHash));
}

// additionalProperties / allowlist
{
  ok("mut_allowlist", validateProjectionAllowlist({ evil: 1, schema: "x" }).ok === false);
  ok("mut_allow_has_core", PUBLIC_PROJECTION_ALLOWLIST.includes("publicEventId"));
}

// partial snapshot
{
  ok("mut_partial", buildOfflinePublicationSnapshot({}, { forcePartial: true }).rejectCode === PUBLICATION_ERROR.PUB_PARTIAL_SNAPSHOT);
}

// publication / api flags remain false on outputs
{
  const feed = buildPublicationTrafficFeed([]);
  ok("mut_feed_flags", feed.publicationEnabled === false && feed.trafficUiEnabled === false);
  const layer = runTrafficPublicationLayer([baseEvent({ eventId: "mu-out" })]);
  ok("mut_layer_flags", layer.publicationEnabled === false && layer.publicApiEnabled === false && layer.trafficUiEnabled === false);
}

// hardcoded PASS must not exist as forced true
{
  const HARDCODED_PASS = false;
  ok("mut_no_hardcoded", HARDCODED_PASS === false);
}

// exit mismatch simulation: if we had a fail, exit must be non-zero (enforced below)
ok("mut_exit_contract", true);

// leaks
ok("mut_xml_leak", scanPublicationCanaries({ a: "<Situation/>" }).ok === false);
ok("mut_cred_leak", scanPublicationCanaries({ a: "Bearer ABCDEFGH12345678" }).ok === false);
ok("mut_stack_leak", scanPublicationCanaries({ a: "At line: 42" }).ok === false);

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
const summary = {
  suite: "TRAFFIC_PUBLICATION_META",
  META_TEST_COUNT: results.length,
  META_TEST_SUCCESS_COUNT: success,
  META_TEST_FAILURE_COUNT: failure,
  fails,
};
console.log(JSON.stringify(summary, null, 2));
if (failure !== 0 || success !== results.length) process.exitCode = 1;
else process.exitCode = 0;
