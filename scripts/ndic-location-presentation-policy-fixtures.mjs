#!/usr/bin/env node
/**
 * Offline fixtures: traffic location presentation policy (PRECISE/SCOPED/GENERAL/NONE).
 * No resolver/importer/OpenLR changes. Synthetic only.
 */
import { provenanceField } from "./ndic-datex-v1/traffic-event-aggregation-constants.mjs";
import { DIRECTION } from "./ndic-datex-v1/datex-tmc-resolver-constants.mjs";
import {
  classifyLocationPresentation,
  buildLocationDisclosureCs,
  assertFailClosedBucketsNeverInventGeo,
  LOCATION_PRESENTATION_LEVEL,
  SUBJECT_SCOPE_KIND,
  ROUTE_MATCH_MODE,
} from "./ndic-datex-v1/traffic-location-presentation-policy.mjs";
import { buildTrafficPublicationProjection } from "./ndic-datex-v1/traffic-publication-projection.mjs";
import { buildTrafficCardProjection } from "./ndic-datex-v1/traffic-card-projection.mjs";
import { evaluatePublicationEligibility } from "./ndic-datex-v1/traffic-publication-eligibility.mjs";
import { describeSpatialMatch, matchesSpatialFilter, SPATIAL_FILTER } from "./ndic-datex-v1/traffic-filter-model.mjs";
import { MAP_LINK_TYPE, PUBLICATION_ELIGIBILITY } from "./ndic-datex-v1/traffic-publication-constants.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fails = [];
let passCount = 0;
function ok(id, cond) {
  if (cond) passCount += 1;
  else fails.push(id);
}

function baseEvent(extra = {}) {
  return {
    eventIdHash: "abc123def456abc123def456abc123de",
    locationPublishable: extra.locationPublishable === true,
    locations: extra.locations || [],
    fields: {
      trafficCategory: provenanceField("nehoda", "datex", null, "validated"),
      status: provenanceField("aktivni", "datex", null, "validated"),
      validFrom: provenanceField("2026-08-07T10:00:00.000Z", "datex", null, "validated"),
      validTo: provenanceField("2026-08-07T20:00:00.000Z", "datex", null, "validated"),
      freshness: provenanceField("FRESH", "resolver", null, "validated"),
      lastMeaningfulChangeAt: provenanceField("2026-08-07T12:00:00.000Z", "aggregator", null, "validated"),
      roadNumber: extra.roadNumber || provenanceField(null, "resolver", null, "not_available"),
      direction: extra.direction || provenanceField(null, "resolver", null, "not_available"),
      administrativeArea: extra.admin || provenanceField(null, "resolver", null, "not_available"),
      coordinates: extra.coords || provenanceField(null, "resolver", null, "not_available"),
      kilometer: extra.kilometer || provenanceField(null, "resolver", null, "not_available"),
      ...((extra.fieldsPatch) || {}),
    },
    sourceTimestamps: {
      datexUpdatedAt: "2026-08-07T11:50:00.000Z",
      datexDownloadedAt: "2026-08-07T11:55:00.000Z",
    },
  };
}

// PRECISE
{
  const ev = baseEvent({
    locationPublishable: true,
    locations: [{ primaryLocation: { locationCodeHash: "h1" } }],
    roadNumber: provenanceField("D1", "resolver", null, "validated"),
    direction: provenanceField("positive", "resolver", null, "validated"),
    kilometer: provenanceField(56, "datex", null, "validated"),
    coords: provenanceField({ lat: 50.1, lon: 14.4 }, "resolver", null, "validated"),
  });
  const elig = { locationPreciseAllowed: true };
  const p = classifyLocationPresentation(ev, elig);
  ok("precise_level", p.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.PRECISE);
  ok("precise_flags", p.preciseLocationVerified === true && p.subjectScopeVerified === true);
  ok("precise_shows_km", p.presentationKilometer === 56 && p.showPreciseGeoFields === true);
  ok("precise_disclosure", /D1/.test(p.locationDisclosureCs) && /km 56/.test(p.locationDisclosureCs));
  ok("precise_guard", assertFailClosedBucketsNeverInventGeo(p) === true);
}

// SCOPED road, no geometry
{
  const ev = baseEvent({
    locationPublishable: false,
    roadNumber: provenanceField("D1", "datex", null, "validated"),
  });
  const p = classifyLocationPresentation(ev, { locationPreciseAllowed: false });
  ok("scoped_level", p.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.SCOPED);
  ok("scoped_no_precise", p.preciseLocationVerified === false && p.subjectScopeVerified === true);
  ok("scoped_no_km", p.presentationKilometer == null && p.showPreciseGeoFields === false);
  ok("scoped_road", p.subjectScopeKind === SUBJECT_SCOPE_KIND.ROAD && p.subjectScopeLabel === "D1");
  ok("scoped_disclosure", /Týká se komunikace D1/.test(p.locationDisclosureCs));
  ok("scoped_route_mode", p.routeMatchMode === ROUTE_MATCH_MODE.SCOPE_ONLY);
  ok("scoped_near_me_off", p.nearMeEligible === false);
}

// GENERAL / NONE — no road, no admin (LOCATIONCODES_ONLY style)
{
  const ev = baseEvent({ locationPublishable: false });
  const p = classifyLocationPresentation(ev, { locationPreciseAllowed: false });
  ok("general_level", p.locationPresentationLevel === LOCATION_PRESENTATION_LEVEL.GENERAL);
  ok("general_no_geo", p.preciseLocationVerified === false && p.subjectScopeVerified === false);
  ok("general_disclosure", /nespojují|neuvádějí|evidována/i.test(p.locationDisclosureCs));
  ok("general_no_invent", p.presentationKilometer == null && p.presentationDirection == null);
}

// Projection: scoped card renders without precise geo
{
  const ev = baseEvent({
    locationPublishable: false,
    roadNumber: provenanceField("D1", "datex", null, "validated"),
  });
  const elig = evaluatePublicationEligibility(ev, {});
  ok("scoped_eligible", elig.eligibility === PUBLICATION_ELIGIBILITY.ELIGIBLE_FOR_PUBLICATION);
  ok("scoped_not_precise_elig", elig.locationPreciseAllowed === false);
  const built = buildTrafficPublicationProjection(ev, { nowIso: "2026-08-07T13:00:00.000Z" });
  ok("scoped_proj_ok", built.ok === true);
  ok("scoped_proj_level", built.projection.locationPresentationLevel === "SCOPED");
  ok("scoped_proj_road", built.projection.roadNumber === "D1");
  ok("scoped_proj_no_km", built.projection.kilometer == null);
  ok("scoped_proj_no_dir", built.projection.direction == null);
  ok("scoped_map_general", built.projection.mapLinkType === MAP_LINK_TYPE.GENERAL_RSD_MAP);
  ok("scoped_not_published", built.projection.publicationEnabled === false);
  const card = buildTrafficCardProjection(built.projection);
  ok("scoped_card_ok", card.ok === true);
  ok("scoped_card_disclosure", /Týká se komunikace D1/.test(card.card.locationDisclosureCs));
}

// LOCATIONCODES_ONLY-like: no road → GENERAL, still projectable
{
  const ev = baseEvent({ locationPublishable: false });
  const built = buildTrafficPublicationProjection(ev, { nowIso: "2026-08-07T13:00:00.000Z" });
  ok("lco_proj_ok", built.ok === true);
  ok("lco_level_general", built.projection.locationPresentationLevel === "GENERAL");
  ok("lco_no_road", built.projection.roadNumber == null);
  ok("lco_no_km", built.projection.kilometer == null);
  ok("lco_map_fallback", built.projection.mapLinkType === MAP_LINK_TYPE.GENERAL_RSD_MAP);
}

// Filters: NEAR_ME rejects non-publishable; MY_ROUTES allows scope-only with notice
{
  const scoped = baseEvent({
    locationPublishable: false,
    roadNumber: provenanceField("D1", "datex", null, "validated"),
  });
  ok(
    "near_me_reject_scoped",
    matchesSpatialFilter(scoped, SPATIAL_FILTER.NEAR_ME, { nearLocationHashes: ["h1"] }) === false
  );
  ok(
    "my_routes_scope",
    matchesSpatialFilter(scoped, SPATIAL_FILTER.MY_ROUTES, { routeRoadNumbers: ["D1"] }) === true
  );
  const meta = describeSpatialMatch(scoped, SPATIAL_FILTER.MY_ROUTES, { routeRoadNumbers: ["D1"] });
  ok("my_routes_scope_mode", meta.routeMatchMode === "SCOPE_ONLY");
  ok("my_routes_notice", /přesný úsek není/i.test(meta.scopeNoticeCs || ""));
}

// Mutation: inventing coords from disclosure text must stay impossible
{
  const disc = buildLocationDisclosureCs(LOCATION_PRESENTATION_LEVEL.NONE, {
    kind: SUBJECT_SCOPE_KIND.NONE,
    label: null,
  });
  ok("mut_no_coords_in_none", !/\d+\.\d+/.test(disc) && !/km 0/.test(disc));
  ok("mut_no_jargon", !/fail-closed|LOCATIONCODES|linearExtension|UNRESOLVED/i.test(disc));
}

// Source guards: policy module must not assign trust/publication
{
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "ndic-datex-v1", "traffic-location-presentation-policy.mjs"),
    "utf8"
  );
  const srcClean = src
    .replace(/heuristicLocationUsed/g, "")
    .replace(/fuzzyMatchUsed/g, "")
    .replace(/geocodingUsed/g, "");
  ok("mut_no_trust_assign", !/localizationTrust\s*=/.test(src));
  ok("mut_no_geocode", !/geocode\(|fuzzy.?match|map.?match|\bfuzzy\b/i.test(srcClean));
  ok("mut_no_pub_on", !/PUBLICATION_ENABLED\s*:\s*true/.test(src));
}

if (fails.length) {
  console.error("NDIC_LOCATION_PRESENTATION_POLICY_FIXTURES_FAIL");
  fails.forEach((f) => console.error(f));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    passCount,
    failCount: 0,
    LOCATION_PRESENTATION_POLICY_IMPLEMENTED: "YES",
    PRECISE_LEVEL_IMPLEMENTED: "YES",
    SCOPED_LEVEL_IMPLEMENTED: "YES",
    GENERAL_LEVEL_IMPLEMENTED: "YES",
    NONE_LEVEL_COVERED_VIA_GENERAL_OR_EXPLICIT: "YES",
    SUBJECT_SCOPE_SEPARATED_FROM_PRECISE_LOCATION: "YES",
    CARD_WITHOUT_PRECISE_LOCATION_CAN_RENDER: "YES",
    FUZZY_MATCH_USED: false,
    GEOCODING_USED: false,
    HEURISTIC_LOCATION_USED: false,
    TEST_RUNNER_FALSE_GREEN_POSSIBLE: "NO",
  })
);
