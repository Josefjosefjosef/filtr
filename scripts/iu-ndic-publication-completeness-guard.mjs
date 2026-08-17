#!/usr/bin/env node
/**
 * NDIC publication completeness guard (ramps / rest areas / multi-record / EXIT).
 * Sanitized fixtures only — no licensed raw DATEX dump.
 *
 * Covers Definition-of-Done regression samples A–J (general rules, no D1 hardcodes).
 */
import {
  parseOfficialCommentFacts,
  extractExitAndRampFacts,
  resolvePresentationRoadNumber,
  buildTrafficCardPresentation,
  extractMotorwayNumbersFromOfficialComment,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { makeStableItemId, buildSituationIdentity } from "./ndic-datex-v1/identity.mjs";
import { situationToFeedItem, situationsToFeedItems } from "./ndic-datex-v1/normalize-feed.mjs";
import { classifyTrafficLifecycle } from "./ndic-datex-v1/lifecycle.mjs";
import { extractRoadNumberFromNdicComment } from "./ndic-datex-v1/official-comment-road.mjs";
import { matchesTrafficDetailFilter, defaultTrafficFilter } from "../assets/iu-feed-filter-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function syntheticRecord(partial) {
  return {
    recordId: partial.recordId || "REC-1",
    recordVersion: "1",
    recordType: partial.recordType || "RoadOrCarriagewayOrLaneManagement",
    category: {
      category: partial.category || "omezeni",
      labelCs: partial.labelCs || "Omezení",
      importance: 2,
      mapVersion: "test",
      known: true,
    },
    rawTypeKnown: true,
    validity: {
      overallStartTime: partial.validFrom || "2026-01-01T08:00:00+01:00",
      overallEndTime: partial.validTo || "2027-12-31T23:59:00+01:00",
      openEnded: false,
      validityStatus: partial.validityStatus || "definedByValidityTimeSpec",
    },
    tmcRefs: partial.tmcRefs || [],
    coordinates: partial.coordinates || null,
    roadNumber: partial.roadNumber || "",
    roadName: partial.roadName || "",
    comment: partial.comment || "",
    cause: "",
    severity: "",
    locationPresence: partial.locationPresence || {},
    supplementary: partial.supplementary || { present: false, classification: "SUPPLEMENTARY_ABSENT" },
    createdAt: partial.validFrom || "2026-01-01T08:00:00+01:00",
    versionTime: partial.validFrom || "2026-01-01T08:00:00+01:00",
  };
}

function syntheticSituation(situationId, records) {
  return {
    situationId,
    situationVersion: "1",
    publicationTime: "2026-08-17T10:00:00+02:00",
    records,
  };
}

const NOW = "2026-08-17T12:00:00+02:00";

// --- TEST A: restArea / serviceArea comment → public road ---
{
  const comment =
    "Dx, km 100,5, odpočívka SampleRest, ve směru East, stavební práce, Od 03.08.2026 08:00 Do 28.02.2027 23:59";
  // Use real motorway token shape without hardcoding a specific D1 exception path.
  const real = comment.replace(/\bDx\b/g, "D8");
  const sit = syntheticSituation("CZ-NDIC-FIX-REST-A", [
    syntheticRecord({
      recordId: "CZ-NDIC-FIX-REST-A_ConstructionWorks",
      recordType: "ConstructionWorks",
      comment: real,
    }),
  ]);
  const item = situationToFeedItem(sit, { nowIso: NOW });
  ok("TEST_A_publishable", item.publishable === true && item.status === "aktivni", item.status);
  ok("TEST_A_road_from_comment", item.roadNumber === "D8", item.roadNumber);
  ok("TEST_A_publish_decision", item.publishDecision === "published", item.publishDecision);
  ok(
    "TEST_A_rest_area_text_kept",
    /odpočívka SampleRest/i.test(item.summaryFull),
    item.summaryFull.slice(0, 80)
  );
}

// --- TEST B: exit ramp closure → public ---
{
  const comment =
    "D8 sjezd EXIT 12 ve směru West, výjezd z dálnice uzavřen, Od 09.08.2026 15:53 Do 30.11.2026 06:00";
  const sit = syntheticSituation("CZ-NDIC-FIX-EXIT-B", [
    syntheticRecord({
      recordId: "CZ-NDIC-FIX-EXIT-B_R1",
      comment,
    }),
  ]);
  const item = situationToFeedItem(sit, { nowIso: NOW });
  const facts = parseOfficialCommentFacts(comment);
  ok("TEST_B_publishable", item.publishable === true, String(item.publishable));
  ok("TEST_B_road", item.roadNumber === "D8", item.roadNumber);
  ok("TEST_B_exit_number", facts.exitNumber === "12", facts.exitNumber);
  ok("TEST_B_ramp_exit", facts.rampType === "exit", facts.rampType);
}

// --- TEST C: entry ramp closure → public ---
{
  const comment =
    "D8 nájezd EXIT 12, ve směru East, vjezd na dálnici uzavřen, Od 18.04.2026 09:11 Do 30.11.2026 06:00";
  const sit = syntheticSituation("CZ-NDIC-FIX-ENTRY-C", [
    syntheticRecord({ recordId: "CZ-NDIC-FIX-ENTRY-C_R1", comment }),
  ]);
  const item = situationToFeedItem(sit, { nowIso: NOW });
  const facts = parseOfficialCommentFacts(comment);
  ok("TEST_C_publishable", item.publishable === true, String(item.publishable));
  ok("TEST_C_road", item.roadNumber === "D8", item.roadNumber);
  ok("TEST_C_ramp_entrance", facts.rampType === "entrance", facts.rampType);
  ok("TEST_C_exit_number", facts.exitNumber === "12", facts.exitNumber);
}

// --- TEST D: two ramps same MÚK not deduped ---
{
  const exitComment = "D8 sjezd EXIT 99 ve směru West, výjezd z dálnice uzavřen";
  const entryComment = "D8 nájezd EXIT 99 směr East, vjezd na dálnici uzavřen";
  const sit = syntheticSituation("CZ-NDIC-FIX-MUK-D", [
    syntheticRecord({ recordId: "CZ-NDIC-FIX-MUK-D_EXIT", comment: exitComment }),
    syntheticRecord({ recordId: "CZ-NDIC-FIX-MUK-D_ENTRY", comment: entryComment }),
  ]);
  const { items } = situationsToFeedItems([sit], { nowIso: NOW });
  ok("TEST_D_two_items", items.length === 2, String(items.length));
  ok("TEST_D_distinct_ids", items[0].id !== items[1].id, items.map((i) => i.id).join("|"));
  ok(
    "TEST_D_first_keeps_situation_id",
    items[0].id === makeStableItemId("CZ-NDIC-FIX-MUK-D"),
    items[0].id
  );
  ok("TEST_D_second_composite_id", /~/.test(items[1].id) || items[1].id !== items[0].id, items[1].id);
}

// --- TEST E: main carriageway + ramp in same Situation stay separate ---
{
  const sit = syntheticSituation("CZ-NDIC-FIX-MIX-E", [
    syntheticRecord({
      recordId: "CZ-NDIC-FIX-MIX-E_MAIN",
      comment: "D8, mezi km 10 a 12, ve směru East, práce na silnici, zúžení vozovky",
    }),
    syntheticRecord({
      recordId: "CZ-NDIC-FIX-MIX-E_RAMP",
      comment: "D8 sjezd EXIT 11 ve směru West, výjezd z dálnice uzavřen",
    }),
  ]);
  const { items } = situationsToFeedItems([sit], { nowIso: NOW });
  ok("TEST_E_two_cards", items.length === 2, String(items.length));
  ok(
    "TEST_E_not_merged_text",
    items.some((i) => /sjezd EXIT 11/i.test(i.summaryFull)) &&
      items.some((i) => /mezi km 10/i.test(i.summaryFull)),
    "merged"
  );
}

// --- TEST F: multi SituationRecord publishable ---
{
  const sit = syntheticSituation("CZ-NDIC-FIX-MULTI-F", [
    syntheticRecord({ recordId: "R-A", comment: "D8 nájezd EXIT 5 směr East, vjezd uzavřen" }),
    syntheticRecord({ recordId: "R-B", comment: "D8 sjezd EXIT 5 směr West, výjezd uzavřen" }),
    syntheticRecord({ recordId: "R-C", comment: "D8, km 50, práce na silnici" }),
  ]);
  const { items } = situationsToFeedItems([sit], { nowIso: NOW });
  ok("TEST_F_three_items", items.length === 3, String(items.length));
  const ids = new Set(items.map((i) => i.id));
  ok("TEST_F_unique_ids", ids.size === 3, String(ids.size));
}

// --- TEST G: long-lived active not stale ---
{
  const life = classifyTrafficLifecycle({
    validFrom: "2023-11-30T10:00:00+01:00",
    validTo: "2026-10-20T20:00:00+02:00",
    nowIso: NOW,
  });
  ok("TEST_G_active", life.status === "aktivni" && life.publishable === true, life.status);
  const sit = syntheticSituation("CZ-NDIC-FIX-LONG-G", [
    syntheticRecord({
      recordId: "LONG-G",
      validFrom: "2023-11-30T10:00:00+01:00",
      validTo: "2026-10-20T20:00:00+02:00",
      comment: "D8 nájezd EXIT 7 směr East, vjezd na dálnici uzavřen",
    }),
  ]);
  const item = situationToFeedItem(sit, { nowIso: NOW });
  ok("TEST_G_item_active", item.status === "aktivni" && item.publishable === true, item.status);
}

// --- TEST H: point location without kmFrom–kmTo ---
{
  const comment = "D8, km 88, odpočívka PointOnly, ve směru East, parkování uzavřeno";
  const sit = syntheticSituation("CZ-NDIC-FIX-POINT-H", [
    syntheticRecord({
      recordId: "POINT-H",
      comment,
      locationPresence: { hasPointCoordinates: false, hasAlertCPoint: false },
    }),
  ]);
  const item = situationToFeedItem(sit, { nowIso: NOW });
  ok("TEST_H_publishable", item.publishable === true, String(item.publishable));
  ok("TEST_H_road", item.roadNumber === "D8", item.roadNumber);
  ok("TEST_H_no_km_range_required", !/mezi km/i.test(item.summaryFull), "ok");
}

// --- TEST I: frontend filter keeps event without municipality when road evidenced ---
{
  const tv = {
    road: null,
    roadNumber: null,
    roadClass: null,
    eventType: "omezeni",
    impact:
      "D8, km 344,5, odpočívka SampleRest, ve směru East, stavební práce, Od 03.08.2026 08:00 Do 28.02.2027 23:59",
    municipality: null,
  };
  const tf = { ...defaultTrafficFilter(), roads: ["D8"] };
  ok(
    "TEST_I_road_filter_match",
    matchesTrafficDetailFilter({ trafficV1: tv }, tf) === true,
    "filter"
  );
  const card = buildTrafficCardPresentation({
    impact: tv.impact,
    road: null,
    municipality: null,
  });
  ok("TEST_I_card_not_null", !!card && !!(card.placeLine || card.situationSummary || card.expanded), "card");
  const road = resolvePresentationRoadNumber({ impact: tv.impact });
  ok("TEST_I_presentation_road", road === "D8", String(road));
}

// --- TEST J: ended / cancelled not published ---
{
  const ended = situationToFeedItem(
    syntheticSituation("CZ-NDIC-FIX-ENDED-J", [
      syntheticRecord({
        recordId: "ENDED-J",
        validFrom: "2025-01-01T08:00:00+01:00",
        validTo: "2025-06-01T08:00:00+02:00",
        comment: "D8 sjezd EXIT 3, výjezd uzavřen",
      }),
    ]),
    { nowIso: NOW }
  );
  ok("TEST_J_ended_not_publishable", ended.publishable === false, ended.status);
  ok(
    "TEST_J_ended_decision",
    ended.publishDecision === "ended" || ended.status === "ukonceno",
    ended.publishDecision + "/" + ended.status
  );
}

// --- EXIT letter suffix + detour must not win (196B vs 194 class) ---
{
  const raw =
    "D8 směr West, sjezd EXIT 88B na Sample-centrum, výjezd z dálnice uzavřen, Od 11.10.2025 10:00 Do 20.10.2026 20:00, Uzavřeno. " +
    "Objížďka - za uzavřenou sjezdovou větev MÚK: dálnice D8 (směr West) – MÚK Sample-centrum (EXIT 44) a dále dle místní úpravy provozu";
  const facts = parseOfficialCommentFacts(raw);
  const ramp = extractExitAndRampFacts(raw);
  ok("EXIT_LETTER_SUFFIX", facts.exitNumber === "88B" || ramp.exitNumber === "88B", facts.exitNumber);
  ok("EXIT_NOT_FROM_DETOUR", facts.exitNumber !== "44" && ramp.exitNumber !== "44", facts.exitNumber);
  ok("EXIT_ROAD_PRIMARY", facts.exitRoad === "D8" || ramp.exitRoad === "D8", facts.exitRoad);
}

// --- identity continuity for single record ---
{
  const sit = syntheticSituation("CZ-NDIC-FIX-ID-1", [
    syntheticRecord({ recordId: "ONLY", comment: "D8, km 1, práce" }),
  ]);
  const id = buildSituationIdentity(sit, { recordIndex: 0 });
  ok("IDENTITY_SINGLE", id.itemId === makeStableItemId("CZ-NDIC-FIX-ID-1"), id.itemId);
}

// --- extractRoad helper ---
{
  ok(
    "COMMENT_ROAD_LEAD",
    extractRoadNumberFromNdicComment("D11, km 1, práce na silnici") === "D11",
    extractRoadNumberFromNdicComment("D11, km 1, práce na silnici")
  );
  ok(
    "COMMENT_ROAD_MOTORWAY_LIST",
    extractMotorwayNumbersFromOfficialComment("dálnice D3 ve směru South").includes("D3"),
    "d3"
  );
}

if (fails.length) {
  console.log("FAIL " + fails.length);
  for (const f of fails) console.log("  " + f);
  process.exit(1);
}
console.log("PASS " + results.length);
for (const r of results) {
  if (r.pass) console.log("  OK " + r.id);
}
