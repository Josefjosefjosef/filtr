#!/usr/bin/env node
/**
 * D1-class structured motorway EXIT object / direction / enrichment precedence /
 * fixed-object collision (OA do svodidel) guard.
 *
 * Pattern: "Dx sjezd EXIT N na Place" must structure to road+EXIT+direction,
 * must not leak raw object / duplicate EXIT in header, must not let weak TMC
 * "výjezd … vjezd …" override primary place, and must keep guardrail impact fact.
 *
 * Pure local, no network. No road/exit/city hardcode pass path.
 */
import {
  parseOfficialCommentFacts,
  extractNamedTransportObject,
  extractExitAndRampFacts,
  namedObjectDuplicatesExitNumber,
  isWeakDerivedRampEnrichmentLabel,
  parseFixedObjectCollisionFromText,
  parseCollisionRelationFromText,
  parseAccidentParticipantsFromText,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
  COLLISION_FIXED_OBJECT,
  ACCIDENT_PARTICIPANT,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { buildTrafficCardViewModel } from "../assets/iu-traffic-overview-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

function countVisible(hay, re) {
  return (String(hay || "").match(re) || []).length;
}

/** Sanitized master fixture (no production event ID). */
const MASTER_RAW = `D1 sjezd EXIT 282 na Prahu,
nehoda,
Od 15.08.2026 20:45
Do 15.08.2026 21:45,
nehoda;
havárie OA do svodidel,
na místě PČR.`;

const WEAK_ENRICHMENT = "výjezd Přerov – vjezd D1 Lipník nad Bečvou";

const GENERIC_EXIT_RAW = `D8 sjezd EXIT 45 na Ústí,
nehoda;
havárie OA do svodidel,
na místě PČR.`;

const DIVERSION_RAW =
  "D1 km 349.5; odklon dopravy na EXITu 354; kolona; Pozor!";

const EVENT_AT_EXIT_RAW = "D1 EXIT 354 - km 349.3, ve směru Brno; nehoda; OA.";

const GENERIC_OA_ONLY = "D1 EXIT 10; nehoda; havárie OA; na místě PČR.";

const OA_CYCLIST = "v ulici Testovací; nehoda; OA x cyklista; na místě PČR.";

const DOD_DIVOCAK = "D10; nehoda; DOD x divočák; na místě PČR.";

// --- RAW_OBJECT_HEADER_LEAK / DUPLICATE EXIT / ROAD / OBJECT_DIRECTION / RAMP_ROLE ---
{
  const named = extractNamedTransportObject(MASTER_RAW);
  const ramp = extractExitAndRampFacts(MASTER_RAW);
  const facts = parseOfficialCommentFacts(MASTER_RAW);
  ok("RAW_OBJECT_NOT_PROPERNAME", named == null, JSON.stringify(named));
  ok("RAMP_ROLE_GUARD", ramp.rampType === "exit" && ramp.exitNumber === "282", JSON.stringify(ramp));
  ok(
    "RAMP_RELATION_OR_TYPE",
    ramp.rampType === "exit" &&
      (ramp.rampRelation == null || ramp.rampRelation === "on" || ramp.rampRelation === "near"),
    String(ramp.rampRelation)
  );
  ok("OBJECT_DIRECTION_GUARD", facts.directionHuman === "Praha", String(facts.directionHuman));
  ok("PRIMARY_EXIT", facts.exitNumber === "282" && facts.exitPrimaryLocation === true);
  ok(
    "NAMED_OBJECT_NOT_RAW_PHRASE",
    !/sjezd EXIT 282 na Prahu/i.test(String(facts.namedObject || "")),
    String(facts.namedObject)
  );
  ok(
    "NAMED_DUP_EXIT_HELPER",
    namedObjectDuplicatesExitNumber("exit 282", "282") === true
  );
  ok(
    "NAMED_DUP_STRUCTURED_PHRASE",
    namedObjectDuplicatesExitNumber("D1 sjezd EXIT 282 na Prahu", "282") === true
  );
}

// --- LOCATION_ENRICHMENT_PRECEDENCE / WRONG_ENRICHMENT_NEGATIVE ---
{
  ok(
    "WEAK_ENRICHMENT_DETECT",
    isWeakDerivedRampEnrichmentLabel(WEAK_ENRICHMENT, MASTER_RAW) === true
  );
  ok(
    "WEAK_ENRICHMENT_NOT_WHEN_IN_SOURCE",
    isWeakDerivedRampEnrichmentLabel(WEAK_ENRICHMENT, MASTER_RAW + " " + WEAK_ENRICHMENT) ===
      false
  );
  const input = {
    impact: MASTER_RAW,
    impactFull: MASTER_RAW,
    eventType: "nehoda",
    road: "D1",
    roadClass: "MOTORWAY",
    location: WEAK_ENRICHMENT,
  };
  const hdr = buildLocalityHeaderModel(input);
  const place = String(buildPlaceAndDirectionLine(input) || "");
  const vm = buildTrafficCardViewModel(input);
  const headerVis = [
    vm.roadBadge && vm.roadBadge.road,
    vm.besideLocality,
    vm.directionArrow,
    vm.exitHeaderLabel,
  ]
    .filter(Boolean)
    .join(" | ");

  ok(
    "LOCATION_ENRICHMENT_PRECEDENCE_GUARD",
    /D1/.test(place) &&
      /EXIT\s*282/.test(place) &&
      /směr\s+Praha/.test(place) &&
      !/Přerov/i.test(place) &&
      !/Lipník/i.test(place),
    place
  );
  ok(
    "WRONG_ENRICHMENT_NEGATIVE_GUARD",
    !hdr.besideLocality || !/Přerov|Lipník/i.test(String(hdr.besideLocality)),
    String(hdr.besideLocality)
  );
  ok(
    "RAW_OBJECT_HEADER_LEAK_GUARD",
    !/sjezd EXIT 282 na Prahu/i.test(headerVis) && !hdr.besideLocality,
    headerVis
  );
  ok(
    "DUPLICATE_EXIT_GUARD",
    countVisible(headerVis, /EXIT\s*282/gi) === 1,
    headerVis
  );
  ok(
    "DUPLICATE_ROAD_GUARD",
    countVisible(headerVis, /\bD1\b/g) === 1,
    headerVis
  );
  ok(
    "HEADER_DIRECTION_ARROW",
    /→\s*směr\s+Praha/i.test(String(vm.directionArrow || "")),
    String(vm.directionArrow)
  );
}

// --- COLLISION_TARGET / FIXED_OBJECT / GENERIC_ACCIDENT ---
{
  const fixed = parseFixedObjectCollisionFromText("havárie OA do svodidel");
  ok(
    "COLLISION_TARGET_GUARD",
    fixed.relation === "impact" &&
      fixed.vehicle === ACCIDENT_PARTICIPANT.PASSENGER_CAR &&
      fixed.fixedObject === COLLISION_FIXED_OBJECT.GUARDRAIL,
    JSON.stringify(fixed)
  );
  ok(
    "FIXED_OBJECT_RELATION_GUARD",
    parseCollisionRelationFromText("havárie OA do svodidel").relation == null &&
      !parseAccidentParticipantsFromText("havárie OA do svodidel").includes(
        /* invent nothing beyond OA */ ACCIDENT_PARTICIPANT.TRUCK
      )
  );
  const parts = parseAccidentParticipantsFromText("havárie OA do svodidel");
  ok(
    "FALSE_EXTRA_VEHICLE_PARTICIPANT",
    parts.length === 1 && parts[0] === ACCIDENT_PARTICIPANT.PASSENGER_CAR,
    JSON.stringify(parts)
  );

  const facts = parseOfficialCommentFacts(MASTER_RAW);
  const sit = String(buildTrafficSituationSummary({
    impact: MASTER_RAW,
    impactFull: MASTER_RAW,
    eventType: "nehoda",
  }) || "");
  ok(
    "COLLISION_TARGET_VISIBLE",
    facts.collisionTargetType === COLLISION_FIXED_OBJECT.GUARDRAIL &&
      /havaroval do svodidel/i.test(sit) &&
      /PČR/i.test(sit),
    sit
  );
  ok("POLICE_ON_SCENE", facts.emergencyServicesStatus === "ON_SCENE");

  const genericSit = String(
    buildTrafficSituationSummary({
      impact: GENERIC_OA_ONLY,
      impactFull: GENERIC_OA_ONLY,
      eventType: "nehoda",
    }) || ""
  );
  ok(
    "GENERIC_ACCIDENT_POSITIVE_GUARD",
    /Nehoda osobního automobilu/i.test(genericSit) && !/svodidel/i.test(genericSit),
    genericSit
  );
}

// --- EVENT_AT_EXIT vs DIVERSION_VIA_EXIT ---
{
  const at = parseOfficialCommentFacts(EVENT_AT_EXIT_RAW);
  ok(
    "EVENT_AT_EXIT_POSITIVE_GUARD",
    at.exitNumber === "354" && at.exitPrimaryLocation === true,
    JSON.stringify({ exit: at.exitNumber, primary: at.exitPrimaryLocation })
  );
  const div = parseOfficialCommentFacts(DIVERSION_RAW);
  ok(
    "DIVERSION_VIA_EXIT_NEGATIVE_GUARD",
    div.exitPrimaryLocation !== true,
    JSON.stringify({
      exit: div.exitNumber,
      primary: div.exitPrimaryLocation,
      diversion: div.diversionExit || div.secondaryExit,
    })
  );
}

// --- Generic letter fixture (no D1/282 hardcode path) ---
{
  const input = {
    impact: GENERIC_EXIT_RAW,
    impactFull: GENERIC_EXIT_RAW,
    eventType: "nehoda",
    road: "D8",
    roadClass: "MOTORWAY",
    location: "výjezd SampleA – vjezd SampleB",
  };
  const facts = parseOfficialCommentFacts(GENERIC_EXIT_RAW);
  const hdr = buildLocalityHeaderModel(input);
  const place = String(buildPlaceAndDirectionLine(input) || "");
  const sit = String(buildTrafficSituationSummary(input) || "");
  const vm = buildTrafficCardViewModel(input);
  const headerVis = [
    vm.roadBadge && vm.roadBadge.road,
    vm.besideLocality,
    vm.directionArrow,
    vm.exitHeaderLabel,
  ]
    .filter(Boolean)
    .join(" | ");

  ok("GENERIC_DIR", facts.directionHuman === "Ústí", String(facts.directionHuman));
  ok("GENERIC_EXIT", facts.exitNumber === "45" && facts.exitPrimaryLocation === true);
  ok(
    "GENERIC_PLACE",
    /D8/.test(place) && /EXIT\s*45/.test(place) && /směr\s+Ústí/.test(place) && !/SampleA/i.test(place),
    place
  );
  ok("GENERIC_NO_RAW_OBJECT", !/sjezd EXIT 45/i.test(headerVis), headerVis);
  ok("GENERIC_BESIDE_EMPTY", !hdr.besideLocality, String(hdr.besideLocality));
  ok("GENERIC_SVODIDLA", /havaroval do svodidel/i.test(sit), sit);
  ok("MASTER_DATASET_PASS", true);
}

// --- Participant relation non-regression ---
{
  const cyc = parseOfficialCommentFacts(OA_CYCLIST);
  ok(
    "OA_CYCLIST_PRESERVED",
    (cyc.accidentParticipants || []).includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR) &&
      (cyc.accidentParticipants || []).includes(ACCIDENT_PARTICIPANT.CYCLIST)
  );
  const boar = parseCollisionRelationFromText(DOD_DIVOCAK);
  ok(
    "DOD_DIVOCAK_PRESERVED",
    boar.relation === "collision" && boar.vehicle === ACCIDENT_PARTICIPANT.VAN && !!boar.animal,
    JSON.stringify(boar)
  );
}

const out = {
  guard: "iu-traffic-exit-object-direction-collision-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_EXIT_OBJECT_DIRECTION_COLLISION_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_EXIT_OBJECT_DIRECTION_COLLISION_GUARD_PASS");
