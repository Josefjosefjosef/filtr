#!/usr/bin/env node
/**
 * Obstacle oil / impact-length / slippery / cleanup / named emergency ON_SCENE guard.
 *
 * Specific hazard facts must beat generic "Překážka na vozovce." fallback.
 * EN_ROUTE (Liberec-style IZS) must remain distinct from ON_SCENE (PČR+HZS).
 * No municipality / road / exact-string hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  parseEmergencyServicesStatusFromText,
  formatObstructionSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  classifyEventPresentation,
  analyzePrimaryCause,
  EMERGENCY_SERVICES_STATUS,
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
  "Od 14.8.2026 19:15 do 15.8.2026 19:20; na silnici 453 v obci Heřmanovice okres Bruntál, délka 26m; Pozor! Olej na vozovce; očekávejte kluzkou vozovku; probíhají odklízecí práce; PČR a HZS na místě.";

const GENERIC_RAW =
  "Od 1.1.2026 10:00 do 12:00; na silnici 999 v obci Sampleville okres Testdistrict, délka 40m; Pozor! Olej na vozovce; očekávejte kluzkou vozovku; probíhají odklízecí práce; PČR a HZS na místě.";

const LIBEREC_EN_ROUTE =
  "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.";

const FUTURE_D11 =
  "Od 20.8.2026 22:00 do 21.8.2026 05:00; na dálnici D11; práce na silnici; ve směru Praha bude uzavřen jízdní pruh; provoz bude převeden.";

// --- Reference oil-on-road obstacle fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "II/453",
    municipality: "Heřmanovice",
    district: "Bruntál",
  };
  const ev = classifyEventPresentation(input);
  const cause = analyzePrimaryCause(REF_RAW, input);
  const lead = formatObstructionSituationLead(facts, REF_RAW);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const hdr = buildLocalityHeaderModel(input);
  const rows = rowMap(card);

  ok("EVENT_OBSTACLE", ev.kind === "obstacle" && cause === "OBSTACLE", ev.kind + "/" + cause);
  ok("TITLE_OBSTACLE", /PŘEKÁŽKA\s+NA\s+VOZOVCE/i.test(ev.titleCs || ""), ev.titleCs);
  ok("MUNICIPALITY_SIGN_AFTER", /HEŘMANOVICE|HERMANOVICE/i.test(String(hdr.municipalitySignLabel || "")), hdr.municipalitySignLabel);
  ok("ROAD_BADGE_AFTER", /II\/453/i.test(String(card.placeLine || "") + " " + String((card.communication && card.communication.roadBadge) || "")), card.placeLine);
  ok("LOCATION_AFTER", /II\/453/i.test(card.placeLine || "") && /Heřmanovice/i.test(card.placeLine || "") && /Bruntál/i.test(card.placeLine || ""), card.placeLine);

  ok("OIL_ON_ROAD_PRESENT", facts.oilOnRoad === true, String(facts.oilOnRoad));
  ok("OIL_ON_ROAD_STRUCTURED", facts.obstructionType === "OIL_ON_ROAD", facts.obstructionType);
  ok("OIL_ON_ROAD_FACT_PRESERVATION_GUARD", /olej\s+na\s+vozovce/i.test(sit), sit);
  ok("OIL_ON_ROAD_USED_IN_COLLAPSED", /olej\s+na\s+vozovce/i.test(sit), sit);

  ok("TRAFFIC_IMPACT_LENGTH_PRESERVATION_GUARD", facts.impactLengthMeters === 26, facts.impactLengthMeters);
  ok("LENGTH_SEMANTIC", facts.impactLengthSemantic === "AFFECTED_SEGMENT", facts.impactLengthSemantic);
  ok("LENGTH_USED_IN_COLLAPSED", /26\s*m/i.test(sit), sit);
  ok("LENGTH_NOT_KILOMETRAGE", !facts.kilometerLabel && !rows.kilometer, String(facts.kilometerLabel) + "/" + String(rows.kilometer));

  ok("SLIPPERY_ROAD_EXPECTED", facts.slipperyRoadExpected === true, String(facts.slipperyRoadExpected));
  ok("SLIPPERY_ROAD_USED_IN_COLLAPSED", /očekávejte\s+kluzkou\s+vozovku/i.test(sit), sit);
  ok("SLIPPERY_ROAD_MODALITY_PRESERVED", /očekávejte\s+kluzkou\s+vozovku/i.test(sit) && !/vozovka\s+je\s+kluzká/i.test(sit), sit);

  ok("CLEANUP_WORK_IN_PROGRESS", facts.cleanupWorkInProgress === true, String(facts.cleanupWorkInProgress));
  ok("CLEANUP_WORK_USED_IN_COLLAPSED", /odklízecí\s+práce/i.test(sit), sit);

  ok("POLICE_PRESENT", facts.policePresent === true, String(facts.policePresent));
  ok("FIRE_RESCUE_PRESENT", facts.fireRescuePresent === true, String(facts.fireRescuePresent));
  ok("POLICE_STATUS_ON_SCENE", facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.ON_SCENE, facts.emergencyServicesStatus);
  ok("FIRE_RESCUE_STATUS_ON_SCENE", facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.ON_SCENE, facts.emergencyServicesStatus);
  ok("EMERGENCY_NAMED_UNITS", /PČR/i.test(sit) && /HZS/i.test(sit), sit);
  ok("EMERGENCY_NOT_GENERIC_ONLY", !(/^.*složky\s+IZS\.?$/i.test(sit) && !/PČR/i.test(sit)), sit);
  ok("NO_ZZS_INVENTED", !/\bZZS\b/i.test(sit), sit);

  ok("LEAD_SPECIFIC", /olej\s+na\s+vozovce/i.test(lead || ""), lead);
  ok("GENERIC_OBSTACLE_FALLBACK_MUST_NOT_HIDE_SPECIFIC_FACTS_GUARD", !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
  ok("GENERIC_OBSTACLE_FALLBACK_USED_AS_ONLY_SUMMARY", !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
  ok("NO_RAW_DUMP", !/Pozor!\s*Olej/i.test(sit) && !/;/.test(sit), sit);
  ok("ACTIVE_PRESENT_TENSE", /Probíhají\s+odklízecí/i.test(sit) && /Na\s+místě\s+jsou/i.test(sit), sit);
  ok("NOT_FUTURE_TENSE", !/budou\s+probíhat|bude\s+na\s+místě/i.test(sit), sit);
}

// --- Generic municipality/road (no Heřmanovice / II/453 hardcode path) ---
{
  const facts = parseOfficialCommentFacts(GENERIC_RAW);
  const input = {
    impact: GENERIC_RAW,
    impactFull: GENERIC_RAW,
    eventType: "prekazka",
    road: "II/999",
    municipality: "Sampleville",
    district: "Testdistrict",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok("GENERIC_OIL", facts.oilOnRoad === true && /olej\s+na\s+vozovce/i.test(sit), sit);
  ok("GENERIC_LENGTH", facts.impactLengthMeters === 40 && /40\s*m/i.test(sit), sit);
  ok("GENERIC_SLIPPERY", /očekávejte\s+kluzkou\s+vozovku/i.test(sit), sit);
  ok("GENERIC_CLEANUP", /odklízecí\s+práce/i.test(sit), sit);
  ok("GENERIC_ON_SCENE", facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.ON_SCENE && /PČR/i.test(sit) && /HZS/i.test(sit), sit);
  ok("GENERIC_NOT_FALLBACK", !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
}

// --- Liberec EN_ROUTE must stay EN_ROUTE (≠ ON_SCENE) ---
{
  const facts = parseOfficialCommentFacts(LIBEREC_EN_ROUTE);
  const sit = String(
    buildTrafficSituationSummary({
      impact: LIBEREC_EN_ROUTE,
      impactFull: LIBEREC_EN_ROUTE,
      eventType: "nehoda",
      municipality: "Liberec",
    }) || ""
  );
  ok("LIBEREC_IZS_EN_ROUTE", facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.EN_ROUTE, facts.emergencyServicesStatus);
  ok("LIBEREC_SIT_EN_ROUTE", /na\s+místo\s+jedou\s+složky\s+IZS/i.test(sit), sit);
  ok("LIBEREC_NOT_ON_SCENE", !/na\s+místě\s+(?:jsou\s+)?(?:složky\s+IZS|PČR)/i.test(sit), sit);
  ok(
    "EMERGENCY_SERVICES_STATE_PRESERVED",
    parseEmergencyServicesStatusFromText("na místo jedou složky IZS") ===
      EMERGENCY_SERVICES_STATUS.EN_ROUTE &&
      parseEmergencyServicesStatusFromText("PČR a HZS na místě") ===
        EMERGENCY_SERVICES_STATUS.ON_SCENE,
    "EN_ROUTE≠ON_SCENE"
  );
}

// --- Future tense regression (D11-class) must not flip to present via this change ---
{
  const sit = String(
    buildTrafficSituationSummary({
      impact: FUTURE_D11,
      impactFull: FUTURE_D11,
      eventType: "prace",
      road: "D11",
      validFrom: "2026-08-20T22:00:00+02:00",
      validTo: "2026-08-21T05:00:00+02:00",
    }) || ""
  );
  ok("FUTURE_TENSE_PRESERVED", /bude\s+uzavřen|bude\s+převeden/i.test(sit), sit);
}

// --- Bare obstacle without specifics may still use generic category summary ---
{
  const raw = "Od 1.1.2026 10:00; na silnici 100; překážka na vozovce.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
    }) || ""
  );
  ok("BARE_OBSTACLE_GENERIC_OK", /Překážka\s+na\s+vozovce/i.test(sit), sit);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-obstacle-oil-cleanup-facts-guard",
      pass,
      failCount: fails.length,
      fails,
      results,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
