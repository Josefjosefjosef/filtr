#!/usr/bin/env node
/**
 * Roadworks: preserve lane restriction + alternating traffic + culvert repair,
 * and keep "část obce X" as municipality parts (never primary municipality).
 * Parenthetical street-like tokens e.g. "(Rožnovská)" become structured streets.
 * Fixture-based — no place/road hardcode pass path. Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficSituationSummary,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  extractMunicipalityPartsFromOfficialComment,
  extractParentheticalStreetNamesFromOfficialComment,
  hasExplicitLaneRestrictionSource,
  hasExplicitAlternatingTrafficSource,
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
  "silnice I/58, v katastru obce Frenštát pod Radhoštěm, okr. Nový Jičín, (Rožnovská) - část obce Buzkovice - (Rožnovská), část obce Kopaná, Od 19.08.2026 00:00, Do 30.11.2026 23:59, Omezení v jízdním pruhu. Střídavý jednosměrný provoz. Oprava propustků 58-060P a 58-061P. Vydal: Krajský úřad Moravskoslezského kraje";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  eventType: "prace",
  category: "prace",
  municipality: "Frenštát pod Radhoštěm",
  road: "I/58",
  district: "Nový Jičín",
  illustrationKey: "prace",
  lifecycleStatus: "FUTURE",
};

{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  const hdr = buildLocalityHeaderModel(REF_INPUT);
  const card = buildTrafficCardPresentation(REF_INPUT);
  const rows = Object.fromEntries(
    ((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value])
  );
  const roadPres =
    card.communication && card.communication.roadPresentation;

  ok("ROADWORK_PRESENT", /oprav|práce|propustk/i.test(sit), sit);
  ok("CULVERT_REPAIR_PRESENT", /propustk/i.test(sit), sit);
  ok(
    "LANE_RESTRICTION_PRESENT",
    hasExplicitLaneRestrictionSource(REF_RAW) &&
      facts.laneRestriction === true &&
      /omezení\s+v\s+jízdním\s+pruhu/i.test(sit),
    sit
  );
  ok(
    "ALTERNATING_TRAFFIC_PRESENT",
    hasExplicitAlternatingTrafficSource(REF_RAW) &&
      facts.alternatingTraffic === true &&
      /střídavý|kyvadlov/i.test(sit),
    sit
  );
  ok(
    "ROADWORK_FACT_COVERAGE",
    /propustk/i.test(sit) &&
      /omezení\s+v\s+jízdním\s+pruhu/i.test(sit) &&
      /střídavý|kyvadlov/i.test(sit),
    sit
  );

  ok("ROAD_I58", (facts.roadNumber || roadPres.road) === "I/58", facts.roadNumber);
  ok(
    "PRIMARY_MUNICIPALITY",
    facts.city === "Frenštát pod Radhoštěm" &&
      hdr.municipalitySign === "Frenštát pod Radhoštěm",
    facts.city + "/" + hdr.municipalitySign
  );
  ok("DISTRICT", /Nový\s+Jičín/i.test(facts.district || ""), facts.district);
  ok(
    "MUNICIPALITY_PARTS",
    extractMunicipalityPartsFromOfficialComment(REF_RAW).length === 2 &&
      facts.municipalityParts.includes("Buzkovice") &&
      facts.municipalityParts.includes("Kopaná"),
    JSON.stringify(facts.municipalityParts)
  );
  ok(
    "MUNICIPALITY_PART_PROMOTED_TO_PRIMARY_NO",
    hdr.municipalitySign !== "Buzkovice" &&
      hdr.municipalitySign !== "Kopaná" &&
      facts.city !== "Buzkovice" &&
      facts.city !== "Kopaná"
  );
  ok(
    "PARTS_EXPANDED",
    /Buzkovice/i.test(rows.municipalityParts || "") &&
      /Kopaná/i.test(rows.municipalityParts || ""),
    rows.municipalityParts
  );

  const paren = extractParentheticalStreetNamesFromOfficialComment(REF_RAW);
  ok("ROZNOVSKA_PAREN", paren.includes("Rožnovská"), JSON.stringify(paren));
  ok(
    "ROZNOVSKA_STRUCTURED_STREET",
    facts.street === "Rožnovská" ||
      (facts.streets || []).some((s) => s === "Rožnovská"),
    facts.street
  );
  ok(
    "ROZNOVSKA_NOT_MUNICIPALITY",
    hdr.municipalitySign !== "Rožnovská" && facts.city !== "Rožnovská"
  );
  ok(
    "CADASTRAL_RELATION",
    facts.municipalityRelation === "v_katastru_obce" &&
      hdr.nearMunicipalityPrefix == null,
    facts.municipalityRelation
  );

  ok(
    "MUNICIPALITY_SIGN_PASS",
    hdr.municipalitySign === "Frenštát pod Radhoštěm" &&
      hdr.municipalitySignLabel === "FRENŠTÁT POD RADHOŠTĚM"
  );
  ok(
    "ROAD_BADGE_PASS",
    roadPres.road === "I/58" &&
      roadPres.roadClass === "CLASS_I" &&
      roadPres.numberBadge === "road"
  );
  ok(
    "BUDOUCI_INPUT_PRESERVED",
    REF_INPUT.lifecycleStatus === "FUTURE"
  );
}

// Pattern: multi část obce without hardcoding names
{
  const raw =
    "silnice II/123, v katastru obce Alpha Beta, okr. Gamma, (Testovská) - část obce Delta - (Testovská), část obce Epsilon, Omezení v jízdním pruhu. Střídavý jednosměrný provoz. Oprava propustků 1-2P.";
  const facts = parseOfficialCommentFacts(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      municipality: "Alpha Beta",
      road: "II/123",
      illustrationKey: "prace",
    }) || ""
  );
  ok("PATTERN_PARTS", facts.municipalityParts.join(",") === "Delta,Epsilon", facts.municipalityParts.join(","));
  ok("PATTERN_CITY", facts.city === "Alpha Beta", facts.city);
  ok("PATTERN_STREET", facts.street === "Testovská", facts.street);
  ok("PATTERN_LANE", /omezení\s+v\s+jízdním\s+pruhu/i.test(sit), sit);
  ok("PATTERN_ALT", /střídavý|kyvadlov/i.test(sit), sit);
  ok("PATTERN_NOT_PROMOTED", facts.city !== "Delta" && facts.city !== "Epsilon");
}

// Live-shaped truncated comment still keeps Kopaná + lane restriction
{
  const liveRaw =
    "silnice I/58, v katastru obce Frenštát pod Radhoštěm, část obce Kopaná, okr. Nový Jičín, práce na údržbě mostu, kyvadlový provoz jedním jízdním pruhem, Od 19.08.2026 00:00 Do 30.11.2026 23:59, Omezení v jízdním pruhu. Střídavý jednosměrný provoz. Oprava propustků 58-060P a 58-061P., Vydal: Krajský úřad Moravskoslezského kraje";
  const facts = parseOfficialCommentFacts(liveRaw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: liveRaw,
      impactFull: liveRaw,
      eventType: "prace",
      municipality: "Frenštát pod Radhoštěm",
      road: "I/58",
      illustrationKey: "prace",
    }) || ""
  );
  ok("LIVE_SHAPE_PART_KOPANA", facts.municipalityParts.includes("Kopaná"), JSON.stringify(facts.municipalityParts));
  ok("LIVE_SHAPE_LANE", /omezení\s+v\s+jízdním\s+pruhu/i.test(sit), sit);
  ok("LIVE_SHAPE_ALT", /kyvadlov|střídavý/i.test(sit), sit);
  ok("LIVE_SHAPE_PRIMARY", facts.city === "Frenštát pod Radhoštěm", facts.city);
}

const passN = results.filter((r) => r.pass).length;
const out = {
  guard: "iu-traffic-roadwork-lane-restriction-municipality-parts-guard",
  total: results.length,
  pass: passN,
  fail: fails.length,
  fails,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_ROADWORK_LANE_RESTRICTION_MUNICIPALITY_PARTS_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_ROADWORK_LANE_RESTRICTION_MUNICIPALITY_PARTS_GUARD_PASS");
