#!/usr/bin/env node
/**
 * Primary event location vs detour route + between-intersections segment +
 * abbreviated street names + raw location fragment leak guard.
 *
 * Pattern: primary street A + segment "mezi křižovatkami…" + detour via B / road C
 * must not promote detour tokens to primary, must not cast segment as cityDistrict,
 * and collapsed DOPRAVNÍ SITUACE must not leak raw location fragments.
 *
 * Pure local, no network. No municipality/street hardcode pass path.
 */
import {
  parseOfficialCommentFacts,
  extractStreetNamesFromOfficialComment,
  extractAllRoadNumbersFromOfficialComment,
  extractBetweenIntersectionsSegment,
  extractDetourRouteFactsFromOfficialComment,
  splitPrimaryVsDetourComment,
  looksLikeBetweenIntersectionsPhrase,
  looksLikeStreetName,
  resolvePresentationRoadNumbers,
  resolvePresentationRoadNumber,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
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

/** Sanitized fixture (no production event ID). Generic street letters for role guards. */
const GENERIC_PRIMARY_DETOUR = `ulice Alfova,
mezi křižovatkami ulic Betská a Gamská,
Sampleville,
okr. Sampleville,
Od 17.08.2026 00:00
Do 28.08.2026 23:59,
Objížďka - bez rozlišení:
ulice Alfova - ulice Deltova,
Sampleville,
okr. Sampleville,
přes:
ulice Epsilonská,
silnice II/118 (ulice Zetská)`;

/** Abbreviated primary street + real-shape municipality (not hardcoded in parser). */
const ABBREV_PRIMARY_DETOUR = `ulice Ant. Škváry,
mezi křižovatkami ulic Škroupova a Na vyhaslém,
Kladno,
okr. Kladno,
Od 17.08.2026 00:00
Do 28.08.2026 23:59,
Objížďka - bez rozlišení:
ulice Ant. Škváry - ulice V. Kratochvíla,
Kladno,
okr. Kladno,
přes:
ulice Tylova,
silnice II/118 (ulice Slánská)`;

const BETWEEN_ONLY = `ulice Alfova,
mezi křižovatkami ulic Betská a Gamská,
Sampleville,
okr. Sampleville`;

const ABBREV_NAMES = [
  "Ant. Škváry",
  "Dr. E. Beneše",
  "gen. Píky",
  "nám. T. G. Masaryka",
];

// --- ABBREVIATED_STREET_NAME_GUARD ---
{
  for (const name of ABBREV_NAMES) {
    ok(
      "ABBREVIATED_STREET_NAME_LOOKS_LIKE_" + name.replace(/\s+/g, "_"),
      looksLikeStreetName(name) === true,
      name
    );
  }
  const facts = parseOfficialCommentFacts("ulice Ant. Škváry, Sampleville");
  ok(
    "ABBREVIATED_STREET_NAME_GUARD",
    facts.street === "Ant. Škváry",
    String(facts.street)
  );
  ok(
    "ABBREVIATED_STREET_NOT_SPLIT_ANT",
    facts.street !== "Ant." && facts.street !== "Ant"
  );
  ok(
    "ABBREVIATED_STREET_NOT_SPLIT_SURNAME",
    facts.street !== "Škváry" && !(facts.streets || []).includes("Škváry")
  );
}

// --- BETWEEN_INTERSECTIONS_GUARD + FALSE_CITY_DISTRICT_GUARD ---
{
  ok(
    "BETWEEN_PHRASE_DETECT",
    looksLikeBetweenIntersectionsPhrase("mezi křižovatkami ulic Betská a Gamská") === true
  );
  const seg = extractBetweenIntersectionsSegment(BETWEEN_ONLY);
  ok(
    "BETWEEN_INTERSECTIONS_GUARD",
    !!seg &&
      seg.fromCrossStreet === "Betská" &&
      seg.toCrossStreet === "Gamská" &&
      /mezi křižovatkami ulic Betská a Gamská/i.test(seg.presentation || ""),
    JSON.stringify(seg)
  );
  const facts = parseOfficialCommentFacts(BETWEEN_ONLY);
  ok("BETWEEN_PRIMARY_STREET", facts.street === "Alfova", String(facts.street));
  ok(
    "FALSE_CITY_DISTRICT_GUARD",
    facts.cityPart == null ||
      !looksLikeBetweenIntersectionsPhrase(facts.cityPart),
    String(facts.cityPart)
  );
  ok(
    "CITY_DISTRICT_NULL_WHEN_ABSENT",
    facts.cityPart == null || facts.cityPart === "",
    String(facts.cityPart)
  );
}

// --- PRIMARY_VS_DETOUR_STREET_GUARD + PRIMARY_VS_DETOUR_ROAD_GUARD ---
{
  const split = splitPrimaryVsDetourComment(GENERIC_PRIMARY_DETOUR);
  ok("DETOUR_SPLIT_HAS_PRIMARY", /ulice Alfova/i.test(split.primaryText || ""));
  ok("DETOUR_SPLIT_HAS_DETOUR", /Objížďk/i.test(split.detourText || ""));
  const facts = parseOfficialCommentFacts(GENERIC_PRIMARY_DETOUR);
  const detour = extractDetourRouteFactsFromOfficialComment(GENERIC_PRIMARY_DETOUR);
  ok(
    "PRIMARY_VS_DETOUR_STREET_GUARD",
    facts.street === "Alfova" &&
      !(facts.streets || []).includes("Epsilonská") &&
      !(facts.streets || []).includes("Zetská"),
    JSON.stringify({ street: facts.street, streets: facts.streets })
  );
  ok(
    "DETOUR_WAYPOINT_STREET",
    !!(detour && (detour.waypoints || []).includes("Epsilonská")),
    JSON.stringify(detour && detour.waypoints)
  );
  ok(
    "PRIMARY_VS_DETOUR_ROAD_GUARD",
    !(facts.roadNumbers || []).includes("II/118") &&
      facts.roadNumber == null &&
      !!(detour && (detour.roads || []).includes("II/118")),
    JSON.stringify({
      primaryRoads: facts.roadNumbers,
      detourRoads: detour && detour.roads,
    })
  );
  ok(
    "DETOUR_ROUTE_NOT_AFFECTED_ROADS_GUARD",
    (facts.roadNumbers || []).length === 0 &&
      resolvePresentationRoadNumbers(
        { impact: GENERIC_PRIMARY_DETOUR, impactFull: GENERIC_PRIMARY_DETOUR },
        facts
      ).length === 0,
    JSON.stringify(facts.roadNumbers)
  );
}

// --- Master sanitized fixture (abbrev + Kladno-shape) ---
{
  const input = {
    impact: ABBREV_PRIMARY_DETOUR,
    impactFull: ABBREV_PRIMARY_DETOUR,
    eventType: "omezeni",
    lifecycleStatus: "FUTURE",
    municipality: "Kladno",
    district: "Kladno",
  };
  const facts = parseOfficialCommentFacts(ABBREV_PRIMARY_DETOUR);
  const detour = extractDetourRouteFactsFromOfficialComment(ABBREV_PRIMARY_DETOUR);
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const place = String(buildPlaceAndDirectionLine(input) || "");
  const sit = String(buildTrafficSituationSummary(input) || "");
  const roads = resolvePresentationRoadNumbers(input, facts);
  const oneRoad = resolvePresentationRoadNumber(input, facts);
  const rows = rowMap(card);
  const sourceDesc = String(rows.sourceDescription || "");

  ok("MASTER_PRIMARY_STREET", facts.street === "Ant. Škváry", String(facts.street));
  ok(
    "ABBREVIATED_STREET_NAME_PRESERVED",
    facts.street === "Ant. Škváry" &&
      !/\bAnt\.\s*$/.test(facts.street) &&
      facts.street !== "Škváry"
  );
  ok(
    "MASTER_SEGMENT",
    facts.segmentBetweenIntersections &&
      /mezi křižovatkami ulic Škroupova a Na vyhaslém/i.test(
        facts.segmentBetweenIntersections.presentation || ""
      ),
    JSON.stringify(facts.segmentBetweenIntersections)
  );
  ok(
    "FALSE_CITY_DISTRICT_AFTER",
    facts.cityPart == null ||
      !looksLikeBetweenIntersectionsPhrase(facts.cityPart),
    String(facts.cityPart)
  );
  ok("MASTER_MUNICIPALITY_SIGN", hdr.municipalitySignLabel === "KLADNO", hdr.municipalitySignLabel);
  ok(
    "MASTER_HEADER_BESIDE",
    /Ant\.\s*Škváry/i.test(String(hdr.besideLocality || "")) &&
      !/Slánská/i.test(String(hdr.besideLocality || "")) &&
      !/II\/118/i.test(String(hdr.besideLocality || "")),
    String(hdr.besideLocality)
  );
  ok("MASTER_CITY_PART_ROW_EMPTY", hdr.cityPartRow == null || hdr.cityPartRow === "", String(hdr.cityPartRow));
  ok(
    "II_118_PRIMARY_AFTER_NO",
    !roads.includes("II/118") && oneRoad !== "II/118" && !(facts.roadNumbers || []).includes("II/118")
  );
  ok(
    "II_118_DETOUR_SOURCE_PRESENT",
    !!(detour && (detour.roads || []).includes("II/118"))
  );
  ok(
    "PRIMARY_NOT_SLANSKA",
    facts.street !== "Slánská" && !(facts.streets || []).includes("Slánská")
  );
  ok(
    "PLACE_AFTER",
    /Ant\.\s*Škváry/i.test(place) &&
      /mezi křižovatkami ulic Škroupova a Na vyhaslém/i.test(place) &&
      /Kladno/i.test(place) &&
      !/II\/118/i.test(place) &&
      !/Slánská/i.test(place),
    place
  );
  ok(
    "RAW_LOCATION_FRAGMENT_LEAK_GUARD",
    !/^Škváry,/i.test(sit) &&
      !/\bokr\./i.test(sit) &&
      !/\bOd\s+\d/i.test(sit) &&
      !/\bDo\s+\d/i.test(sit) &&
      !/^ulice\b/i.test(sit) &&
      !/Kladno,\s*okr/i.test(sit) &&
      !/mezi křižovatkami/i.test(sit),
    sit
  );
  ok(
    "DETOUR_SUMMARY_GUARD",
    /Objížďka/i.test(sit) &&
      /Tylova/i.test(sit) &&
      (/II\/118/i.test(sit) || /Slánská/i.test(sit)) &&
      sit !== "Dopravní omezení.",
    sit
  );
  ok(
    "FUTURE_TENSE_PRESERVED",
    /povede/i.test(sit) && !/\bvede\b/i.test(sit),
    sit
  );
  ok("DETOUR_SOURCE_PRESENT", !!(detour && detour.detourSourcePresent));
  ok(
    "DETOUR_ORIGIN",
    !!(detour && /Ant\.\s*Škváry/i.test(detour.origin || "")),
    String(detour && detour.origin)
  );
  ok(
    "DETOUR_DESTINATION",
    !!(detour && /Kratochvíla/i.test(detour.destination || "")),
    String(detour && detour.destination)
  );
  ok(
    "DETOUR_WAYPOINTS",
    !!(detour && (detour.waypoints || []).includes("Tylova")),
    JSON.stringify(detour && detour.waypoints)
  );
  ok(
    "SOURCE_DETAIL_PRESERVED",
    /Ant\.\s*Škváry/i.test(sourceDesc) &&
      /Škroupova/i.test(sourceDesc) &&
      /Na vyhaslém/i.test(sourceDesc) &&
      /Objížďk/i.test(sourceDesc) &&
      /Kratochvíla/i.test(sourceDesc) &&
      /Tylova/i.test(sourceDesc) &&
      /II\/118/i.test(sourceDesc) &&
      /Slánská/i.test(sourceDesc),
    sourceDesc.slice(0, 120)
  );
}

// --- Diversion role: detour street must not become primary (letter fixture) ---
{
  const primaryOnly =
    "ulice Alfova, Sampleville. Objížďka - bez rozlišení: přes: ulice Betská";
  const facts = parseOfficialCommentFacts(primaryOnly);
  const streets = extractStreetNamesFromOfficialComment(
    splitPrimaryVsDetourComment(primaryOnly).primaryText
  );
  ok(
    "PRIMARY_VS_DETOUR_STREET_SIMPLE",
    facts.street === "Alfova" && streets.includes("Alfova") && !streets.includes("Betská"),
    JSON.stringify({ street: facts.street, streets })
  );
}

// --- Detour-only road must not enter primary road extract ---
{
  const raw =
    "ulice Alfova, Sampleville. Objížďka: přes: silnice II/118";
  const facts = parseOfficialCommentFacts(raw);
  const primaryRoads = extractAllRoadNumbersFromOfficialComment(
    splitPrimaryVsDetourComment(raw).primaryText
  );
  const detour = extractDetourRouteFactsFromOfficialComment(raw);
  ok(
    "PRIMARY_VS_DETOUR_ROAD_SIMPLE",
    primaryRoads.length === 0 &&
      !(facts.roadNumbers || []).includes("II/118") &&
      !!(detour && (detour.roads || []).includes("II/118")),
    JSON.stringify({ primaryRoads, factsRoads: facts.roadNumbers, detour })
  );
}

ok("MASTER_DATASET_PASS", fails.length === 0);

const out = {
  guard: "iu-traffic-primary-vs-detour-location-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
  PRIMARY_VS_DETOUR_STREET_GUARD: results.some(
    (r) => r.id === "PRIMARY_VS_DETOUR_STREET_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  PRIMARY_VS_DETOUR_ROAD_GUARD: results.some(
    (r) => r.id === "PRIMARY_VS_DETOUR_ROAD_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  BETWEEN_INTERSECTIONS_GUARD: results.some(
    (r) => r.id === "BETWEEN_INTERSECTIONS_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  FALSE_CITY_DISTRICT_GUARD: results.some(
    (r) => r.id === "FALSE_CITY_DISTRICT_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  ABBREVIATED_STREET_NAME_GUARD: results.some(
    (r) => r.id === "ABBREVIATED_STREET_NAME_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  RAW_LOCATION_FRAGMENT_LEAK_GUARD: results.some(
    (r) => r.id === "RAW_LOCATION_FRAGMENT_LEAK_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
  DETOUR_SUMMARY_GUARD: results.some((r) => r.id === "DETOUR_SUMMARY_GUARD" && r.pass)
    ? "PASS"
    : "FAIL",
  DETOUR_ROUTE_NOT_AFFECTED_ROADS_GUARD: results.some(
    (r) => r.id === "DETOUR_ROUTE_NOT_AFFECTED_ROADS_GUARD" && r.pass
  )
    ? "PASS"
    : "FAIL",
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_PRIMARY_VS_DETOUR_LOCATION_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_PRIMARY_VS_DETOUR_LOCATION_GUARD_PASS");
