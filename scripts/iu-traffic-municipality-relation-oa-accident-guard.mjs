#!/usr/bin/env node
/**
 * MUNICIPALITY_RELATION_PRESERVATION + OA accident (havárie OA) +
 * ACCIDENT_VEHICLE_SEMANTIC_MERGE guards.
 *
 * Fixture-based — no municipality / road hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  parseAccidentParticipantsFromText,
  formatAccidentSituationLead,
  expandTrafficAbbreviationsCs,
  buildTrafficSituationSummary,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  ACCIDENT_PARTICIPANT,
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

const NEAR_RAW =
  "Od 14.8.2026 18:00 do 19:00; na silnici 263 u obce Horní Police okres Česká Lípa; nehoda; probíhá vyšetřování nehody; havárie OA.";

const NEAR_GENERIC_RAW =
  "Od 1.1.2026 12:00 do 13:00; na silnici 101 u obce Sampleville okres Sample District; nehoda; probíhá vyšetřování nehody; havárie OA.";

const IN_RAW =
  "Od 14.8.2026 18:00 do 19:00; na silnici II/263 v obci Horní Police okres Česká Lípa; nehoda; probíhá vyšetřování nehody; havárie OA.";

const CYCLIST_RAW =
  "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.";

// --- NEAR municipality + havárie OA ---
{
  const facts = parseOfficialCommentFacts(NEAR_RAW);
  const parts = facts.accidentParticipants || [];
  const input = {
    impact: NEAR_RAW,
    impactFull: NEAR_RAW,
    eventType: "nehoda",
    road: "II/263",
    municipality: "Horní Police",
    district: "Česká Lípa",
  };
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const lead = formatAccidentSituationLead(expandTrafficAbbreviationsCs(NEAR_RAW), facts);
  const place = String(card.placeLine || "");

  ok("OA_SOURCE_PRESENT", /havárie\s+OA\b/i.test(NEAR_RAW));
  ok("OA_EXTRACTED", parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR), JSON.stringify(parts));
  ok("OA_STRUCTURED", parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR));
  ok(
    "OA_USED_IN_COLLAPSED",
    /osobního\s+automobilu/i.test(sit) && /nehoda/i.test(sit),
    sit
  );
  ok("OA_ACCIDENT_GUARD", /Nehoda\s+osobního\s+automobilu/i.test(sit), sit);
  ok(
    "ACCIDENT_VEHICLE_SEMANTIC_MERGE_GUARD",
    /Nehoda\s+osobního\s+automobilu/i.test(sit) &&
      !/^Nehoda\.\s/i.test(sit) &&
      !/Nehoda\.\s*Havárie/i.test(sit) &&
      !/\bHavárie\b/i.test(sit),
    sit
  );
  ok("ACCIDENT_PRESENT", /nehoda/i.test(sit), sit);
  ok(
    "INVESTIGATION_USED_IN_COLLAPSED",
    /probíhá\s+vyšetřování\s+nehody/i.test(sit),
    sit
  );
  ok("LEAD_OA", /osobního\s+automobilu/i.test(lead || ""), lead);

  ok("MUNICIPALITY_RELATION_SOURCE_U_OBCE", /u\s+obce/i.test(NEAR_RAW));
  ok("MUNICIPALITY_RELATION_STRUCTURED", facts.municipalityRelation === "u_obce", facts.municipalityRelation);
  ok(
    "MUNICIPALITY_RELATION_PRESERVATION_GUARD",
    facts.municipalityRelation === "u_obce" &&
      hdr.nearMunicipalityPrefix === "u obce" &&
      /u\s+obce/i.test(place) &&
      !/\bv\s+obci\b/i.test(place),
    JSON.stringify({
      rel: facts.municipalityRelation,
      prefix: hdr.nearMunicipalityPrefix,
      place,
    })
  );
  ok("RELATION_CHANGED_TO_V_OBCI_NO", !/\bv\s+obci\b/i.test(place) && facts.municipalityRelation !== "v_obce");
  ok(
    "MUNICIPALITY_SIGN",
    /HORNÍ\s+POLICE/i.test(String(hdr.municipalitySignLabel || "")),
    hdr.municipalitySignLabel
  );
  ok(
    "ROAD_BADGE",
    /II\/263/i.test(place) || /II\/263/i.test(String((card.communication && card.communication.road) || "")),
    place
  );
  ok("LOCATION_U_OBCE", /II\/263\s*·\s*u\s+obce\s+Horní\s+Police/i.test(place), place);
  ok("DISTRICT_IN_LOCATION", /Česká\s+Lípa/i.test(place), place);
}

// --- Generic near + OA (no place hardcode pass) ---
{
  const facts = parseOfficialCommentFacts(NEAR_GENERIC_RAW);
  const input = {
    impact: NEAR_GENERIC_RAW,
    impactFull: NEAR_GENERIC_RAW,
    eventType: "nehoda",
    road: "II/101",
    municipality: "Sampleville",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  const hdr = buildLocalityHeaderModel(input);
  ok("GENERIC_RELATION_U_OBCE", facts.municipalityRelation === "u_obce", facts.municipalityRelation);
  ok("GENERIC_PREFIX_U_OBCE", hdr.nearMunicipalityPrefix === "u obce", hdr.nearMunicipalityPrefix);
  ok("GENERIC_OA_SUMMARY", /Nehoda\s+osobního\s+automobilu/i.test(sit), sit);
}

// --- IN municipality counterpart must NOT get u obce ---
{
  const facts = parseOfficialCommentFacts(IN_RAW);
  const input = {
    impact: IN_RAW,
    impactFull: IN_RAW,
    eventType: "nehoda",
    road: "II/263",
    municipality: "Horní Police",
    district: "Česká Lípa",
  };
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const place = String(card.placeLine || "");
  ok("IN_RELATION_STRUCTURED", facts.municipalityRelation === "v_obce", facts.municipalityRelation);
  ok("IN_NO_NEAR_PREFIX", hdr.nearMunicipalityPrefix == null, hdr.nearMunicipalityPrefix);
  ok("IN_LOCATION_NOT_U_OBCE", !/u\s+obce/i.test(place), place);
  ok(
    "IN_VS_NEAR_DISTINCT",
    facts.municipalityRelation !== "u_obce",
    facts.municipalityRelation
  );
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok("IN_OA_STILL_PRESENT", /osobního\s+automobilu/i.test(sit), sit);
}

// --- OA × cyclist must keep BOTH participants ---
{
  const facts = parseOfficialCommentFacts(CYCLIST_RAW);
  const parts = facts.accidentParticipants || [];
  const sit = String(
    buildTrafficSituationSummary({
      impact: CYCLIST_RAW,
      impactFull: CYCLIST_RAW,
      eventType: "nehoda",
      municipality: "Liberec",
    }) || ""
  );
  ok(
    "OA_CYCLIST_REGRESSION_PASS",
    parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR) &&
      parts.includes(ACCIDENT_PARTICIPANT.CYCLIST) &&
      /osobní/i.test(sit) &&
      /cyklist/i.test(sit) &&
      !/^Nehoda\s+osobního\s+automobilu\.\s*$/i.test(sit.trim()),
    JSON.stringify({ parts, sit })
  );
}

// --- Direct parser: havárie OA alone + nehoda ---
{
  const parts = parseAccidentParticipantsFromText(
    "nehoda; havárie OA; probíhá vyšetřování nehody"
  );
  ok(
    "PARSER_HAVARIE_OA",
    parts.length === 1 && parts[0] === ACCIDENT_PARTICIPANT.PASSENGER_CAR,
    JSON.stringify(parts)
  );
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-municipality-relation-oa-accident-guard",
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
