#!/usr/bin/env node
/**
 * Participant specificity + vehicle×animal collision relation guard.
 * D10-class: general "nehoda nákladního vozidla" + "DOD x divočák" must not invent
 * a second vehicle; prefer most specific safe participant; generic "vozidlo" only
 * on real truck/van conflict. Pure local, no network, no road/km hardcode pass path.
 */
import {
  parseOfficialCommentFacts,
  parseAccidentParticipantsFromText,
  parseCollisionRelationFromText,
  reconcileAccidentParticipantsWithSpecificity,
  formatAccidentSituationLead,
  expandTrafficAbbreviationsCs,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
  TRAFFIC_VEHICLE_ABBREV_TO_PARTICIPANT,
  ACCIDENT_PARTICIPANT,
  COLLISION_ANIMAL,
} from "../assets/iu-traffic-card-presenter-v1.js";

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

// --- DOD mapping (project-authoritative) ---
{
  ok(
    "DOD_MAPPING_FOUND",
    TRAFFIC_VEHICLE_ABBREV_TO_PARTICIPANT.DOD === ACCIDENT_PARTICIPANT.VAN,
    String(TRAFFIC_VEHICLE_ABBREV_TO_PARTICIPANT.DOD)
  );
  ok(
    "DOD_EXPAND",
    /dodávka/i.test(expandTrafficAbbreviationsCs("DOD x divočák")),
    expandTrafficAbbreviationsCs("DOD x divočák")
  );
}

// --- COLLISION_RELATION_GUARD: DOD x divočák ---
{
  const rel = parseCollisionRelationFromText("nehoda; DOD x divočák.");
  ok("COLLISION_RELATION_GUARD", rel.relation === "collision", JSON.stringify(rel));
  ok("COLLISION_LEFT_VAN", rel.vehicle === ACCIDENT_PARTICIPANT.VAN, String(rel.vehicle));
  ok("COLLISION_RIGHT_BOAR", rel.animal === COLLISION_ANIMAL.WILD_BOAR, String(rel.animal));
  ok("ANIMAL_SPECIFICITY_GUARD", rel.animal === COLLISION_ANIMAL.WILD_BOAR, String(rel.animal));
  ok("ANIMAL_NOT_ONLY_WILDLIFE", rel.animal !== COLLISION_ANIMAL.WILDLIFE, String(rel.animal));
}

// --- Master sanitised fixture (D10 semantics, no event id) ---
const D10_RAW =
  "D10, mezi km 24.8 a 24, ve směru Praha; nehoda nákladního vozidla; zvěř na vozovce; překážka na vozovce, průjezd se zvýšenou opatrností; DOD x divočák.";

{
  const facts = parseOfficialCommentFacts(D10_RAW);
  const parts = facts.accidentParticipants || [];
  const input = {
    impact: D10_RAW,
    impactFull: D10_RAW,
    eventType: "nehoda",
    road: "D10",
    roadClass: "MOTORWAY",
    direction: "Praha",
    kmFrom: 24.8,
    kmTo: 24,
  };
  const ev = classifyEventPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  const lead = formatAccidentSituationLead(expandTrafficAbbreviationsCs(D10_RAW), facts);

  ok("D10_EVENT_ACCIDENT", ev.kind === "accident", ev.kind);
  ok("D10_PARTS_ONLY_VAN", parts.length === 1 && parts[0] === ACCIDENT_PARTICIPANT.VAN, JSON.stringify(parts));
  ok("NO_FALSE_EXTRA_PARTICIPANT_GUARD", !parts.includes(ACCIDENT_PARTICIPANT.TRUCK), JSON.stringify(parts));
  ok("FALSE_EXTRA_PARTICIPANT_AFTER_NO", parts.length === 1, String(parts.length));
  ok("D10_COLLISION_VAN", facts.collisionVehicle === ACCIDENT_PARTICIPANT.VAN, String(facts.collisionVehicle));
  ok("D10_COLLISION_BOAR", facts.collisionAnimal === COLLISION_ANIMAL.WILD_BOAR, String(facts.collisionAnimal));
  ok("D10_NO_GENERIC_FALLBACK", facts.genericVehicleFallback === false, String(facts.genericVehicleFallback));
  ok(
    "D10_LEAD",
    /Nehoda\s+dodávky\s+s\s+divočákem/i.test(lead || ""),
    lead
  );
  ok(
    "D10_SIT_LEAD",
    /Nehoda\s+dodávky\s+s\s+divočákem/i.test(sit),
    sit
  );
  ok("D10_OBSTACLE", /Překážka\s+na\s+vozovce/i.test(sit), sit);
  ok("D10_CAUTION", /Průjezd\s+se\s+zvýšenou\s+opatrností/i.test(sit), sit);
  ok(
    "D10_NO_FALSE_TRUCK_AND_VAN_LEAD",
    !/nákladního\s+automobilu\s+a\s+dodávky/i.test(sit),
    sit
  );
  ok(
    "D10_WILDLIFE_DEDUPED_WHEN_BOAR_IN_LEAD",
    !/Zvěř\s+na\s+vozovce/i.test(sit),
    sit
  );
  ok(
    "KM_RANGE_SOURCE_SEMANTICS_PRESERVED",
    /km\s+24,8–24/i.test(card.placeLine || "") && !/km\s+24–24,8/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok("D10_DIRECTION", /směr\s+Praha/i.test(card.placeLine || ""), card.placeLine);
  ok("D10_RAW_PRESERVED", /DOD\s*x\s*divočák/i.test(rows.sourceDescription || ""), rows.sourceDescription);
  ok(
    "PARTICIPANT_SPECIFICITY_PRESERVATION_GUARD",
    /dodávk/i.test(sit) && !/^Nehoda\s+vozidla\s+s\s+divočákem/i.test(sit),
    sit
  );
}

// --- CONFLICT_FALLBACK_GUARD: nákladní automobil + DOD x divočák ---
{
  const raw =
    "nehoda nákladního automobilu; zvěř na vozovce; překážka na vozovce; DOD x divočák.";
  const facts = parseOfficialCommentFacts(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "nehoda",
    }) || ""
  );
  ok("CONFLICT_FALLBACK_GUARD_FLAG", facts.genericVehicleFallback === true, String(facts.genericVehicleFallback));
  ok(
    "CONFLICT_FALLBACK_GUARD_SIT",
    /Nehoda\s+vozidla\s+s\s+divočákem/i.test(sit),
    sit
  );
  ok("CONFLICT_KEEP_OBSTACLE", /Překážka\s+na\s+vozovce/i.test(sit), sit);
  ok("CONFLICT_KEEP_BOAR", /divočákem/i.test(sit), sit);
  ok("CONFLICT_NOT_TRUCK_AND_VAN", !/nákladního\s+automobilu\s+a\s+dodávky/i.test(sit), sit);
}

// --- OA_CYCLIST_REGRESSION_GUARD ---
{
  const raw = "nehoda; OA x cyklista.";
  const parts = parseAccidentParticipantsFromText(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "nehoda",
    }) || ""
  );
  ok(
    "OA_CYCLIST_REGRESSION_GUARD_PARTS",
    parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR) &&
      parts.includes(ACCIDENT_PARTICIPANT.CYCLIST),
    JSON.stringify(parts)
  );
  ok(
    "OA_CYCLIST_REGRESSION_GUARD_SIT",
    /osobního\s+automobilu/i.test(sit) && /cyklist/i.test(sit) && !/Nehoda\s+vozidla/i.test(sit),
    sit
  );
}

// --- SINGLE_VEHICLE_REGRESSION_GUARD (havárie OA) ---
{
  const raw = "nehoda; havárie OA.";
  const parts = parseAccidentParticipantsFromText(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "nehoda",
    }) || ""
  );
  ok(
    "SINGLE_VEHICLE_REGRESSION_GUARD_PARTS",
    parts.length === 1 && parts[0] === ACCIDENT_PARTICIPANT.PASSENGER_CAR,
    JSON.stringify(parts)
  );
  ok(
    "SINGLE_VEHICLE_REGRESSION_GUARD_SIT",
    /Nehoda\s+osobního\s+automobilu/i.test(sit) && !/Nehoda\s+vozidla\.?$/i.test(sit.trim()),
    sit
  );
}

// --- NA x OA preserved ---
{
  const raw = "nehoda; NA x OA.";
  const parts = parseAccidentParticipantsFromText(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "nehoda",
    }) || ""
  );
  ok(
    "NA_OA_BOTH_SPECIFIC",
    parts.includes(ACCIDENT_PARTICIPANT.TRUCK) &&
      parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR),
    JSON.stringify(parts)
  );
  ok(
    "NA_OA_SIT",
    /nákladní/i.test(sit) && /osobní/i.test(sit) && !/Nehoda\s+vozidla\s+a\s+vozidla/i.test(sit),
    sit
  );
}

// --- Porouchané vozidlo must not become nehoda via participant parser ---
{
  const raw = "porouchané vozidlo na krajnici; nepojízdný OA.";
  const ev = classifyEventPresentation({
    impact: raw,
    impactFull: raw,
    eventType: "prekazka",
  });
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
    }) || ""
  );
  ok("BROKEN_NOT_ACCIDENT_KIND", ev.kind !== "accident", ev.kind);
  ok("BROKEN_SIT_NOT_NEHODA", !/^Nehoda/i.test(sit), sit);
  ok("BROKEN_SIT_HAS_VEHICLE", /porouchan|nepojízdn/i.test(sit), sit);
}

// --- Wildlife animal token (zvěř) after Unicode-safe trail ---
{
  const rel = parseCollisionRelationFromText("nehoda; DOD x zvěř.");
  ok("WILDLIFE_TOKEN_PARSE", rel.animal === COLLISION_ANIMAL.WILDLIFE, JSON.stringify(rel));
  const sit = String(
    buildTrafficSituationSummary({
      impact: "nehoda; DOD x zvěř.",
      impactFull: "nehoda; DOD x zvěř.",
      eventType: "nehoda",
    }) || ""
  );
  ok("WILDLIFE_SIT", /dodávky\s+se\s+zvěří/i.test(sit), sit);
}

// --- Reconcile helper: general truck class + DOD animal → VAN only ---
{
  const raw = "nehoda nákladního vozidla; DOD x divočák.";
  const recon = reconcileAccidentParticipantsWithSpecificity(
    [ACCIDENT_PARTICIPANT.TRUCK, ACCIDENT_PARTICIPANT.VAN],
    raw,
    parseCollisionRelationFromText(raw)
  );
  ok(
    "RECONCILE_DROPS_GENERAL_TRUCK",
    recon.participants.length === 1 &&
      recon.participants[0] === ACCIDENT_PARTICIPANT.VAN,
    JSON.stringify(recon.participants)
  );
}

const passN = results.filter((r) => r.pass).length;
const failN = fails.length;
const out = {
  guard: "iu-traffic-dod-divocak-participant-specificity-guard",
  pass: failN === 0,
  passCount: passN,
  failCount: failN,
  fails,
  PARTICIPANT_SPECIFICITY_PRESERVATION_GUARD_PASS: results.some(
    (r) => r.id === "PARTICIPANT_SPECIFICITY_PRESERVATION_GUARD" && r.pass
  ),
  COLLISION_RELATION_GUARD_PASS: results.some(
    (r) => r.id === "COLLISION_RELATION_GUARD" && r.pass
  ),
  CONFLICT_FALLBACK_GUARD_PASS: results.some(
    (r) => r.id === "CONFLICT_FALLBACK_GUARD_SIT" && r.pass
  ),
  ANIMAL_SPECIFICITY_GUARD_PASS: results.some(
    (r) => r.id === "ANIMAL_SPECIFICITY_GUARD" && r.pass
  ),
  NO_FALSE_EXTRA_PARTICIPANT_GUARD_PASS: results.some(
    (r) => r.id === "NO_FALSE_EXTRA_PARTICIPANT_GUARD" && r.pass
  ),
  OA_CYCLIST_REGRESSION_GUARD_PASS: results.some(
    (r) => r.id === "OA_CYCLIST_REGRESSION_GUARD_SIT" && r.pass
  ),
  SINGLE_VEHICLE_REGRESSION_GUARD_PASS: results.some(
    (r) => r.id === "SINGLE_VEHICLE_REGRESSION_GUARD_SIT" && r.pass
  ),
  KM_RANGE_SOURCE_SEMANTICS_PRESERVED: results.some(
    (r) => r.id === "KM_RANGE_SOURCE_SEMANTICS_PRESERVED" && r.pass
  ),
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_DOD_DIVOCAK_PARTICIPANT_SPECIFICITY_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_DOD_DIVOCAK_PARTICIPANT_SPECIFICITY_GUARD_PASS");
