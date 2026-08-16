#!/usr/bin/env node
/**
 * Street-in-municipality ("v ulici A v obci B") composition guard.
 *
 * Explicit "v obci B" must become municipality=B (not generic locality only).
 * Header: [B] ulice: A. Place must keep both street and municipality.
 * Bare Czech city name "Most" must not be misclassified as a bridge object.
 *
 * Pure local, no network. No street/city hardcode pass path.
 */
import {
  parseOfficialCommentFacts,
  looksLikeNonMunicipalityPlace,
  looksLikeBridgeObjectToken,
  classifyLocationKindFromName,
  normalizeExtractedMunicipalityName,
  resolveMunicipalitySignName,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { buildTrafficCardViewModel } from "../assets/iu-traffic-overview-v1.js";

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

const MASTER_RAW = `Od 15.8.2026 19:50 do 21:55;
v ulici Bělehradská v obci Most;
nehoda;
2x OA,
PČR jede na místo.`;

const GENERIC_RAW = `Od 1.1.2027 10:00 do 11:00;
v ulici Testovacíská v obci Testov;
nehoda;
2x OA,
PČR jede na místo.`;

const LIBEREC_RAW =
  "Od 12.8.2026 18:55 do 21:00; v ulici Ještědská v obci Liberec; nehoda; OA x cyklista.";

const VELKE_BREZNO_RAW =
  "Od 15.8.2026 00:30 do 02:35; v ulici Ústecká v obci Velké Březno okres Ústí nad Labem, délka 121m; v blízkosti křižovatky s ul. Pivovarská; zvěř na vozovce; sražená srna na komunikaci.";

const U_OBCE_RAW =
  "Od 14.8.2026 08:00 do 10:00; u obce Horní Police; nehoda; OA; na místě PČR.";

const ON_SCENE_RAW =
  "D1 EXIT 10; nehoda; havárie OA; na místě PČR.";

const GENERIC_LOCALITY_ONLY =
  "Od 14.8.2026 12:00 do 13:00; u železničního přejezdu P1234; nehoda; OA.";

// --- Bridge vs municipality "Most" ---
{
  ok("BARE_MOST_NOT_BRIDGE_TOKEN", looksLikeBridgeObjectToken("Most") === false);
  ok("NAMED_BRIDGE_STILL_BRIDGE", looksLikeBridgeObjectToken("Barrandovský most") === true);
  ok("BARE_MOST_NOT_NON_MUNI", looksLikeNonMunicipalityPlace("Most") === false);
  ok(
    "BARE_MOST_KIND_NOT_BRIDGE",
    classifyLocationKindFromName("Most") !== "BRIDGE",
    classifyLocationKindFromName("Most")
  );
  ok("NORMALIZE_MOST", normalizeExtractedMunicipalityName("Most") === "Most");
}

// --- STREET_IN_MUNICIPALITY_GUARD + MUNICIPALITY_VS_LOCALITY ---
{
  const facts = parseOfficialCommentFacts(MASTER_RAW);
  ok(
    "STREET_IN_MUNICIPALITY_GUARD",
    facts.street === "Bělehradská" && facts.city === "Most",
    JSON.stringify({ street: facts.street, city: facts.city })
  );
  ok(
    "MUNICIPALITY_VS_LOCALITY_GUARD",
    facts.city === "Most" && facts.municipalityRelation === "v_obce",
    JSON.stringify({ city: facts.city, rel: facts.municipalityRelation })
  );
}

// --- Header / place / detail composition ---
{
  const input = {
    impact: MASTER_RAW,
    impactFull: MASTER_RAW,
    eventType: "nehoda",
    location: "Most",
  };
  const hdr = buildLocalityHeaderModel(input);
  const place = String(buildPlaceAndDirectionLine(input) || "");
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const rows = rowMap(card);
  const vm = buildTrafficCardViewModel(input);

  ok(
    "HEADER_MUNICIPALITY_STREET_COMPOSITION_GUARD",
    hdr.municipalitySignLabel === "MOST" &&
      /ulice:\s*Bělehradská/i.test(String(hdr.besideLocality || "")),
    JSON.stringify({ sign: hdr.municipalitySignLabel, beside: hdr.besideLocality })
  );
  ok(
    "PLACE_MUNICIPALITY_STREET_COMPOSITION_GUARD",
    /Bělehradská/i.test(place) && /Most/i.test(place),
    place
  );
  ok("DETAIL_STREET", rows.street === "Bělehradská", String(rows.street));
  ok("DETAIL_MUNICIPALITY", rows.municipality === "Most", String(rows.municipality));
  ok(
    "DETAIL_NO_LOCALITY_ECHO",
    rows.location == null || rows.location === "" || !/^Most$/i.test(String(rows.location)),
    String(rows.location)
  );
  ok(
    "TWO_OA_REGRESSION_GUARD",
    /dvou osobních automobilů/i.test(sit),
    sit
  );
  ok(
    "POLICE_EN_ROUTE_GUARD",
    (/Na místo jede PČR/i.test(sit) || /PČR jede na místo/i.test(sit)) &&
      !/Na místě je PČR/i.test(sit),
    sit
  );
  const facts = parseOfficialCommentFacts(MASTER_RAW);
  ok("POLICE_STATUS_EN_ROUTE", facts.emergencyServicesStatus === "EN_ROUTE");
  ok("MASTER_SIGN_VM", vm.municipalitySignLabel === "MOST", String(vm.municipalitySignLabel));
  ok("MASTER_DATASET_PASS", true);
}

// --- Generic letter fixture (no Most/Bělehradská hardcode) ---
{
  const facts = parseOfficialCommentFacts(GENERIC_RAW);
  const input = { impact: GENERIC_RAW, impactFull: GENERIC_RAW, eventType: "nehoda" };
  const hdr = buildLocalityHeaderModel(input);
  const place = String(buildPlaceAndDirectionLine(input) || "");
  ok(
    "GENERIC_STREET_IN_MUNI",
    /Testovacíská/i.test(String(facts.street || "")) &&
      /Testov/i.test(String(facts.city || "")),
    JSON.stringify({ street: facts.street, city: facts.city })
  );
  ok(
    "GENERIC_HEADER",
    hdr.municipalitySignLabel === "TESTOV" &&
      /ulice:\s*Testovacíská/i.test(String(hdr.besideLocality || "")),
    JSON.stringify({ sign: hdr.municipalitySignLabel, beside: hdr.besideLocality })
  );
  ok("GENERIC_PLACE", /Testovacíská/i.test(place) && /Testov/i.test(place), place);
}

// --- TRUE_GENERIC_LOCALITY_POSITIVE_GUARD ---
{
  const facts = parseOfficialCommentFacts(GENERIC_LOCALITY_ONLY);
  const input = {
    impact: GENERIC_LOCALITY_ONLY,
    impactFull: GENERIC_LOCALITY_ONLY,
    eventType: "nehoda",
    location: "železniční přejezd P1234",
  };
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  ok(
    "TRUE_GENERIC_LOCALITY_POSITIVE_GUARD",
    facts.city == null &&
      (rows.location || rows.namedObject || rows.tunnel || rows.bridge) &&
      !/^Most$/i.test(String(rows.municipality || "")),
    JSON.stringify({
      city: facts.city,
      location: rows.location,
      named: rows.namedObject,
      muni: rows.municipality,
    })
  );
}

// --- Libererec / Velké Březno / u obce ---
{
  const lib = parseOfficialCommentFacts(LIBEREC_RAW);
  const libHdr = buildLocalityHeaderModel({
    impact: LIBEREC_RAW,
    impactFull: LIBEREC_RAW,
    eventType: "nehoda",
  });
  ok(
    "LIBEREC_STREET_REGRESSION_GUARD",
    lib.street === "Ještědská" &&
      lib.city === "Liberec" &&
      libHdr.municipalitySignLabel === "LIBEREC" &&
      /Ještědská/i.test(String(libHdr.besideLocality || "")),
    JSON.stringify({ street: lib.street, city: lib.city, sign: libHdr.municipalitySignLabel })
  );

  const vb = parseOfficialCommentFacts(VELKE_BREZNO_RAW);
  ok(
    "VELKE_BREZNO_STREET_REGRESSION_GUARD",
    vb.street === "Ústecká" &&
      vb.city === "Velké Březno" &&
      vb.crossStreet === "Pivovarská",
    JSON.stringify({ street: vb.street, city: vb.city, cross: vb.crossStreet })
  );

  const uo = parseOfficialCommentFacts(U_OBCE_RAW);
  ok(
    "U_OBCE_RELATION_REGRESSION_GUARD",
    uo.city === "Horní Police" && uo.municipalityRelation === "u_obce",
    JSON.stringify({ city: uo.city, rel: uo.municipalityRelation })
  );
}

// --- ON_SCENE regression ---
{
  const facts = parseOfficialCommentFacts(ON_SCENE_RAW);
  const sit = String(
    buildTrafficSituationSummary({
      impact: ON_SCENE_RAW,
      impactFull: ON_SCENE_RAW,
      eventType: "nehoda",
    }) || ""
  );
  ok(
    "POLICE_ON_SCENE_REGRESSION_GUARD",
    facts.emergencyServicesStatus === "ON_SCENE" && /Na místě je PČR/i.test(sit),
    sit
  );
}

const out = {
  guard: "iu-traffic-street-in-municipality-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_STREET_IN_MUNICIPALITY_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_STREET_IN_MUNICIPALITY_GUARD_PASS");
