#!/usr/bin/env node
/**
 * Hradec-class accident: road class+number composition (I/57) + rich accident facts
 * (vehicle types, injury, rescue/extrication, bare lane closed, danger).
 * Fixture-based general guards — no municipality / road-number hardcode pass path.
 * Pure local, no network.
 */
import {
  composeRoadNumberWithClass,
  resolvePresentationRoadNumber,
  formatAccidentSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  analyzeRestrictionScope,
  isSingleLaneRestriction,
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

// --- Road class composition ---
{
  const cases = [
    ["57", "CLASS_I", "I/57"],
    ["57", "I", "I/57"],
    ["57", "Silnice I. třídy", "I/57"],
    ["15", "CLASS_I", "I/15"],
    ["38", "CLASS_I", "I/38"],
    ["171", "CLASS_II", "II/171"],
    ["171", "Silnice II. třídy", "II/171"],
    ["26228", "CLASS_III", "III/26228"],
    ["26228", "Silnice III. třídy", "III/26228"],
    ["I/38", "CLASS_I", "I/38"],
    ["II/171", "CLASS_II", "II/171"],
    ["57", null, "57"],
    ["57", "UNKNOWN", "57"],
  ];
  for (const [road, cls, expected] of cases) {
    const got = composeRoadNumberWithClass(road, cls);
    ok("COMPOSE_" + road + "_" + String(cls), got === expected, got);
  }
  ok(
    "NO_DOUBLE_PREFIX",
    composeRoadNumberWithClass("I/38", "CLASS_I") === "I/38" &&
      !/^I\/I\//i.test(composeRoadNumberWithClass("I/38", "CLASS_I") || "")
  );
  ok(
    "RESOLVE_WITH_CLASS",
    resolvePresentationRoadNumber({ road: "57", roadClass: "CLASS_I" }) === "I/57"
  );
  ok(
    "RESOLVE_WITH_LABEL",
    resolvePresentationRoadNumber({
      road: "57",
      roadClassLabel: "Silnice I. třídy",
    }) === "I/57"
  );
  ok(
    "RESOLVE_ALREADY_CLASSED",
    resolvePresentationRoadNumber({ road: "I/38", roadClass: "CLASS_I" }) === "I/38"
  );
}

// --- Reference fixture (Hradec-class; values only in fixture) ---
{
  const REF_RAW =
    "Od 13.8.2026 13:45 do 15:50; na silnici 57 v obci Hradec nad Moravicí okres Opava; 2 havarovaná vozidla; probíhají záchranné a vyprošťovací práce, nebezpečí; jízdní pruh uzavřen; nákladní automobil x osobní automobil, se zraněním.";
  const input = {
    summaryFull: REF_RAW,
    summary: REF_RAW,
    impactFull: REF_RAW,
    eventType: "nehoda",
    road: "57",
    roadClass: "CLASS_I",
    roadClassLabel: "Silnice I. třídy",
    municipality: "Hradec nad Moravicí",
    district: "Opava",
  };
  const road = resolvePresentationRoadNumber(input);
  const lead = formatAccidentSituationLead(REF_RAW);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("ROAD_I57", road === "I/57", road);
  ok("PLACE_I57", /I\/57/.test(card.placeLine || ""), card.placeLine);
  ok("EXP_ROAD_I57", rows.road === "I/57", rows.road);
  ok("EXP_CLASS", /I\.\s*třídy/i.test(rows.roadClass || ""), rows.roadClass);
  ok("MUNI", /Hradec\s+nad\s+Moravicí/i.test(card.placeLine || ""), card.placeLine);
  ok("DISTRICT", /Opava/i.test(card.placeLine || ""), card.placeLine);

  ok("LEAD_NOT_GENERIC_COUNT_ONLY", !/^Nehoda dvou vozidel\.?$/i.test(lead.trim()), lead);
  ok("LEAD_TRUCK", /nákladní/i.test(lead), lead);
  ok("LEAD_CAR", /osobní/i.test(lead), lead);
  ok("LEAD_INJURY", /se\s+zraněním/i.test(lead), lead);

  ok("SIT_TRUCK", /nákladní/i.test(sit), sit);
  ok("SIT_CAR", /osobní/i.test(sit), sit);
  ok("SIT_INJURY", /zraněn/i.test(sit), sit);
  ok("SIT_RESCUE", /záchrann/i.test(sit), sit);
  ok("SIT_EXTRICATION", /vyprošť/i.test(sit), sit);
  ok("SIT_LANE", /jízdní\s+pruh/i.test(sit) && /uzavřen/i.test(sit), sit);
  ok("SIT_DANGER", /nebezpečí/i.test(sit), sit);
  ok("SIT_NOT_BARE", !/^Nehoda dvou vozidel\.?$/i.test(sit.trim()), sit);
  ok("SIT_NO_RAW_X", !/\bx\b/i.test(sit) || /nákladní/i.test(sit), sit);
  ok("SIT_NO_RAW_DUMP", !/2\s+havarovaná\s+vozidla;\s*probíhají/i.test(sit), sit);

  ok("SCOPE_SINGLE", analyzeRestrictionScope(REF_RAW) === "SINGLE_LANE_CLOSED");
  ok("IS_SINGLE_LANE", isSingleLaneRestriction(REF_RAW) === true);

  ok("RAW_PRESERVED", /nákladní automobil x osobní/.test(rows.sourceDescription || ""));

  // Hallucination bans
  ok("NO_HELO", !/vrtulník/i.test(sit), sit);
  ok("NO_POLICE", !/polici/i.test(sit), sit);
  ok("NO_FIRE", !/hasič/i.test(sit), sit);
  ok("NO_DEATH", !/smrteln|usmrcen|úmrtí/i.test(sit), sit);
  ok("NO_SEVERE", !/vážn[ée]\s+zraněn/i.test(sit), sit);
  ok("NO_INJURY_COUNT", !/\d+\s+zraněn/i.test(sit), sit);
}

// --- Generic twin (no Hradec / 57 hardcode) ---
{
  const raw =
    "na silnici 15 v obci Alfa okres Beta; 2 havarovaná vozidla; probíhají záchranné a vyprošťovací práce, nebezpečí; jízdní pruh uzavřen; nákladní automobil x osobní automobil, se zraněním.";
  const sit = buildTrafficSituationSummary({
    summaryFull: raw,
    impactFull: raw,
    eventType: "nehoda",
    road: "15",
    roadClass: "CLASS_I",
  });
  const road = resolvePresentationRoadNumber({ road: "15", roadClass: "CLASS_I" });
  ok("GEN_ROAD", road === "I/15", road);
  ok("GEN_TYPES", /nákladní/i.test(sit || "") && /osobní/i.test(sit || ""), sit);
  ok("GEN_INJURY", /zraněn/i.test(sit || ""), sit);
  ok("GEN_RESCUE", /záchrann/i.test(sit || "") && /vyprošť/i.test(sit || ""), sit);
  ok("GEN_LANE", /jízdní\s+pruh/i.test(sit || "") && /uzavřen/i.test(sit || ""), sit);
  ok("GEN_DANGER", /nebezpečí/i.test(sit || ""), sit);
  ok("GEN_NOT_BARE", !/^Nehoda dvou vozidel\.?$/i.test(String(sit || "").trim()), sit);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-hradec-accident-i57",
      pass,
      failCount: fails.length,
      fails,
      results,
      ROAD_CLASS_COMPOSITION_GUARD: results.filter((r) => /COMPOSE_|RESOLVE_|NO_DOUBLE|ROAD_I57|PLACE_I57|EXP_ROAD|GEN_ROAD/.test(r.id)).every((r) => r.pass),
      VEHICLE_TYPE_GUARD: results.filter((r) => /LEAD_TRUCK|LEAD_CAR|SIT_TRUCK|SIT_CAR|GEN_TYPES|LEAD_NOT_GENERIC|SIT_NOT_BARE/.test(r.id)).every((r) => r.pass),
      INJURY_GUARD: results.filter((r) => /INJURY|LEAD_INJURY/.test(r.id)).every((r) => r.pass),
      LANE_CLOSURE_GUARD: results.filter((r) => /LANE|SCOPE_SINGLE|IS_SINGLE/.test(r.id)).every((r) => r.pass),
      RESCUE_EXTRICATION_GUARD: results.filter((r) => /RESCUE|EXTRICATION|GEN_RESCUE/.test(r.id)).every((r) => r.pass),
      NO_HALLUCINATION_GUARD: results.filter((r) => r.id.startsWith("NO_")).every((r) => r.pass),
      TRAFFIC_INFORMATION_VALUE_GUARD: results
        .filter((r) => /SIT_|LEAD_|GEN_|RAW_|MUNI|DISTRICT|EXP_CLASS|DANGER/.test(r.id))
        .every((r) => r.pass),
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
