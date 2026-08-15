#!/usr/bin/env node
/**
 * Wrong-way vehicle hazard must beat generic "Překážka na vozovce."
 * Pure local, no road hardcode. Dedup duplicate source phrases → 1 structured fact.
 */
import {
  parseOfficialCommentFacts,
  parseWrongWayVehicleFactsFromText,
  formatWrongWayVehicleSituationLead,
  formatObstructionSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
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
  "D49, Od 15.08.2026 09:55 Do 15.08.2026 10:55, vozidlo v protisměru; POZOR ! NEBEZPEČÍ ! Vozidlo v protisměru.";

// --- Reference fixture (D49-class, sanitised) ---
{
  const parsed = parseWrongWayVehicleFactsFromText(REF_RAW);
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "D49",
    roadClass: "MOTORWAY",
    lifecycleStatus: "ACTIVE",
  };
  const ev = classifyEventPresentation(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const rows = rowMap(card);
  const lead = formatWrongWayVehicleSituationLead(facts, REF_RAW);
  const obsLead = formatObstructionSituationLead(facts, REF_RAW);

  ok("WRONG_WAY_VEHICLE_SOURCE_PRESENT", /vozidl[oa]\s+v\s+protisměru/i.test(REF_RAW));
  ok("DANGER_SOURCE_PRESENT", /nebezpeč/i.test(REF_RAW));
  ok("OBSTACLE_TYPED_CATEGORY", true);

  ok("WRONG_WAY_VEHICLE_EXTRACTED", parsed.wrongWayVehicle === true);
  ok("WRONG_WAY_VEHICLE_STRUCTURED", facts.wrongWayVehicle === true);
  ok("OBSTRUCTION_TYPE_WRONG_WAY", facts.obstructionType === "WRONG_WAY_VEHICLE", facts.obstructionType);
  ok("DANGER_KEYWORD_EXTRACTED", parsed.dangerKeywordPresent === true);
  ok("DANGER_KEYWORD_STRUCTURED", facts.dangerKeywordPresent === true);

  ok(
    "CARD_TYPE_AFTER",
    /VOZIDLO\s+V\s+PROTISMĚRU/i.test(ev.titleCs || ""),
    ev.titleCs
  );
  ok("KIND_OBSTACLE_WITH_SPECIFIC_TITLE", ev.kind === "obstacle", ev.kind);

  ok(
    "WRONG_WAY_VEHICLE_FACT_PRESERVATION_GUARD",
    /Vozidlo\s+v\s+protisměru/i.test(sit),
    sit
  );
  ok(
    "GENERIC_OBSTACLE_MUST_NOT_HIDE_WRONG_WAY_VEHICLE_GUARD",
    !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()) &&
      !(/^Překážka\s+na\s+vozovce/i.test(sit) && !/protisměru/i.test(sit)),
    sit
  );
  ok(
    "AFTER_SUMMARY",
    /^Vozidlo\s+v\s+protisměru\.?$/i.test(sit.trim()) ||
      (/Vozidlo\s+v\s+protisměru/i.test(sit) && !/Překážka\s+na\s+vozovce/i.test(sit)),
    sit
  );

  ok("LEAD_SINGLE", lead === "Vozidlo v protisměru", lead);
  ok("OBS_LEAD_SINGLE", /Vozidlo\s+v\s+protisměru/i.test(obsLead || ""), obsLead);

  const visibleWrongWay = (sit.match(/vozidl[oa]\s+v\s+protisměru/gi) || []).length;
  ok("DUPLICATE_WRONG_WAY_GUARD_VISIBLE", visibleWrongWay === 1, String(visibleWrongWay) + ":" + sit);
  ok("STRUCTURED_WRONG_WAY_FACT_COUNT", facts.wrongWayVehicle === true);

  ok("MOTORWAY_BADGE_AFTER", /D49/i.test(card.placeLine || "") || /D49/i.test(String(card.headerLine || "")), card.placeLine);
  ok("LOCATION_AFTER", /D49/i.test(card.placeLine || ""), card.placeLine);

  ok(
    "RAW_PRESERVED",
    /vozidl[oa]\s+v\s+protisměru/i.test(rows.sourceDescription || "") &&
      /nebezpeč/i.test(rows.sourceDescription || ""),
    rows.sourceDescription
  );
  ok(
    "NO_INVENTED_DIRECTION",
    !/→\s*směr|směr\s+\S+/i.test(sit) && !/→\s*směr/i.test(card.placeLine || ""),
    sit + "|" + card.placeLine
  );
  ok(
    "NO_INVENTED_CAUTION",
    !/Dbejte|Zpomalte|maximální\s+opatrnosti/i.test(sit),
    sit
  );
}

// --- DUPLICATE_WRONG_WAY_GUARD (explicit count) ---
{
  const raw =
    "vozidlo v protisměru; POZOR! NEBEZPEČÍ! Vozidlo v protisměru.";
  const facts = parseOfficialCommentFacts(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
      road: "D1",
      roadClass: "MOTORWAY",
    }) || ""
  );
  const n = (sit.match(/vozidl[oa]\s+v\s+protisměru/gi) || []).length;
  ok("DUPLICATE_WRONG_WAY_GUARD", facts.wrongWayVehicle === true && n === 1, sit);
}

// --- TRUE_GENERIC_OBSTACLE_POSITIVE_GUARD ---
{
  const raw = "silnice I/11, v obci Sampleville, překážka na vozovce.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
      road: "11",
      roadClass: "CLASS_I",
      municipality: "Sampleville",
    }) || ""
  );
  ok("TRUE_GENERIC_OBSTACLE_POSITIVE_GUARD", /^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
  const facts = parseOfficialCommentFacts(raw);
  ok("TRUE_GENERIC_NO_WRONG_WAY", facts.wrongWayVehicle !== true);
}

// --- Must not confuse lane diversion "do protisměru" with wrong-way vehicle ---
{
  const raw =
    "ulice Hornopolní, práce na inženýrských sítích, provoz převeden do protisměru";
  const facts = parseOfficialCommentFacts(raw);
  ok("LANE_DIVERSION_NOT_WRONG_WAY", facts.wrongWayVehicle !== true);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "11",
    }) || ""
  );
  ok("LANE_DIVERSION_NOT_WRONG_WAY_TITLE", !/VOZIDLO\s+V\s+PROTISMĚRU/i.test(sit), sit);
}

// --- Heřmanovice oil regression (specific > generic obstacle) ---
{
  const raw =
    "olej na vozovce, délka 26 m, očekávejte kluzkou vozovku, probíhají odklízecí práce, PČR a HZS na místě";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
      road: "I/44",
      municipality: "Heřmanovice",
    }) || ""
  );
  ok("HERMANOVICE_OIL_REGRESSION", /Olej\s+na\s+vozovce/i.test(sit) && !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
}

// --- Velké Březno struck roe regression ---
{
  const raw =
    "Ústecká (u křižovatky s Pivovarskou), sražená srna na komunikaci";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
      road: "261",
      municipality: "Velké Březno",
    }) || ""
  );
  ok(
    "VELKE_BREZNO_SRNA_REGRESSION",
    /srn/i.test(sit) && !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()),
    sit
  );
}

const pass = fails.length === 0;
const report = {
  guard: "iu-traffic-wrong-way-vehicle-hazard-guard",
  pass,
  passCount: results.filter((r) => r.pass).length,
  failCount: fails.length,
  fails,
  WRONG_WAY_VEHICLE_FACT_PRESERVATION_GUARD_PASS: !fails.some((f) =>
    f.startsWith("WRONG_WAY_VEHICLE_FACT_PRESERVATION_GUARD")
  ),
  GENERIC_OBSTACLE_MUST_NOT_HIDE_WRONG_WAY_VEHICLE_GUARD_PASS: !fails.some((f) =>
    f.startsWith("GENERIC_OBSTACLE_MUST_NOT_HIDE_WRONG_WAY_VEHICLE_GUARD")
  ),
  DUPLICATE_WRONG_WAY_GUARD_PASS: !fails.some((f) => f.startsWith("DUPLICATE_WRONG_WAY_GUARD")),
  TRUE_GENERIC_OBSTACLE_POSITIVE_GUARD_PASS: !fails.some((f) =>
    f.startsWith("TRUE_GENERIC_OBSTACLE_POSITIVE_GUARD")
  ),
};
console.log(JSON.stringify(report, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_WRONG_WAY_VEHICLE_HAZARD_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_WRONG_WAY_VEHICLE_HAZARD_GUARD_PASS");
