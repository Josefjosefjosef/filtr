#!/usr/bin/env node
/**
 * Accident participants + soft may-block traffic impact guard.
 * Fixture-based general rules — no municipality / road-number hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  formatAccidentSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
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

const REF_RAW =
  "Od 13.8.2026 13:05 do 16:10; v ulici Opuštěná v obci Brno; nehoda nákladního vozidla; překážka, která může bránit provozu v celé šířce vozovky nebo její části; nákladní automobil x osobní automobil.";

// --- Reference fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "nehoda",
    road: "42",
    municipality: "Brno",
    street: "Opuštěná",
  };
  const lead = formatAccidentSituationLead(REF_RAW);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("EVENT_ACCIDENT", /nehoda/i.test(input.eventType), input.eventType);
  ok("STREET", /Opuštěná/i.test(card.placeLine || ""), card.placeLine);
  ok("MUNI", /Brno/i.test(card.placeLine || ""), card.placeLine);
  ok("SUBTYPE_PRESENT", !!facts.accidentSubtype, facts.accidentSubtype);
  ok(
    "TRUCK_PRESENT",
    (facts.accidentParticipants || []).includes("TRUCK"),
    JSON.stringify(facts.accidentParticipants)
  );
  ok(
    "PASSENGER_CAR_PRESENT",
    (facts.accidentParticipants || []).includes("PASSENGER_CAR"),
    JSON.stringify(facts.accidentParticipants)
  );
  ok(
    "TRAFFIC_IMPACT_PRESENT",
    facts.trafficImpactKind === "OBSTRUCTION_MAY_BLOCK_WHOLE_OR_PART",
    facts.trafficImpactKind
  );
  ok("TRAFFIC_IMPACT_MODALITY", facts.trafficImpactModality === "MAY", facts.trafficImpactModality);

  ok("LEAD_NOT_BARE", !/^Nehoda\.?$/i.test(String(lead || "").trim()), lead);
  ok("LEAD_TYPES", /nákladní/i.test(lead) && /osobní/i.test(lead), lead);
  ok("SIT_NOT_GENERIC_ONLY", !/^Nehoda\.?$/i.test(sit.trim()), sit);
  ok("SIT_PARTICIPANTS", /nákladní/i.test(sit) && /osobní/i.test(sit), sit);
  ok("SIT_IMPACT", /může\s+bránit/i.test(sit) && /šířce\s+vozovky/i.test(sit), sit);
  ok("SIT_MODALITY_MAY", /může/i.test(sit), sit);
  ok(
    "NO_HARD_CLOSURE",
    !/zcela\s+uzavřen|neprůjezdn|provoz\s+zastaven|úpln[áa]\s+uzavírk/i.test(sit),
    sit
  );
  ok("NO_INJURY_INFER", !/zraněn/i.test(sit), sit);
  ok("RAW_PRESERVED", /nákladní automobil x osobní/.test(rows.sourceDescription || ""));
  ok("PLACE_UNCHANGED_SHAPE", /42\s*·\s*ulice\s+Opuštěná\s*·\s*Brno/i.test(card.placeLine || ""), card.placeLine);
}

// --- Subtype without participant pair still beats bare Nehoda ---
{
  const t =
    "v ulici Alfa v obci Beta; nehoda nákladního vozidla; překážka, která může bránit provozu v celé šířce vozovky nebo její části.";
  const sit = String(
    buildTrafficSituationSummary({ impact: t, impactFull: t, eventType: "nehoda" }) || ""
  );
  ok("SUBTYPE_ONLY_NOT_BARE", !/^Nehoda\.?$/i.test(sit.trim()), sit);
  ok("SUBTYPE_ONLY_TRUCK", /nákladního\s+vozidla/i.test(sit), sit);
  ok("SUBTYPE_ONLY_IMPACT", /může\s+bránit/i.test(sit), sit);
}

// --- Generic information-value: specific facts must not collapse to bare category ---
{
  const cases = [
    {
      id: "PARTS",
      raw: "nehoda; nákladní automobil x osobní automobil.",
      need: /nákladní/i,
    },
    {
      id: "INJURY",
      raw: "2 havarovaná vozidla; nákladní automobil x osobní automobil, se zraněním.",
      need: /zraněn/i,
    },
    {
      id: "LANE",
      raw: "nehoda; jízdní pruh uzavřen; nákladní automobil x osobní automobil.",
      need: /jízdní\s+pruh|uzavřen/i,
    },
    {
      id: "OBSTRUCT",
      raw: "nehoda; překážka, která může bránit provozu v celé šířce vozovky nebo její části.",
      need: /může\s+bránit|nákladního\s+vozidla|Nehoda(?!\.)/i,
    },
  ];
  for (const c of cases) {
    const sit = String(
      buildTrafficSituationSummary({
        impact: c.raw,
        impactFull: c.raw,
        eventType: "nehoda",
      }) || ""
    );
    ok("INFO_NOT_BARE_" + c.id, !/^Nehoda\.?$/i.test(sit.trim()), sit);
    ok("INFO_HAS_" + c.id, c.need.test(sit), sit);
  }
}

// --- Cross regression: Hradec-class must stay rich ---
{
  const REF =
    "Od 13.8.2026 13:45 do 15:50; na silnici 57 v obci Hradec nad Moravicí okres Opava; 2 havarovaná vozidla; probíhají záchranné a vyprošťovací práce, nebezpečí; jízdní pruh uzavřen; nákladní automobil x osobní automobil, se zraněním.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: REF,
      impactFull: REF,
      eventType: "nehoda",
      road: "57",
      roadClass: "CLASS_I",
      municipality: "Hradec nad Moravicí",
      district: "Opava",
    }) || ""
  );
  ok("HRADEC_NOT_BARE", !/^Nehoda\.?$/i.test(sit.trim()), sit);
  ok("HRADEC_TYPES", /nákladní/i.test(sit) && /osobní/i.test(sit), sit);
  ok("HRADEC_INJURY", /zraněn/i.test(sit), sit);
  ok("HRADEC_RESCUE", /záchrann|vyprošťov/i.test(sit), sit);
  ok("HRADEC_LANE", /jízdní\s+pruh/i.test(sit), sit);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  BRNO_OPUSTENA_FIXTURE: results
    .filter((r) =>
      [
        "SUBTYPE_PRESENT",
        "TRUCK_PRESENT",
        "PASSENGER_CAR_PRESENT",
        "TRAFFIC_IMPACT_PRESENT",
        "TRAFFIC_IMPACT_MODALITY",
        "SIT_NOT_GENERIC_ONLY",
        "SIT_PARTICIPANTS",
        "SIT_IMPACT",
      ].includes(r.id)
    )
    .every((r) => r.pass),
  GENERIC_ACCIDENT_GUARD: results
    .filter((r) => r.id.includes("NOT_BARE") || r.id.includes("NOT_GENERIC"))
    .every((r) => r.pass),
  PARTICIPANT_GUARD: results
    .filter((r) => r.id.includes("TRUCK") || r.id.includes("PASSENGER") || r.id.includes("PARTICIPANT"))
    .every((r) => r.pass),
  TRAFFIC_IMPACT_GUARD: results
    .filter((r) => r.id.includes("IMPACT") || r.id.includes("OBSTRUCT"))
    .every((r) => r.pass),
  MODALITY_GUARD: results
    .filter((r) => r.id.includes("MODALITY") || r.id.includes("NO_HARD"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("INFO_")).every((r) => r.pass),
  HRADEC_REGRESSION: results.filter((r) => r.id.startsWith("HRADEC_")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_ACCIDENT_PARTICIPANTS_MAY_BLOCK_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_ACCIDENT_PARTICIPANTS_MAY_BLOCK_GUARD_PASS");
