#!/usr/bin/env node
/**
 * Primary street vs cross-street precedence + struck-animal specificity guard.
 * Fixture: "v ulici A … v blízkosti křižovatky s ul. B" + "sražená srna".
 * Pure local, no network, no municipality/street hardcode pass path.
 */
import {
  parseOfficialCommentFacts,
  extractCrossStreetFromOfficialComment,
  extractPrimaryStreetPhraseFromOfficialComment,
  extractStreetNamesFromOfficialComment,
  parseStruckAnimalObstacleFromText,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
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

const REF_RAW =
  "Od 15.8.2026 00:30 do 02:35; v ulici Ústecká v obci Velké Březno okres Ústí nad Labem, délka 121m; v blízkosti křižovatky s ul. Pivovarská; zvěř na vozovce; překážka na vozovce, průjezd se zvýšenou opatrností; sražená srna na komunikaci.";

// --- PRIMARY_STREET_CROSS_STREET_PRECEDENCE_GUARD ---
{
  const primary = extractPrimaryStreetPhraseFromOfficialComment(REF_RAW);
  const cross = extractCrossStreetFromOfficialComment(REF_RAW);
  const streets = extractStreetNamesFromOfficialComment(REF_RAW);
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("PRIMARY_STREET_EXTRACTED", primary === "Ústecká", String(primary));
  ok("CROSS_STREET_EXTRACTED", cross === "Pivovarská", String(cross));
  ok(
    "PRIMARY_STREET_CROSS_STREET_PRECEDENCE_GUARD",
    facts.street === "Ústecká" && facts.crossStreet === "Pivovarská",
    JSON.stringify({ street: facts.street, cross: facts.crossStreet, streets: facts.streets })
  );
  ok(
    "NEGATIVE_STREET_GUARD",
    facts.street !== "Pivovarská" && !(facts.streets || []).includes("Pivovarská"),
    JSON.stringify(facts.streets)
  );
  ok("STREETS_PRIMARY_ONLY", streets.length === 1 && streets[0] === "Ústecká", JSON.stringify(streets));
}

// --- Card / place / header ---
{
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "261",
    roadClass: "CLASS_II",
    municipality: "Velké Březno",
    district: "Ústí nad Labem",
  };
  const facts = parseOfficialCommentFacts(REF_RAW);
  const ev = classifyEventPresentation(input);
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const rows = rowMap(card);

  ok("MUNICIPALITY_SIGN_AFTER", hdr.municipalitySignLabel === "VELKÉ BŘEZNO", hdr.municipalitySignLabel);
  ok("ROAD_BADGE_AFTER", /II\/261/i.test(card.placeLine || ""), card.placeLine);
  ok("BESIDE_USTECKA", /Ústecká/i.test(String(hdr.besideLocality || "")), hdr.besideLocality);
  ok("BESIDE_NOT_PIVOVARSKA", !/Pivovarská/i.test(String(hdr.besideLocality || "")), hdr.besideLocality);
  ok(
    "PLACE_USTECKA",
    /II\/261\s*·\s*ulice\s+Ústecká\s*·\s*Velké\s+Březno\s*·\s*okres\s+Ústí\s+nad\s+Labem/i.test(
      card.placeLine || ""
    ),
    card.placeLine
  );
  ok("PLACE_NOT_PIVOVARSKA_PRIMARY", !/ulice\s+Pivovarská/i.test(card.placeLine || ""), card.placeLine);
  ok("EVENT_OBSTACLE", ev.kind === "obstacle", ev.kind);
  ok("TITLE_PREKAZKA", /PŘEKÁŽKA/i.test(ev.titleCs || ""), ev.titleCs);
  ok("NO_INVENTED_NEHODA", !/^Nehoda/i.test(sit) && !/NEHODA/i.test(ev.titleCs || ""), sit);
  ok(
    "ANIMAL_SPECIFICITY_GUARD",
    /Sražená\s+srna\s+na\s+vozovce/i.test(sit),
    sit
  );
  ok("GENERIC_ZVER_NOT_LEAD", !/^Zvěř\s+na\s+vozovce/i.test(sit.trim()), sit);
  ok("CAUTION_PASSAGE_VISIBLE", /Průjezd\s+se\s+zvýšenou\s+opatrností/i.test(sit), sit);
  ok("RAW_PRESERVED", /Ústecká/i.test(rows.sourceDescription || "") && /Pivovarská/i.test(rows.sourceDescription || ""), rows.sourceDescription);
  ok("RAW_HAS_SRNA", /sražená\s+srna/i.test(rows.sourceDescription || ""), rows.sourceDescription);
  ok("FACTS_ANIMAL_ROE", facts.animalType === COLLISION_ANIMAL.ROE_DEER, String(facts.animalType));
  ok("FACTS_ANIMAL_STRUCK", facts.animalState === "struck", String(facts.animalState));
  ok("LENGTH_SOURCE_PRESENT", /délka\s+121\s*m/i.test(REF_RAW));
  ok("LENGTH_NOT_FORCED_IN_SIT", !/121/i.test(sit), sit);
}

// --- MULTIPLE_STREET_GUARD (generic A/B names with street morphology) ---
{
  const raw =
    "v ulici Testovacíská v obci Sampleville; poblíž křižovatky s ulicí Vedlejšíská; zvěř na vozovce.";
  const primary = extractPrimaryStreetPhraseFromOfficialComment(raw);
  const cross = extractCrossStreetFromOfficialComment(raw);
  const facts = parseOfficialCommentFacts(raw);
  ok("MULTIPLE_STREET_GUARD_PRIMARY", primary === "Testovacíská", String(primary));
  ok("MULTIPLE_STREET_GUARD_CROSS", cross === "Vedlejšíská", String(cross));
  ok(
    "MULTIPLE_STREET_GUARD",
    facts.street === "Testovacíská" && facts.crossStreet === "Vedlejšíská",
    JSON.stringify({ street: facts.street, cross: facts.crossStreet })
  );
}

// --- STANDARD_STREET_REGRESSION_GUARD (Ještědská / Liberec) ---
{
  const raw =
    "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; OA x cyklista.";
  const facts = parseOfficialCommentFacts(raw);
  const card = buildTrafficCardPresentation({
    impact: raw,
    impactFull: raw,
    eventType: "nehoda",
    road: null,
    municipality: "Liberec",
  });
  ok("STANDARD_STREET_REGRESSION_GUARD", facts.street === "Ještědská", facts.street);
  ok("STANDARD_MUNI", facts.city === "Liberec", facts.city);
  ok("STANDARD_PLACE", /Ještědská/i.test(card.placeLine || ""), card.placeLine);
}

// --- GENERIC_ANIMAL_FALLBACK_GUARD ---
{
  const raw = "zvěř na vozovce; překážka na vozovce, průjezd se zvýšenou opatrností.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
    }) || ""
  );
  ok("GENERIC_ANIMAL_FALLBACK_GUARD", /Zvěř\s+na\s+vozovce/i.test(sit), sit);
  ok("GENERIC_NO_FALSE_SRNA", !/srna/i.test(sit), sit);
}

// --- Struck animal structured parse ---
{
  const struck = parseStruckAnimalObstacleFromText(
    "zvěř na vozovce; sražená srna na komunikaci."
  );
  ok("STRUCK_ANIMAL_TYPE", struck.animal === COLLISION_ANIMAL.ROE_DEER, JSON.stringify(struck));
  ok("STRUCK_ANIMAL_STATE", struck.state === "struck", String(struck.state));
  ok("STRUCK_ANIMAL_LOCATION", struck.location === "roadway", String(struck.location));
}

// --- D10_WILDBOAR_REGRESSION_GUARD ---
{
  const raw =
    "D10, mezi km 24.8 a 24, ve směru Praha; nehoda nákladního vozidla; zvěř na vozovce; překážka na vozovce, průjezd se zvýšenou opatrností; DOD x divočák.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "nehoda",
      road: "D10",
      roadClass: "MOTORWAY",
      direction: "Praha",
      kmFrom: 24.8,
      kmTo: 24,
    }) || ""
  );
  ok("D10_WILDBOAR_REGRESSION_GUARD", /dodávky\s+s\s+divočákem/i.test(sit), sit);
  ok("D10_NOT_GENERIC_ONLY", !/^Nehoda\s+vozidla\s+se\s+zvěří/i.test(sit), sit);
}

// --- NO_INVENTED_COLLISION_GUARD ---
{
  const raw =
    "v ulici Sampleovská; zvěř na vozovce; sražená srna na komunikaci; průjezd se zvýšenou opatrností.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prekazka",
    }) || ""
  );
  const ev = classifyEventPresentation({
    impact: raw,
    impactFull: raw,
    eventType: "prekazka",
  });
  ok("NO_INVENTED_COLLISION_GUARD", !/Nehoda\s+.*srn/i.test(sit), sit);
  ok("NO_INVENTED_VEHICLE", !/vozidla\s+s\s+srnou|automobilu\s+s\s+srnou/i.test(sit), sit);
  ok("STILL_OBSTACLE_KIND", ev.kind === "obstacle", ev.kind);
}

// --- Alternate cross-street wording ---
{
  const cases = [
    {
      raw: "v ulici Alphaovská v obci X; u křižovatky s ulicí Betaovská; zvěř na vozovce.",
      primary: "Alphaovská",
      cross: "Betaovská",
    },
    {
      raw: "v ulici Alphaovská v obci X; křižovatka s ul. Betaovská; zvěř na vozovce.",
      primary: "Alphaovská",
      cross: "Betaovská",
    },
    {
      raw: "na ulici Alphaovská v obci X; poblíž křižovatky s Betaovská; zvěř na vozovce.",
      primary: "Alphaovská",
      cross: "Betaovská",
    },
  ];
  for (let i = 0; i < cases.length; i++) {
    const f = parseOfficialCommentFacts(cases[i].raw);
    ok(
      "ALT_CROSS_" + i,
      f.street === cases[i].primary && f.crossStreet === cases[i].cross,
      JSON.stringify({ street: f.street, cross: f.crossStreet })
    );
  }
}

const passN = results.filter((r) => r.pass).length;
const failN = fails.length;
const out = {
  guard: "iu-traffic-primary-street-cross-street-struck-roe-guard",
  pass: failN === 0,
  passCount: passN,
  failCount: failN,
  fails,
  PRIMARY_STREET_CROSS_STREET_PRECEDENCE_GUARD_PASS: results.some(
    (r) => r.id === "PRIMARY_STREET_CROSS_STREET_PRECEDENCE_GUARD" && r.pass
  ),
  STANDARD_STREET_REGRESSION_GUARD_PASS: results.some(
    (r) => r.id === "STANDARD_STREET_REGRESSION_GUARD" && r.pass
  ),
  MULTIPLE_STREET_GUARD_PASS: results.some((r) => r.id === "MULTIPLE_STREET_GUARD" && r.pass),
  ANIMAL_SPECIFICITY_GUARD_PASS: results.some(
    (r) => r.id === "ANIMAL_SPECIFICITY_GUARD" && r.pass
  ),
  GENERIC_ANIMAL_FALLBACK_GUARD_PASS: results.some(
    (r) => r.id === "GENERIC_ANIMAL_FALLBACK_GUARD" && r.pass
  ),
  D10_WILDBOAR_REGRESSION_GUARD_PASS: results.some(
    (r) => r.id === "D10_WILDBOAR_REGRESSION_GUARD" && r.pass
  ),
  NO_INVENTED_COLLISION_GUARD_PASS: results.some(
    (r) => r.id === "NO_INVENTED_COLLISION_GUARD" && r.pass
  ),
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_PRIMARY_STREET_CROSS_STREET_STRUCK_ROE_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_PRIMARY_STREET_CROSS_STREET_STRUCK_ROE_GUARD_PASS");
