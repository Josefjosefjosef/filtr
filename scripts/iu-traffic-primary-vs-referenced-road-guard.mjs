#!/usr/bin/env node
/**
 * Primary event road vs referenced / diversion road guard.
 * Also covers motorway+km recovery (D5 visibility) and street landmark controls.
 * Pure local, no network.
 */
import {
  extractPrimaryAffectedRoadNumbersFromOfficialComment,
  extractReferencedRoadNumbersFromOfficialComment,
  extractMotorwayNumbersFromOfficialComment,
  extractAllRoadNumbersFromOfficialComment,
  resolvePresentationRoadNumbers,
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildPlaceAndDirectionLine,
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

const PARD_RAW =
  "silnice III/32221, Pardubice VI, Pardubice, , Od 26.09.2026 00:00, Do 26.09.2026 23:59, částečná uzavírka pravého jízdního pruhu na silnici č. III/32221 ze směru od křižovatky se sil. č. I/2 po obec Srnojedy III/2985 úsek z obce Ráby - směr Kunětická Hora III/2984 úsek křížení s cyklostezkou, Vydal: Magistrát města Pardubic";

const PARD_INPUT = {
  impact: PARD_RAW,
  impactFull: PARD_RAW,
  eventType: "omezeni",
  road: "III/32221",
  roadClass: "CLASS_III",
  roadClassLabel: "Silnice III. třídy",
  lifecycleStatus: "FUTURE",
};

const KOST_RAW =
  "silnice III/42819, silnice III/42826, v katastru obce Kostelany, okr. Kroměříž, Od 15.08.2026 00:00, Do 16.08.2026 23:59, uzavřeno; sportovní akce; 55. ročník Barum Czech Rally Zlín 2026, Vydal: ŘSD";

const KOST_INPUT = {
  impact: KOST_RAW,
  impactFull: KOST_RAW,
  eventType: "uzavirka",
  road: "III/42826",
  roadClass: "CLASS_III",
  municipality: "Kostelany",
  district: "Kroměříž",
  lifecycleStatus: "ACTIVE",
};

const KD_RAW =
  "silnice III/11547 (ulice Pivovarská), Králův Dvůr, část obce Popovice, okr. Beroun, , Od 16.09.2026 07:00, Do 23.09.2026 19:00, Uzavírka silnice č. III/11542 (km 1,030 - 1,120) v k.ú. Králův Dvůr a III/11547 (km 1,420 - 1,540) v k.ú. Popovice u Králova Dvora z důvodu opravy železničních přejezdů P279 a P280, Objížďka - bez rozlišení: silnice III/2363a (ulice Bohumila Hájka), část obce Popovice - silnice III/11546, část obce Křižatky, Králův Dvůr, okr. Beroun, přes: silnice III/11524 (ulice Tovární)";

const VIS_RAW = "Viditelnost: snížená viditelnost na méně než 100 m, D5 km 145,8.";
const VIS_INPUT = {
  impact: VIS_RAW,
  impactFull: VIS_RAW,
  eventType: "omezeni",
  lifecycleStatus: "ACTIVE",
  km: 145.8,
};

const KAM_RAW =
  "ulice Kamenitá, mezi křižovatkami ulic Na Vršku a Dvorská, Plzeň 6-Litice, okr. Plzeň-město, uzavřeno, stavební práce";

const DUCH_RAW =
  "ulice U Koupaliště, Duchcov, část obce K Háji, okr. Teplice, uzavřeno, stavební práce";

const SINGLE_RAW =
  "silnice I/20, Plzeň, okr. Plzeň-město, stavební práce, Od 01.09.2026 07:00 Do 30.09.2026 18:00, rekonstrukce povrchu";

// A) Primary + referenced (Pardubice III/32221 vs I/2)
{
  const referenced = extractReferencedRoadNumbersFromOfficialComment(PARD_RAW);
  const primary = extractPrimaryAffectedRoadNumbersFromOfficialComment(PARD_RAW);
  const roads = resolvePresentationRoadNumbers(PARD_INPUT);
  const card = buildTrafficCardPresentation(PARD_INPUT);
  const rows = rowMap(card);
  ok("REF_I2_DETECTED", referenced.includes("I/2"), JSON.stringify(referenced));
  ok("PRIMARY_ONLY_32221", primary.length === 1 && primary[0] === "III/32221", JSON.stringify(primary));
  ok("NO_I2_IN_PRIMARY", !primary.includes("I/2") && !roads.includes("I/2"), JSON.stringify(roads));
  ok("NO_2985_2984_EVENT_ROADS", !primary.some((r) => /2985|2984/.test(r)), JSON.stringify(primary));
  ok("RESOLVE_SINGLE", roads.length === 1 && roads[0] === "III/32221", JSON.stringify(roads));
  ok("PLACE_NO_I2", /III\/32221/.test(card.placeLine || "") && !/I\/2/.test(card.placeLine || ""), card.placeLine);
  ok("DETAIL_KOMUNIKACE_32221", rows.road === "III/32221", rows.road);
  ok("SOURCE_STILL_MENTIONS_I2", /I\/2/.test(PARD_RAW));
}

// B) Legitimate multi-road must stay multi-road
{
  const roads = resolvePresentationRoadNumbers(KOST_INPUT);
  const card = buildTrafficCardPresentation(KOST_INPUT);
  ok("LEGIT_MULTI_COUNT", roads.length === 2, JSON.stringify(roads));
  ok("LEGIT_MULTI_42819", roads.includes("III/42819"));
  ok("LEGIT_MULTI_42826", roads.includes("III/42826"));
  ok(
    "LEGIT_MULTI_PLACE",
    /III\/42819/.test(card.placeLine || "") && /III\/42826/.test(card.placeLine || ""),
    card.placeLine
  );
}

// C) Diversion roads must not contaminate primary
{
  const facts = parseOfficialCommentFacts(KD_RAW);
  ok("DIVERSION_PRIMARY_11547", (facts.roadNumbers || []).join(",") === "III/11547", JSON.stringify(facts.roadNumbers));
  ok(
    "DIVERSION_NO_2363_11546",
    !(facts.roadNumbers || []).some((r) => /2363|11546|11524/i.test(r)),
    JSON.stringify(facts.roadNumbers)
  );
}

// D) Missing structured road — D5 km mid-sentence (source-driven motorway+km)
{
  const mw = extractMotorwayNumbersFromOfficialComment(VIS_RAW);
  const roads = resolvePresentationRoadNumbers(VIS_INPUT);
  const card = buildTrafficCardPresentation(VIS_INPUT);
  const rows = rowMap(card);
  ok("D5_KM_EXTRACT", mw.includes("D5"), JSON.stringify(mw));
  ok("D5_RESOLVE", roads.length === 1 && roads[0] === "D5", JSON.stringify(roads));
  ok("D5_PLACE", /^D5\s*·\s*km\s*145[,.]8/.test(card.placeLine || ""), card.placeLine);
  ok("D5_KOMUNIKACE", rows.road === "D5", rows.road);
  ok("D5_NO_INVENT_WITHOUT_PATTERN", extractMotorwayNumbersFromOfficialComment("Viditelnost snížená.").length === 0);
}

// E) Referenced streets — Kamenitá primary; Na Vršku/Dvorská landmarks only
{
  const facts = parseOfficialCommentFacts(KAM_RAW);
  const card = buildTrafficCardPresentation({
    impact: KAM_RAW,
    impactFull: KAM_RAW,
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("KAM_PRIMARY_STREET", facts.primaryStreet === "Kamenitá" || facts.street === "Kamenitá", facts.primaryStreet);
  ok(
    "KAM_SEGMENT_LANDMARKS",
    facts.segmentBetweenIntersections &&
      facts.segmentBetweenIntersections.fromCrossStreet === "Na Vršku" &&
      facts.segmentBetweenIntersections.toCrossStreet === "Dvorská",
    JSON.stringify(facts.segmentBetweenIntersections)
  );
  ok("KAM_DETAIL_STREET_ONLY_KAMENITA", rows.street === "Kamenitá", rows.street);
  ok(
    "KAM_NO_CROSS_AS_PRIMARY_STREETS",
    rows.street !== "Na Vršku" && rows.street !== "Dvorská",
    rows.street
  );
}

// F) Normal single-road unchanged
{
  const input = {
    impact: SINGLE_RAW,
    impactFull: SINGLE_RAW,
    road: "I/20",
    roadClass: "CLASS_I",
    eventType: "prace",
    municipality: "Plzeň",
  };
  const roads = resolvePresentationRoadNumbers(input);
  ok("SINGLE_ROAD_ONLY", roads.length === 1 && roads[0] === "I/20", JSON.stringify(roads));
}

// Duchcov municipal control
{
  const card = buildTrafficCardPresentation({
    impact: DUCH_RAW,
    impactFull: DUCH_RAW,
    eventType: "prace",
    municipality: "Duchcov",
    district: "Teplice",
    cityPart: "K Háji",
    street: "U Koupaliště",
  });
  const rows = rowMap(card);
  const place = buildPlaceAndDirectionLine({
    impact: DUCH_RAW,
    impactFull: DUCH_RAW,
    municipality: "Duchcov",
    district: "Teplice",
    cityPart: "K Háji",
    street: "U Koupaliště",
  });
  ok("DUCH_STREET", rows.street === "U Koupaliště", rows.street);
  ok("DUCH_MUNI", rows.municipality === "Duchcov", rows.municipality);
  ok("DUCH_PART", rows.cityPart === "K Háji", rows.cityPart);
  ok("DUCH_DISTRICT", rows.district === "Teplice", rows.district);
  ok(
    "DUCH_PLACE",
    /U\s+Koupaliště/i.test(place || card.placeLine || "") && /Duchcov/i.test(place || card.placeLine || ""),
    place || card.placeLine
  );
}

// Header multi-road extraction still sees both (all-roads audit API)
{
  const all = extractAllRoadNumbersFromOfficialComment(KOST_RAW);
  ok("ALL_ROADS_STILL_SEES_MULTI", all.length === 2, JSON.stringify(all));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-primary-vs-referenced-road-guard",
      pass,
      failCount: fails.length,
      fails,
      results,
    },
    null,
    2
  )
);
if (!pass) {
  console.log("IU_TRAFFIC_PRIMARY_VS_REFERENCED_ROAD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_PRIMARY_VS_REFERENCED_ROAD_PASS");
