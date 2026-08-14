#!/usr/bin/env node
/**
 * MUNICIPALITY_STREET_HEADER + ACCIDENT_PARTICIPANTS (OA×cyclist) +
 * EMERGENCY_RESPONSE_STATUS_PRESERVATION guards.
 *
 * Fixture-based general rules — no municipality / street / event-id hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  parseAccidentParticipantsFromText,
  parseEmergencyServicesStatusFromText,
  formatAccidentSituationLead,
  expandTrafficAbbreviationsCs,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  classifyEventPresentation,
  ACCIDENT_PARTICIPANT,
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

const REF_RAW =
  "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.";

const GENERIC_RAW =
  "Od 1.1.2026 10:00 do 11:00; v ulici Testovací v obci Sampleville; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.";

// --- Reference urban accident fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "nehoda",
    municipality: "Liberec",
  };
  const ev = classifyEventPresentation(input);
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const lead = formatAccidentSituationLead(expandTrafficAbbreviationsCs(REF_RAW), facts);
  const parts = facts.accidentParticipants || [];

  ok("EVENT_ACCIDENT", ev.kind === "accident", ev.kind);
  ok("STREET_STRUCTURED", /Ještědská/i.test(String(facts.street || "")), facts.street);
  ok("CITY_STRUCTURED", /Liberec/i.test(String(facts.city || "")), facts.city);
  ok("MUNI_SIGN", /LIBEREC/i.test(String(hdr.municipalitySignLabel || "")), hdr.municipalitySignLabel);
  ok(
    "MUNICIPALITY_STREET_HEADER",
    /LIBEREC/i.test(String(hdr.municipalitySignLabel || "")) &&
      /^ulice:\s*Ještědská$/i.test(String(hdr.besideLocality || hdr.streetLabel || "")),
    JSON.stringify({ beside: hdr.besideLocality, streetLabel: hdr.streetLabel, sign: hdr.municipalitySignLabel })
  );
  ok("STREET_NOT_AS_MUNI", !/JEŠTĚDSKÁ|JESTEDSKA/i.test(String(hdr.municipalitySignLabel || "")));
  ok("PARTICIPANT_OA", parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR), JSON.stringify(parts));
  ok("PARTICIPANT_CYCLIST", parts.includes(ACCIDENT_PARTICIPANT.CYCLIST), JSON.stringify(parts));
  ok("PARTICIPANTS_LEN", parts.length >= 2, JSON.stringify(parts));
  ok("IZS_STATUS_EN_ROUTE", facts.emergencyServicesStatus === EMERGENCY_SERVICES_STATUS.EN_ROUTE, facts.emergencyServicesStatus);
  ok("LEAD_PARTS", /osobní/i.test(lead || "") && /cyklist/i.test(lead || ""), lead);
  ok("SIT_PARTICIPANTS", /osobní/i.test(sit) && /cyklist/i.test(sit), sit);
  ok("SIT_PEOPLE_ON_ROAD", /lidé\s+na\s+vozovce/i.test(sit), sit);
  ok("SIT_INVESTIGATION", /vyšetřování/i.test(sit), sit);
  ok("SIT_IZS_EN_ROUTE", /na\s+místo\s+jedou\s+složky\s+IZS/i.test(sit), sit);
  ok("SIT_NOT_ON_SCENE", !/na\s+místě\s+složky\s+IZS/i.test(sit), sit);
  ok("NO_INJURY_INVENTED", !/zraněn/i.test(sit), sit);
  ok("NO_POLICE_INVENTED", !/polici/i.test(sit), sit);
  ok("NO_FIRE_INVENTED", !/hasič/i.test(sit), sit);
  ok("NO_ZZS_INVENTED", !/\bZZS\b|záchranná\s+služba/i.test(sit), sit);
  ok("CARD_HEADER_STREET", /ulice:\s*Ještědská/i.test(String(card.placeLine || "") + " " + String((card.communication && card.communication.besideLocality) || "") + " " + String((card.communication && card.communication.streetLabel) || "")), JSON.stringify(card.communication || {}));
}

// --- Generic municipality + street (no Liberec/Ještědská hardcode path) ---
{
  const facts = parseOfficialCommentFacts(GENERIC_RAW);
  const input = {
    impact: GENERIC_RAW,
    impactFull: GENERIC_RAW,
    eventType: "nehoda",
    municipality: "Sampleville",
  };
  const hdr = buildLocalityHeaderModel(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok("GENERIC_STREET", /Testovací/i.test(String(facts.street || "")), facts.street);
  ok(
    "GENERIC_HEADER",
    /SAMPLEVILLE/i.test(String(hdr.municipalitySignLabel || "")) &&
      /ulice:\s*Testovací/i.test(String(hdr.besideLocality || hdr.streetLabel || "")),
    JSON.stringify({ sign: hdr.municipalitySignLabel, beside: hdr.besideLocality, streetLabel: hdr.streetLabel })
  );
  ok("GENERIC_PARTS", /osobní/i.test(sit) && /cyklist/i.test(sit), sit);
  ok("GENERIC_IZS_EN_ROUTE", /na\s+místo\s+jedou/i.test(sit) && !/na\s+místě\s+složky/i.test(sit), sit);
}

// --- Municipality without street → sign only ---
{
  const raw = "Od 1.1.2026 10:00; v obci Sampleville; nehoda; probíhá vyšetřování nehody.";
  const input = { impact: raw, impactFull: raw, eventType: "nehoda", municipality: "Sampleville" };
  const hdr = buildLocalityHeaderModel(input);
  ok("MUNI_ONLY_SIGN", /SAMPLEVILLE/i.test(String(hdr.municipalitySignLabel || "")), hdr.municipalitySignLabel);
  ok(
    "MUNI_ONLY_NO_STREET_PREFIX",
    !/^ulice:/i.test(String(hdr.besideLocality || "")),
    hdr.besideLocality
  );
}

// --- Participant parse unit ---
{
  const parts = parseAccidentParticipantsFromText("nehoda; OA x cyklista, na místo jedou složky IZS.");
  ok("PARSE_OA", parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR), JSON.stringify(parts));
  ok("PARSE_CYCLIST", parts.includes(ACCIDENT_PARTICIPANT.CYCLIST), JSON.stringify(parts));
  const lead = formatAccidentSituationLead(expandTrafficAbbreviationsCs("nehoda; OA x cyklista."), {
    accidentParticipants: parts,
  });
  ok("LEAD_OA_CYCLIST", /osobní/i.test(lead || "") && /cyklist/i.test(lead || ""), lead);
}

// --- IZS state A/B ---
{
  ok(
    "IZS_EN_ROUTE_A",
    parseEmergencyServicesStatusFromText("na místo jedou složky IZS") ===
      EMERGENCY_SERVICES_STATUS.EN_ROUTE
  );
  ok(
    "IZS_ON_SCENE_B",
    parseEmergencyServicesStatusFromText("na místě jsou složky IZS") ===
      EMERGENCY_SERVICES_STATUS.ON_SCENE
  );
  ok(
    "IZS_ON_SCENE_SHORT",
    parseEmergencyServicesStatusFromText("Na místě složky IZS.") ===
      EMERGENCY_SERVICES_STATUS.ON_SCENE
  );
  const enSit = String(
    buildTrafficSituationSummary({
      impact: "nehoda; OA x cyklista, na místo jedou složky IZS.",
      impactFull: "nehoda; OA x cyklista, na místo jedou složky IZS.",
      eventType: "nehoda",
    }) || ""
  );
  const onSit = String(
    buildTrafficSituationSummary({
      impact: "nehoda; na místě jsou složky IZS.",
      impactFull: "nehoda; na místě jsou složky IZS.",
      eventType: "nehoda",
    }) || ""
  );
  ok("EMERGENCY_RESPONSE_STATUS_PRESERVATION_EN", /na\s+místo\s+jedou/i.test(enSit) && !/na\s+místě\s+složky/i.test(enSit), enSit);
  ok("EMERGENCY_RESPONSE_STATUS_PRESERVATION_ON", /na\s+místě/i.test(onSit) && !/na\s+místo\s+jedou/i.test(onSit), onSit);
}

// --- Praha + Jižní spojka SMV must stay non-ulice first-row ---
{
  const REF = {
    municipality: "Praha",
    street: "Jižní spojka",
    impact:
      "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
    impactFull:
      "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
    eventType: "prekazka",
    category: "prekazka",
  };
  const hdr = buildLocalityHeaderModel(REF);
  ok("SMV_MUNI", hdr.municipalitySignLabel === "PRAHA", hdr.municipalitySignLabel);
  ok("SMV_BESIDE_PLAIN", hdr.besideLocality === "Jižní spojka", hdr.besideLocality);
  ok("SMV_NO_ULICE_FIRST", !/^ulice:/i.test(String(hdr.besideLocality || "")));
  ok("SMV_FLAG", hdr.namedSmvRoad === true);
}

// --- Street names starting with Je* must not be verb-noise rejected ---
{
  const f = parseOfficialCommentFacts("v ulici Jelení v obci Sampleville; nehoda.");
  ok("JE_PREFIX_STREET", /Jelení/i.test(String(f.street || "")), f.street);
}

const passN = results.filter((r) => r.pass).length;
const out = {
  guard: "iu-traffic-municipality-street-accident-izs-guard",
  total: results.length,
  pass: passN,
  fail: fails.length,
  fails,
  MUNICIPALITY_STREET_HEADER_GUARD_PASS: !fails.some((f) =>
    /MUNICIPALITY_STREET|MUNI_|GENERIC_HEADER|STREET_|SMV_|JE_PREFIX/.test(f)
  ),
  ACCIDENT_PARTICIPANTS_GUARD_PASS: !fails.some((f) =>
    /PARTICIPANT|PARSE_|LEAD_|SIT_PARTICIPANTS|GENERIC_PARTS/.test(f)
  ),
  EMERGENCY_RESPONSE_STATUS_PRESERVATION_GUARD_PASS: !fails.some((f) =>
    /IZS_|EMERGENCY_RESPONSE|SIT_IZS|SIT_NOT_ON|GENERIC_IZS/.test(f)
  ),
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_MUNICIPALITY_STREET_ACCIDENT_IZS_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_MUNICIPALITY_STREET_ACCIDENT_IZS_PASS");
