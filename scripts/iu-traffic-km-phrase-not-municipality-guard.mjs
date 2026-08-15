#!/usr/bin/env node
/**
 * KM_PHRASE_NOT_MUNICIPALITY_GUARD
 *
 * Kilometrage phrases ("Na km 46", "mezi km 45.9 a 46") must never become
 * municipality or city-district facts. Fixture may use D11 / Hradec Králové
 * as realistic sample values — implementation must not hardcode those roads.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  buildPlaceAndDirectionLine,
  splitMunicipalityAndCityPart,
  isKilometerLocationPhrase,
  normalizeExtractedMunicipalityName,
  classifyEventPresentation,
  analyzePrimaryCause,
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

function isFakeKmMunicipality(val) {
  const t = String(val || "").trim();
  if (!t) return false;
  return (
    isKilometerLocationPhrase(t) ||
    /^(?:na|mezi|od|do)\s+km\b/i.test(t) ||
    /^km\b/i.test(t)
  );
}

const REF_RAW =
  "D11, mezi km 45.9 a 46, ve směru Hradec Králové, porouchané vozidlo, zdržení, zpevněná krajnice (odstavný pruh) uzavřená, Od 14.08.2026 19:56 Do 14.08.2026 21:30, Na km 46,0 sm. HK v OP označený NA s def. pneu na návěsu, čeká na servis, podnět PČR, zabezpečení a označení mimořádné události, pracovní místo DN – nouze nebo nehoda, Vydal: SSÚD 13 - Poříčany";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  eventType: "omezeni",
  category: "omezeni",
  road: "D11",
  illustrationKey: "omezeni",
};

// --- Primary D11 fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const card = buildTrafficCardPresentation(REF_INPUT);
  const hdr = buildLocalityHeaderModel(REF_INPUT);
  const place = String(card.placeLine || buildPlaceAndDirectionLine(REF_INPUT) || "");
  const cause = analyzePrimaryCause(REF_RAW, REF_INPUT);
  const ev = classifyEventPresentation(REF_INPUT);

  ok("ROAD_STRUCTURED", facts.roadNumber === "D11" || REF_INPUT.road === "D11", facts.roadNumber);
  ok("KM_SOURCE_PRESENT", /mezi\s+km\s+45[.,]9\s+a\s+46/i.test(REF_RAW));
  ok("KM_FROM", facts.kilometerFrom === "45,9", facts.kilometerFrom);
  ok("KM_TO", facts.kilometerTo === "46", facts.kilometerTo);
  ok(
    "KM_RANGE_STRUCTURED",
    /km\s+45[,.]9\s*[–-]\s*46/i.test(String(facts.kilometerLabel || "")),
    facts.kilometerLabel
  );
  ok("SPECIFIC_KM_POINT_SOURCE_PRESENT", /Na\s+km\s+46[,.]0/i.test(REF_RAW));
  ok("DIRECTION_STRUCTURED", /Hradec\s+Králové/i.test(facts.directionHuman || ""), facts.directionHuman);

  ok("MUNICIPALITY_EXTRACTED_AFTER_NO", !facts.city, facts.city);
  ok("CITY_DISTRICT_EXTRACTED_AFTER_NO", !facts.cityPart, facts.cityPart);
  ok("MUNICIPALITY_SIGN_ABSENT", !hdr.municipalitySign, hdr.municipalitySign);
  ok("CITY_PART_ROW_ABSENT", !hdr.cityPartRow, hdr.cityPartRow);
  ok(
    "PLACE_DIRECTION_AFTER_PASS",
    /D11/i.test(place) &&
      /km\s+45[,.]9\s*[–-]\s*46/i.test(place) &&
      /Hradec\s+Králové/i.test(place) &&
      !/Na\s+km/i.test(place),
    place
  );
  ok(
    "MOTORWAY_HEADER_AFTER_PASS",
    !hdr.municipalitySign && !/NA\s+KM/i.test(String(hdr.municipalitySignLabel || "")),
    JSON.stringify({ sign: hdr.municipalitySign, label: hdr.municipalitySignLabel })
  );

  ok(
    "KM_PHRASE_NOT_MUNICIPALITY_GUARD",
    !facts.city && !facts.cityPart && !isFakeKmMunicipality(facts.city),
    JSON.stringify({ city: facts.city, cityPart: facts.cityPart })
  );
  ok(
    "KM_RANGE_GUARD",
    facts.kilometerFrom === "45,9" && facts.kilometerTo === "46" && !facts.city,
    facts.kilometerLabel
  );
  ok(
    "NEGATIVE_MUNICIPALITY_GUARD",
    !isFakeKmMunicipality(facts.city) && !isFakeKmMunicipality(facts.cityPart),
    JSON.stringify({ city: facts.city, cityPart: facts.cityPart })
  );

  // Classifier regression report (owned by prior PR) — do not block location DoD.
  ok(
    "BROKEN_VEHICLE_CLASSIFIER_REGRESSION_STILL_PRESENT_NO",
    cause === "BROKEN_VEHICLE" && ev.titleCs === "POROUCHANÉ VOZIDLO",
    cause + "|" + ev.titleCs
  );
}

// --- Generic road (no D11 hardcode pass path) ---
{
  const raw =
    "D5, mezi km 10.1 a 10.5, ve směru Plzeň, Na km 10,3 sm. PL, porouchané vozidlo";
  const facts = parseOfficialCommentFacts(raw);
  ok("GENERIC_NO_MUNI", !facts.city && !facts.cityPart, facts.city + "|" + facts.cityPart);
  ok(
    "GENERIC_KM_RANGE",
    facts.kilometerFrom === "10,1" && facts.kilometerTo === "10,5",
    facts.kilometerLabel
  );
}

// --- Helper unit checks ---
{
  ok("IS_KM_NA_KM_46", isKilometerLocationPhrase("Na km 46") === true);
  ok("IS_KM_NA_KM_BARE", isKilometerLocationPhrase("Na km") === true);
  ok("IS_KM_MEZI", isKilometerLocationPhrase("mezi km 45.9 a 46") === true);
  ok("IS_KM_RANGE_LABEL", isKilometerLocationPhrase("km 45,9–46") === true);
  ok(
    "NOT_KM_REAL_PLACE_NA",
    isKilometerLocationPhrase("Na Hrázi") === false,
    "Na Hrázi"
  );
  ok("SPLIT_NA_KM_NULL", splitMunicipalityAndCityPart("Na km 46") == null);
  ok("SPLIT_PLZEN_OK", !!splitMunicipalityAndCityPart("Plzeň 4"));
  ok(
    "NORMALIZE_NA_KM_NULL",
    normalizeExtractedMunicipalityName("Na km") == null
  );
  ok(
    "NORMALIZE_REAL_OK",
    normalizeExtractedMunicipalityName("Horní Police") === "Horní Police"
  );
}

// --- Protect real municipality / city-part / street fixtures ---
{
  let muniBroken = 0;
  let districtBroken = 0;

  const near = parseOfficialCommentFacts(
    "Od 14.8.2026 18:00 do 19:00; na silnici 263 u obce Horní Police okres Česká Lípa; nehoda; havárie OA."
  );
  if (near.city !== "Horní Police" || near.municipalityRelation !== "u_obce") muniBroken += 1;
  ok("REAL_U_OBCE_HORNI_POLICE", near.city === "Horní Police", near.city);

  const inTown = parseOfficialCommentFacts(
    "Od 14.8.2026 14:40 do 15:40; na silnici 0357 v obci Višňová okres Liberec; porouchané vozidlo."
  );
  if (inTown.city !== "Višňová") muniBroken += 1;
  ok("REAL_V_OBCI_VISNOVA", inTown.city === "Višňová", inTown.city);

  const street = parseOfficialCommentFacts(
    "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; OA x cyklista."
  );
  if (street.city !== "Liberec" || !/Ještědská/i.test(street.street || "")) muniBroken += 1;
  ok(
    "REAL_STREET_LIBEREC",
    street.city === "Liberec" && /Ještědská/i.test(street.street || ""),
    street.city + "|" + street.street
  );

  const plzen = parseOfficialCommentFacts(
    "silnice I/26 (ulice Rokycanská), Plzeň 4, odbočovací pruh uzavřen"
  );
  if (plzen.city !== "Plzeň" || plzen.cityPart !== "Plzeň 4") districtBroken += 1;
  ok(
    "REAL_CITY_DISTRICT_PLZEN",
    plzen.city === "Plzeň" && plzen.cityPart === "Plzeň 4",
    plzen.city + "|" + plzen.cityPart
  );

  const praha = parseOfficialCommentFacts("ulice Tunel Mrázovka, Praha 5, Praha, uzavřeno");
  if (praha.city !== "Praha" || !/Praha\s+5/i.test(praha.cityPart || "")) districtBroken += 1;
  ok(
    "REAL_CITY_DISTRICT_PRAHA",
    praha.city === "Praha" && /Praha\s+5/i.test(praha.cityPart || ""),
    praha.city + "|" + praha.cityPart
  );

  ok("REAL_MUNICIPALITY_CASES_BROKEN_0", muniBroken === 0, String(muniBroken));
  ok("REAL_CITY_DISTRICT_CASES_BROKEN_0", districtBroken === 0, String(districtBroken));
}

const out = {
  guard: "iu-traffic-km-phrase-not-municipality-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_KM_PHRASE_NOT_MUNICIPALITY_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_KM_PHRASE_NOT_MUNICIPALITY_PASS");
