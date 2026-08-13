#!/usr/bin/env node
/**
 * Urban numbered-road parse guard — municipality / road identity / street /
 * direction boundary / traffic summary / RAW preservation / negatives.
 * Pure fixtures, no network. No hardcoding of a single city/street/road as the only pass path.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  buildTrafficSituationSummary,
  normalizeDirectionHuman,
  sanitizeExtractedValueToken,
  preferClassedRoadNumber,
  resolvePresentationRoadNumber,
  splitMunicipalityAndCityPart,
  isNumericCityPartName,
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
  "silnice I/26 (ulice Rokycanská), Plzeň 4, odbočovací pruh uzavřen, Od 17.08.2026 07:00 Do 11.09.2026 23:59, částečná uzavírka silnice I/26, ul. Rokycanská v Plzni za účelem vyblokování odbočovacího pruhu pro směr vlevo před křižovatkou s ul. Vavřínová ve směru do centra v souvislosti s prováděním stavebních prací v rámci akce „Výstavba opěrné zdi, LIDL, Rokycanská ul., Plzeň“, Vydal: Krajský úřad Plzeňského kraje";

// --- Reference acceptance ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("ref_street", facts.street === "Rokycanská", facts.street);
  ok("ref_street_no_paren", !/[()]$/.test(facts.street || ""));
  ok("ref_direction", facts.directionHuman === "do centra", facts.directionHuman);
  ok("ref_city", facts.city === "Plzeň", facts.city);
  ok("ref_city_part", facts.cityPart === "Plzeň 4", facts.cityPart);
  ok("ref_road_from_comment", facts.roadNumber === "I/26", facts.roadNumber);

  const card = buildTrafficCardPresentation({
    impact: REF_RAW,
    impactFull: REF_RAW,
    road: "26",
    municipality: "Plzeň 4",
    eventType: "restriction",
    future: true,
  });
  const hdr = buildLocalityHeaderModel({
    impact: REF_RAW,
    impactFull: REF_RAW,
    road: "26",
    municipality: "Plzeň 4",
  });
  ok("MUNICIPALITY_SIGN_PASS", hdr.municipalitySignLabel === "PLZEŇ", hdr.municipalitySignLabel);
  ok("ROAD_IDENTITY_PASS", card.communication.roadPresentation.road === "I/26", card.communication.roadPresentation.road);
  ok("STREET_SANITIZATION_PASS", hdr.street === "Rokycanská" && !/\)/.test(hdr.besideLocality || ""), hdr.besideLocality);
  ok("DIRECTION_BOUNDARY_PASS", card.communication.direction === "do centra", card.communication.direction);
  ok(
    "PLACE_LINE_PASS",
    /I\/26\s*·\s*ulice\s+Rokycanská\s*·\s*Plzeň\s*·\s*směr\s+do centra/i.test(card.placeLine || ""),
    card.placeLine
  );
  const sum = String(card.situationSummary || "");
  ok("TRAFFIC_SUMMARY_PASS", /částečn/i.test(sum) && /odbočovací/i.test(sum) && /Vavřínová/i.test(sum), sum);
  ok("TRAFFIC_SUMMARY_NO_MID_UL", !/s ul\.\s*$/i.test(sum.trim()) && !/s ul\.\s/i.test(sum), sum);
  ok("TRAFFIC_SUMMARY_NO_OVERFLOW_DIR", !/v souvislosti s prováděním/i.test(sum), sum);
  ok("TRAFFIC_SUMMARY_COMPLETE_SENTENCE", /[.!?]\s*$/.test(sum.trim()), sum);
  const rows = (card.expanded && card.expanded.rows) || [];
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  ok("DETAIL_ROAD", byKey.road === "I/26", byKey.road);
  ok("DETAIL_ROAD_CLASS", /I\.\s*třídy/i.test(byKey.roadClass || ""), byKey.roadClass);
  ok("DETAIL_MUNI", byKey.municipality === "Plzeň", byKey.municipality);
  ok("DETAIL_PART", byKey.cityPart === "Plzeň 4", byKey.cityPart);
  ok("DETAIL_STREET", byKey.street === "Rokycanská", byKey.street);
  ok("DETAIL_DIR", byKey.direction === "do centra", byKey.direction);
  ok(
    "RAW_SOURCE_PRESERVATION_PASS",
    String(byKey.sourceDescription || "").includes("(ulice Rokycanská)") &&
      String(byKey.sourceDescription || "").includes("Vydal:"),
    "raw missing"
  );
}

// --- Road identity fixtures ---
for (const [structured, comment, want] of [
  ["26", "silnice I/26 uzavírka", "I/26"],
  ["38", "silnice I/38, práce", "I/38"],
  ["171", "silnice II/171", "II/171"],
  ["387", "silnice II/387", "II/387"],
  ["D1", "dálnice D1", "D1"],
  ["I/26", "silnice I/26", "I/26"],
  ["D0", "D0 Pražský okruh", "D0"],
]) {
  const got = resolvePresentationRoadNumber(
    { road: structured, impact: comment, impactFull: comment },
    parseOfficialCommentFacts(comment)
  );
  ok("road_" + structured + "_" + want.replace("/", "_"), got === want, got);
}

ok("prefer_I26", preferClassedRoadNumber("26", "I/26") === "I/26");
ok("prefer_II171", preferClassedRoadNumber("171", "II/171") === "II/171");
ok("prefer_keep_I", preferClassedRoadNumber("I/26", "26") === "I/26");

// --- Street sanitization ---
for (const [raw, want] of [
  ["Rokycanská)", "Rokycanská"],
  ["(Rokycanská)", "Rokycanská"],
  ["Klatovská,", "Klatovská"],
  ["Horáčkova;", "Horáčkova"],
]) {
  ok("street_sanitize_" + want, sanitizeExtractedValueToken(raw) === want, sanitizeExtractedValueToken(raw));
}

// --- Direction boundary ---
for (const [raw, want] of [
  ["do centra v souvislosti s prováděním stavebních prací", "do centra"],
  ["Brno", "Brno"],
  ["Praha", "Praha"],
  ["Ostrava", "Ostrava"],
  ["Písek", "Písek"],
  ["centrum", "centrum"],
  ["do centra", "do centra"],
  ["z centra", "z centra"],
  ["vlevo", "vlevo"],
  ["vpravo", "vpravo"],
  ["Ruzyně - D7", "Ruzyně - D7"],
  ["ve směru do centra za účelem oprav", "do centra"],
]) {
  ok("dir_" + want.replace(/\s+/g, "_"), normalizeDirectionHuman(raw) === want, normalizeDirectionHuman(raw));
}

ok(
  "dir_neg_prose",
  normalizeDirectionHuman("v souvislosti s prováděním stavebních prací") == null
);
ok(
  "dir_neg_center_prose",
  normalizeDirectionHuman("práce probíhají v centru města") == null
);

// Negative: comment without "ve směru" must not invent direction from prose.
{
  const f = parseOfficialCommentFacts(
    "silnice I/20, práce probíhají v centru města, stavební práce"
  );
  ok("NEG_DIR_FROM_PROSE", !f.directionHuman, f.directionHuman);
}

{
  const f = parseOfficialCommentFacts("ulice bude uzavřena, práce na silnici");
  ok("NEG_STREET_PHRASE", !f.street || !/bude uzavřena/i.test(f.street), f.street);
}

{
  const f = parseOfficialCommentFacts(
    "silnice I/3, omezení, Vydal: Krajský úřad Plzeňského kraje"
  );
  ok("NEG_MUNI_FROM_ISSUER", !f.city || f.city !== "Plzeň", f.city);
}

// --- City-part demotion (generic, not Plzeň-only) ---
ok("split_plzen", (() => {
  const s = splitMunicipalityAndCityPart("Plzeň 4");
  return s && s.municipality === "Plzeň" && s.cityPart === "Plzeň 4";
})());
ok("split_brno", (() => {
  const s = splitMunicipalityAndCityPart("Brno 1");
  return s && s.municipality === "Brno" && s.cityPart === "Brno 1";
})());
ok("split_praha", (() => {
  const s = splitMunicipalityAndCityPart("Praha 4");
  return s && s.municipality === "Praha" && s.cityPart === "Praha 4";
})());
ok("split_reject_street", splitMunicipalityAndCityPart("Rokycanská 4") == null);
ok("is_numeric_part", isNumericCityPartName("Plzeň 4") === true);

// --- Cross-event direction parse ---
for (const et of [
  "nehoda",
  "prekazka",
  "uzavirka",
  "omezeni",
  "prace",
  "kolona",
  "silny_provoz",
  "porucha",
]) {
  const card = buildTrafficCardPresentation({
    eventType: et,
    road: "D1",
    impact: "D1 ve směru Brno v souvislosti s prováděním oprav, " + et,
    impactFull: "D1 ve směru Brno v souvislosti s prováděním oprav, " + et,
  });
  ok("CROSS_DIR_" + et, card.communication.direction === "Brno", card.communication.direction);
}

// --- KM regression coexistence ---
{
  const card = buildTrafficCardPresentation({
    road: "I/38",
    municipality: "Kolín",
    kilometerFrom: 12.5,
    impact: "silnice I/38 (ulice Pražská), Kolín, km 12.5, ve směru Praha, práce na silnici",
    impactFull: "silnice I/38 (ulice Pražská), Kolín, km 12.5, ve směru Praha, práce na silnici",
  });
  ok(
    "KM_WITH_URBAN",
    /I\/38/i.test(card.placeLine || "") &&
      /km\s*12,5/i.test(card.placeLine || "") &&
      /Praha/i.test(card.placeLine || ""),
    card.placeLine
  );
}

console.log(
  JSON.stringify(
    {
      pass: fails.length === 0,
      failed: fails,
      counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
      MUNICIPALITY_SIGN_PASS: results.find((r) => r.id === "MUNICIPALITY_SIGN_PASS")?.pass,
      ROAD_IDENTITY_PASS: results.find((r) => r.id === "ROAD_IDENTITY_PASS")?.pass,
      STREET_SANITIZATION_PASS: results.find((r) => r.id === "STREET_SANITIZATION_PASS")?.pass,
      DIRECTION_BOUNDARY_PASS: results.find((r) => r.id === "DIRECTION_BOUNDARY_PASS")?.pass,
      TRAFFIC_SUMMARY_PASS: results.find((r) => r.id === "TRAFFIC_SUMMARY_PASS")?.pass,
      RAW_SOURCE_PRESERVATION_PASS: results.find((r) => r.id === "RAW_SOURCE_PRESERVATION_PASS")?.pass,
    },
    null,
    2
  )
);
if (fails.length) {
  console.error("IU_TRAFFIC_URBAN_NUMBERED_ROAD_PARSE_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_URBAN_NUMBERED_ROAD_PARSE_GUARD_PASS");
process.exit(0);
