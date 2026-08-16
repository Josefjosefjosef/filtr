#!/usr/bin/env node
/**
 * Impassable-lane fact preservation + EXIT role (event AT exit vs diversion VIA exit).
 * Fixture-based — no D1/349.3/354 hardcode pass path.
 * Pure local, no network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOfficialCommentFacts,
  parseLaneImpactFactsFromText,
  isSingleLaneRestriction,
  isFullScopeClosure,
  analyzeRestrictionScope,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
  buildTrafficCardPresentation,
  classifyEventPresentation,
  parseEmergencyServicesStatusFromText,
  EMERGENCY_SERVICES_STATUS,
  RESTRICTION_SCOPE,
  EVENT_KIND,
  ACCIDENT_PARTICIPANT,
} from "../assets/iu-traffic-card-presenter-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRESENTER = path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js");

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
  "D1 EXIT 354 - km 349.3, ve směru Brno, Od 15.08.2026 12:00 Do 15.08.2026 18:15, neprůjezdný pruh, 3 havarovaná vozidla; probíhají záchranné a vyprošťovací práce, nebezpečí; 3x OA, na místě složky IZS";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  summary: REF_RAW,
  eventType: "nehoda",
  road: "D1",
  roadClass: "MOTORWAY",
  direction: "Brno",
  km: "349.3",
};

const DIVERSION_RAW =
  "D1, km 349.5, ve směru Brno, uzavřeno, probíhá vyšetřování nehody, DN 3 OA, probíhá vyšetřování nehody, odklon dopravy na EXITu 354";

const RIGHT_LANE_RAW =
  "D11, km 10–12, směr Praha, Od 20.08.2026 22:00 Do 21.08.2026 05:00, pravý jízdní pruh uzavřen, práce na silnici.";

const SHOULDER_RAW =
  "D11, mezi km 45.9 a 46, ve směru Hradec Králové, porouchané vozidlo, zpevněná krajnice (odstavný pruh) uzavřená";

const LIBEREC_EN_ROUTE =
  "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.";

const WRONG_WAY_RAW = "D49, km 12, ve směru Zlín, nebezpečí, vozidlo v protisměru.";
const ANIMAL_RAW = "D10, km 20, ve směru Praha, nehoda, střet osobního automobilu se srnou.";
const OIL_RAW =
  "Heřmanovice, silnice I/57, překážka na vozovce, olej na vozovce, probíhají odklízecí práce, PČR a HZS na místě.";
const ROADWORK_RAW = "Řídky, práce na silnici, údržba a opravy, rozsah: zpevněná krajnice.";
const KOSTELANY_RAW =
  "silnice III/42819, silnice III/42826, v katastru obce Kostelany, okr. Kroměříž, Od 15.08.2026 00:00, Do 16.08.2026 23:59, uzavřeno; sportovní akce; 55. ročník Barum Czech Rally Zlín 2026, Vydal: ŘSD";

// --- Existing lane model audit ---
{
  const src = fs.readFileSync(PRESENTER, "utf8");
  ok(
    "EXISTING_LANE_MODEL_FOUND",
    /RESTRICTION_SCOPE\.SINGLE_LANE_CLOSED/.test(src) &&
      /isSingleLaneRestriction/.test(src) &&
      /parseLaneImpactFactsFromText/.test(src)
  );
  ok(
    "EXISTING_LANE_MODEL_FIELDS",
    /laneImpassable|laneRestriction|affectedLane|SINGLE_LANE_CLOSED/.test(src)
  );
}

// --- Reference: impassable lane + event AT EXIT ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const lane = parseLaneImpactFactsFromText(REF_RAW);
  const ev = classifyEventPresentation(REF_INPUT);
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  const place = String(buildPlaceAndDirectionLine(REF_INPUT) || "");
  const card = buildTrafficCardPresentation(REF_INPUT);
  const rows = rowMap(card);
  const scope = analyzeRestrictionScope(REF_RAW);

  ok("LANE_IMPACT_SOURCE_PRESENT", /neprůjezdný\s+pruh/i.test(REF_RAW));
  ok("LANE_IMPACT_EXTRACTED", isSingleLaneRestriction(REF_RAW) === true);
  ok("LANE_IMPACT_STRUCTURED", facts.laneImpassable === true && lane.laneImpassable === true);
  ok("LANE_IMPACT_TYPE_IMPASSABLE", facts.laneImpassable === true && !isFullScopeClosure(REF_RAW));
  ok("LANE_IMPACT_SIDE_UNKNOWN", facts.laneSide === "UNKNOWN" && lane.laneSide === "UNKNOWN");
  ok("SCOPE_SINGLE_LANE", scope === RESTRICTION_SCOPE.SINGLE_LANE_CLOSED, scope);
  ok("FULL_ROAD_CLOSURE_INFERRED_NO", isFullScopeClosure(REF_RAW) === false);
  ok("EVENT_TYPE_NEHODA", ev.kind === EVENT_KIND.ACCIDENT && /NEHODA/i.test(ev.titleCs || ""), ev.titleCs);

  ok("SIT_PARTICIPANTS", /tří\s+osobních\s+automobilů|3\s+osobních/i.test(sit), sit);
  ok("SIT_LANE_IMPASSABLE", /Neprůjezdný\s+jízdní\s+pruh/i.test(sit), sit);
  ok("SIT_NO_INVENTED_SIDE", !/\bpravý\b|\blevý\b|\bstřední\b/i.test(sit), sit);
  ok("SIT_IZS_ON_SCENE", /Na\s+místě\s+jsou\s+složky\s+IZS/i.test(sit), sit);
  ok("SIT_RESCUE", /záchranné/i.test(sit) && /vyprošťovací/i.test(sit), sit);
  ok("SIT_DANGER", /nebezpečí/i.test(sit), sit);
  ok("PARTICIPANT_COUNT", facts.accidentParticipantCount === 3, String(facts.accidentParticipantCount));
  ok(
    "PARTICIPANT_TYPE",
    facts.accidentParticipantType === ACCIDENT_PARTICIPANT.PASSENGER_CAR ||
      (facts.accidentParticipants || []).includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR),
    String(facts.accidentParticipantType)
  );
  ok(
    "IZS_ON_SCENE",
    facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.ON_SCENE,
    String(facts.emergencyServicesStatus)
  );

  ok("PLACE_WITH_EXIT", /D1/.test(place) && /349[,.]3/.test(place) && /EXIT\s*354/i.test(place), place);
  ok("PRIMARY_EXIT_354", facts.exitNumber === "354" && facts.exitPrimaryLocation === true);
  ok(
    "HEADER_EXIT",
    card.communication && card.communication.exitHeaderLabel === "EXIT 354",
    card.communication && card.communication.exitHeaderLabel
  );
  ok("RAW_PRESERVED", /neprůjezdný\s+pruh/i.test(rows.sourceDescription || ""), rows.sourceDescription);
}

// --- IMPASSABLE_LANE_FACT_PRESERVATION_GUARD ---
{
  const sit = buildTrafficSituationSummary({
    impact: "nehoda; neprůjezdný pruh; 2x OA",
    impactFull: "nehoda; neprůjezdný pruh; 2x OA",
    eventType: "nehoda",
  });
  ok("IMPASSABLE_LANE_FACT_PRESERVATION_GUARD", /Neprůjezdný\s+jízdní\s+pruh/i.test(sit), sit);
}

// --- UNSPECIFIED_LANE_GUARD ---
{
  const lane = parseLaneImpactFactsFromText("neprůjezdný pruh");
  const sit = buildTrafficSituationSummary({
    impact: "nehoda; neprůjezdný pruh",
    eventType: "nehoda",
  });
  ok(
    "UNSPECIFIED_LANE_GUARD",
    lane.laneSide === "UNKNOWN" &&
      /Neprůjezdný\s+jízdní\s+pruh/i.test(sit) &&
      !/\bpravý\b|\blevý\b|\bstřední\b/i.test(sit),
    sit
  );
}

// --- RIGHT_LANE_POSITIVE_GUARD ---
{
  const lane = parseLaneImpactFactsFromText(RIGHT_LANE_RAW);
  const sit = buildTrafficSituationSummary({
    impact: RIGHT_LANE_RAW,
    impactFull: RIGHT_LANE_RAW,
    eventType: "prace",
    road: "D11",
    direction: "Praha",
  });
  ok("RIGHT_LANE_POSITIVE_GUARD", lane.laneSide === "RIGHT" && /pravý/i.test(sit), sit);
}

// --- SHOULDER_GUARD ---
{
  const scope = analyzeRestrictionScope(SHOULDER_RAW);
  const sit = buildTrafficSituationSummary({
    impact: SHOULDER_RAW,
    impactFull: SHOULDER_RAW,
    eventType: "prekazka",
    road: "D11",
  });
  ok(
    "SHOULDER_GUARD",
    (scope === RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED || /krajnice|odstavn/i.test(sit)) &&
      !/Neprůjezdný\s+jízdní\s+pruh/i.test(sit),
    scope + " / " + sit
  );
}

// --- LANE_VS_FULL_CLOSURE_GUARD ---
{
  ok(
    "LANE_VS_FULL_CLOSURE_GUARD",
    isSingleLaneRestriction("neprůjezdný pruh") === true &&
      isFullScopeClosure("neprůjezdný pruh") === false &&
      analyzeRestrictionScope("neprůjezdný pruh") === RESTRICTION_SCOPE.SINGLE_LANE_CLOSED
  );
}

// --- SUMMARY_PRIORITY_GUARD (busy accident must keep lane) ---
{
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  ok(
    "SUMMARY_PRIORITY_GUARD",
    /Neprůjezdný\s+jízdní\s+pruh/i.test(sit) &&
      /osobních\s+automobilů/i.test(sit) &&
      /IZS/i.test(sit) &&
      /záchranné/i.test(sit) &&
      /vyprošťovací/i.test(sit) &&
      /nebezpečí/i.test(sit),
    sit
  );
}

// --- EVENT_EXIT_ROLE_POSITIVE_GUARD ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok(
    "EVENT_EXIT_ROLE_POSITIVE_GUARD",
    facts.exitNumber === "354" && facts.exitPrimaryLocation === true && !facts.trafficDiversion
  );
}

// --- DIVERSION_EXIT_NEGATIVE_GUARD ---
{
  const facts = parseOfficialCommentFacts(DIVERSION_RAW);
  const place = buildPlaceAndDirectionLine({
    impact: DIVERSION_RAW,
    impactFull: DIVERSION_RAW,
    eventType: "uzavirka",
    road: "D1",
    direction: "Brno",
  });
  ok(
    "DIVERSION_EXIT_NEGATIVE_GUARD",
    facts.diversionExit === "354" &&
      facts.exitPrimaryLocation === false &&
      !/EXIT\s*354/i.test(place || ""),
    JSON.stringify({ d: facts.diversionExit, p: facts.exitPrimaryLocation, place })
  );
}

// --- EN_ROUTE ≠ ON_SCENE ---
{
  ok(
    "EN_ROUTE_VS_ON_SCENE",
    parseEmergencyServicesStatusFromText(LIBEREC_EN_ROUTE) ===
      EMERGENCY_SERVICES_STATUS.EN_ROUTE &&
      parseEmergencyServicesStatusFromText("na místě složky IZS") ===
        EMERGENCY_SERVICES_STATUS.ON_SCENE
  );
}

// --- Non-regression ---
{
  const ww = classifyEventPresentation({
    impact: WRONG_WAY_RAW,
    impactFull: WRONG_WAY_RAW,
    eventType: "prekazka",
    road: "D49",
  });
  ok("NONREG_WRONG_WAY", /PROTISMĚRU/i.test(ww.titleCs || ""), ww.titleCs);

  const animal = buildTrafficSituationSummary({
    impact: ANIMAL_RAW,
    impactFull: ANIMAL_RAW,
    eventType: "nehoda",
    road: "D10",
  });
  ok("NONREG_ANIMAL", /srn/i.test(animal), animal);

  const oil = buildTrafficSituationSummary({
    impact: OIL_RAW,
    impactFull: OIL_RAW,
    eventType: "prekazka",
  });
  ok("NONREG_OIL", /olej|odklízec/i.test(oil), oil);

  const rw = classifyEventPresentation({
    impact: ROADWORK_RAW,
    impactFull: ROADWORK_RAW,
    eventType: "prace",
  });
  ok("NONREG_ROADWORK", rw.kind === EVENT_KIND.ROADWORKS || /PRÁCE|ÚDRŽBA/i.test(rw.titleCs || ""), rw.kind);

  const kost = buildTrafficSituationSummary({
    impact: KOSTELANY_RAW,
    impactFull: KOSTELANY_RAW,
    eventType: "uzavirka",
    road: "III/42826",
    municipality: "Kostelany",
  });
  ok("NONREG_KOSTELANY", /sportovní\s+akc/i.test(kost) && /Barum/i.test(kost), kost);
}

{
  const src = fs.readFileSync(PRESENTER, "utf8");
  ok("NO_HARDCODE_D1_349_3", !/349\.3["'].*354|road\s*===\s*["']D1["'].*349/.test(src));
}

ok("MASTER_DATASET_PASS", fails.length === 0, String(fails.length));
ok(
  "PREVIOUSLY_CORRECT_CASES_BROKEN",
  fails.filter((f) => /^NONREG_/.test(f.split(":")[0])).length === 0,
  String(fails.filter((f) => /^NONREG_/).length)
);

const out = {
  guard: "iu-traffic-impassable-lane-exit-primary-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_IMPASSABLE_LANE_EXIT_PRIMARY_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_IMPASSABLE_LANE_EXIT_PRIMARY_GUARD_PASS");
