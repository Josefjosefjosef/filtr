#!/usr/bin/env node
/**
 * Municipality parenthetical / multi-street / multi-road / event-reason guard.
 * Fixture-based (Velký Újezd style) — no hardcode-only pass path for one town.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  normalizeExtractedMunicipalityName,
  extractMunicipalityParentheticalLocalityDetail,
  extractStreetNamesFromOfficialComment,
  extractAllRoadNumbersFromOfficialComment,
  extractEventReasonFromOfficialComment,
  looksLikeTruncatedFragment,
  sanitizeExtractedValueToken,
} from "../assets/iu-traffic-card-presenter-v1.js";
import {
  extractLocalityFromOfficialComment,
  chooseHumanLocality,
  looksLikeContaminatedLocalityToken,
  stripMunicipalityParentheticalDetail,
} from "../scripts/ndic-datex-v1/traffic-card-content-v1.mjs";
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
  const rows = (card.expanded && card.expanded.rows) || [];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const REF_RAW =
  'silnice III/03554 (ulice Olomoucká - ulice Lipenská), Velký Újezd, okr. Olomouc, Od 16.08.2026 00:00, Do 16.08.2026 23:59, Úplná uzavírka silnice č. III/03554 ul. Olomoucká, Lipenská a silnice č. III/43617 ul. Přerovská v obci Velký Újezd (u domů č. 100, 17 a 63) z důvodu konání kulturní akce "Hodové slavnosti 2026"., Vydal: Magistrát města Olomouce';

const CONTAMINATED_MUNI = "Velký Újezd (u domů č. 100";
const CONTAMINATED_LOC = "Olomoucká - ulice Lipenská)";
const IMPACT_TRUNC = REF_RAW.slice(0, 159) + "…";

// --- MUNICIPALITY_PARENTHETICAL_CONTAMINATION_GUARD ---
{
  ok(
    "MUNI_NORM_CLEAN",
    normalizeExtractedMunicipalityName(CONTAMINATED_MUNI) === "Velký Újezd",
    normalizeExtractedMunicipalityName(CONTAMINATED_MUNI)
  );
  ok(
    "MUNI_NORM_NO_PAREN_MARK",
    !/\(u\s+domů/i.test(normalizeExtractedMunicipalityName(CONTAMINATED_MUNI) || "")
  );
  const detail = extractMunicipalityParentheticalLocalityDetail(REF_RAW);
  ok("LOC_DETAIL_HOUSES", /domů|č\./i.test(detail || ""), detail);
  ok(
    "LOC_DETAIL_NOT_CAST_OBEC",
    detail !== "Velký Újezd" && !/^Velký Újezd/i.test(detail || "")
  );
}

// --- Projection locality extract (publication snapshot path) ---
{
  const loc = extractLocalityFromOfficialComment(REF_RAW);
  ok("PROJ_MUNI_CLEAN", loc.municipality === "Velký Újezd", loc.municipality);
  ok("PROJ_MUNI_NO_PAREN", !/\(/.test(loc.municipality || ""));
  ok("PROJ_DISTRICT", loc.district === "Olomouc", loc.district);
  ok(
    "PROJ_STREET_HINT_NO_DANGLING",
    !looksLikeContaminatedLocalityToken(loc.streetHint || "") &&
      !/\)/.test(loc.streetHint || ""),
    loc.streetHint
  );
  ok(
    "PROJ_STRIP_HELPER",
    stripMunicipalityParentheticalDetail(CONTAMINATED_MUNI) === "Velký Újezd"
  );
  ok("PROJ_CONTAM_DETECT", looksLikeContaminatedLocalityToken(CONTAMINATED_LOC) === true);
  ok(
    "PROJ_CHOOSE_HUMAN",
    chooseHumanLocality({
      locationLabel: CONTAMINATED_LOC,
      summary: REF_RAW,
      roadNumber: "III/03554",
    }) === "Velký Újezd"
  );
  ok(
    "PROJ_CHOOSE_REJECT_STREET_GLUE",
    chooseHumanLocality({
      locationLabel: CONTAMINATED_LOC,
      summary: "",
      roadNumber: null,
    }) !== CONTAMINATED_LOC &&
      !looksLikeContaminatedLocalityToken(
        chooseHumanLocality({
          locationLabel: CONTAMINATED_LOC,
          summary: "",
          roadNumber: null,
        }) || ""
      )
  );
}

// --- MULTI_STREET / MULTI_ROAD / EVENT ---
{
  const streets = extractStreetNamesFromOfficialComment(REF_RAW);
  ok("STREET_1", streets.includes("Olomoucká"), JSON.stringify(streets));
  ok("STREET_2", streets.includes("Lipenská"), JSON.stringify(streets));
  ok("STREET_3", streets.includes("Přerovská"), JSON.stringify(streets));
  ok(
    "STREET_NO_DANGLING",
    streets.every((s) => !/[()]$/.test(s) && !looksLikeTruncatedFragment(s))
  );
  ok(
    "STREET_NO_GLUE",
    !streets.some((s) => /\s-\s*ulice\s+/i.test(s) || /ulice\s+/i.test(s))
  );

  const roads = extractAllRoadNumbersFromOfficialComment(REF_RAW);
  ok("PRIMARY_ROAD", roads[0] === "III/03554", JSON.stringify(roads));
  ok("SECONDARY_ROAD", roads.includes("III/43617"), JSON.stringify(roads));

  const reason = extractEventReasonFromOfficialComment(REF_RAW);
  ok("EVENT_REASON_KIND", reason.reasonKind === "CULTURAL_EVENT", reason.reasonKind);
  ok(
    "EVENT_NAME",
    reason.eventName === "Hodové slavnosti 2026",
    reason.eventName
  );
  ok("EVENT_NO_VYDAL", !/Magistrát|Vydal/i.test(reason.eventName || ""));
}

// --- Card presentation acceptance ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("FACTS_MUNI", facts.city === "Velký Újezd", facts.city);
  ok("FACTS_MUNI_CLEAN", !/\(u\s+domů/i.test(facts.city || ""));
  ok("FACTS_ROADS", (facts.roadNumbers || []).includes("III/43617"));
  ok("FACTS_STREETS_3", (facts.streets || []).length >= 3, JSON.stringify(facts.streets));
  ok("FACTS_LOCALITY_DETAIL", /domů/i.test(facts.localityDetail || ""), facts.localityDetail);
  ok("FACTS_EVENT_NAME", facts.eventName === "Hodové slavnosti 2026", facts.eventName);

  const card = buildTrafficCardPresentation({
    impact: REF_RAW,
    impactFull: REF_RAW,
    road: "03554",
    location: CONTAMINATED_LOC,
    municipality: CONTAMINATED_MUNI,
    eventType: "uzavirka",
  });
  const hdr = buildLocalityHeaderModel({
    impact: REF_RAW,
    impactFull: REF_RAW,
    road: "03554",
    location: CONTAMINATED_LOC,
    municipality: CONTAMINATED_MUNI,
  });
  const rows = rowMap(card);
  const sum = String(card.situationSummary || "");

  ok("SIGN_CLEAN", hdr.municipalitySignLabel === "VELKÝ ÚJEZD", hdr.municipalitySignLabel);
  ok("SIGN_NO_PAREN", !/\(/.test(hdr.municipalitySignLabel || ""));
  ok(
    "STREET_DISPLAY",
    /Olomoucká/.test(hdr.street || "") &&
      /Lipenská/.test(hdr.street || "") &&
      /Přerovská/.test(hdr.street || "") &&
      !/\)/.test(hdr.street || "") &&
      !/\s-\s*ulice\s+/i.test(hdr.street || ""),
    hdr.street
  );
  ok("ROW_MUNI", rows.municipality === "Velký Újezd", rows.municipality);
  ok("ROW_ROADS", /III\/03554/.test(rows.road || "") && /III\/43617/.test(rows.road || ""), rows.road);
  ok("ROW_LOCALITY_HOUSES", /domů/i.test(rows.location || ""), rows.location);
  ok(
    "ROW_NO_STREET_ECHO_LOCALITY",
    !/Olomoucká\s*-\s*ulice/i.test(rows.location || "")
  );
  ok("SUM_NOT_GENERIC_ONLY", !/^Úplná\s+uzavírka\s+komunikace\.?$/i.test(sum.trim()), sum);
  ok("SUM_SECONDARY_ROAD", /III\/43617/.test(sum), sum);
  ok("SUM_REASON", /kulturní\s+akc/i.test(sum), sum);
  ok("SUM_EVENT_NAME", /Hodové\s+slavnosti\s+2026/i.test(sum), sum);
  ok("SUM_NO_VYDAL", !/Vydal:/i.test(sum));
  ok("SUM_COMPLETE", /[.!?]\s*$/.test(sum.trim()), sum);
  ok(
    "NO_DANGLING_FIELDS",
    ![rows.municipality, rows.street, rows.location, hdr.street, hdr.municipalitySign].some(
      (v) => v && (looksLikeTruncatedFragment(v) || /[()]$/.test(String(v)))
    )
  );
  ok(
    "RAW_PRESERVED",
    /Hodové\s+slavnosti\s+2026/i.test(rows.sourceDescription || "") &&
      /Vydal:\s*Magistrát/i.test(rows.sourceDescription || "")
  );
}

// --- Live production snapshot shape (null municipality + contaminated location) ---
{
  const liveShape = {
    municipality: null,
    road: null,
    location: CONTAMINATED_LOC,
    district: "Olomouc",
    eventType: "omezeni",
    impact: IMPACT_TRUNC,
    impactFull: REF_RAW,
  };
  const card = buildTrafficCardPresentation(liveShape);
  const hdr = buildLocalityHeaderModel(liveShape);
  const rows = rowMap(card);
  const sum = String(card.situationSummary || "");
  const vm = buildTrafficCardViewModel(liveShape);

  ok("LIVE_SIGN", hdr.municipalitySignLabel === "VELKÝ ÚJEZD", hdr.municipalitySignLabel);
  ok("LIVE_MUNI_ROW", rows.municipality === "Velký Újezd", rows.municipality);
  ok(
    "LIVE_VM_MUNI",
    vm.municipality === "Velký Újezd" && vm.municipalitySignLabel === "VELKÝ ÚJEZD",
    JSON.stringify({ m: vm.municipality, s: vm.municipalitySignLabel, loc: vm.locality })
  );
  ok(
    "LIVE_VM_NO_CONTAM_LOCALITY",
    !looksLikeContaminatedLocalityToken(vm.locality || "") &&
      !/\)/.test(String(vm.locality || "")) &&
      !/\s-\s*ulice/i.test(String(vm.locality || "")),
    vm.locality
  );
  ok(
    "LIVE_VM_NO_CONTAM_LINE",
    !/\(u\s+domů/i.test(String(vm.localityLine || "")) &&
      !/\)/.test(String(vm.localityLine || "")),
    vm.localityLine
  );
  ok("LIVE_ROADS", /III\/03554/.test(rows.road || "") && /III\/43617/.test(rows.road || ""), rows.road);
  ok(
    "LIVE_STREETS",
    /Olomoucká/.test(rows.street || "") &&
      /Lipenská/.test(rows.street || "") &&
      /Přerovská/.test(rows.street || ""),
    rows.street
  );
  ok("LIVE_HOUSES", /domů/i.test(rows.location || ""), rows.location);
  ok("LIVE_SUM_EVENT", /Hodové\s+slavnosti\s+2026/i.test(sum), sum);
  ok("LIVE_SUM_NOT_GENERIC", !/^Úplná\s+uzavírka\s+komunikace\.?$/i.test(sum.trim()), sum);
  ok(
    "LIVE_BESIDE_NO_GLUE",
    !/\s-\s*ulice\s+/i.test(String(hdr.besideLocality || "")) &&
      !/\)/.test(String(hdr.besideLocality || "")),
    hdr.besideLocality
  );
}

// --- Negatives ---
{
  const partOnly =
    "v obci Nová Ves (část obce nad potokem), okr. Benešov, práce na silnici";
  const d = extractMunicipalityParentheticalLocalityDetail(partOnly);
  ok("NEG_CAST_OBCE_NO_HOUSE_DETAIL", d == null, d);

  const vydalQuote =
    'práce na silnici. Vydal: Úřad "Hodové slavnosti 2026" Olomouc';
  const r = extractEventReasonFromOfficialComment(vydalQuote);
  ok("NEG_VYDAL_NOT_EVENT", r.eventName == null && r.reasonText == null, JSON.stringify(r));

  const houseAsRoad = parseOfficialCommentFacts(
    'v obci Testov (u domů č. 100, 17 a 63), úplná uzavírka místní komunikace'
  );
  ok(
    "NEG_HOUSE_NOT_ROAD",
    !(houseAsRoad.roadNumbers || []).some((x) => /100|17|63/.test(x)),
    JSON.stringify(houseAsRoad.roadNumbers)
  );

  const publisherCity = parseOfficialCommentFacts(REF_RAW);
  ok("NEG_PUBLISHER_NOT_MUNI", publisherCity.city === "Velký Újezd", publisherCity.city);

  ok(
    "NEG_GLUE_SANITIZE",
    !/\)/.test(sanitizeExtractedValueToken(CONTAMINATED_LOC))
  );
  ok(
    "NEG_TRUNC_DETECT",
    looksLikeTruncatedFragment(CONTAMINATED_MUNI) === true
  );
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  MUNICIPALITY_PARENTHETICAL_CONTAMINATION_GUARD: results
    .filter((r) => r.id.startsWith("MUNI_") || r.id.startsWith("LOC_DETAIL"))
    .every((r) => r.pass),
  MULTI_STREET_GUARD: results.filter((r) => r.id.startsWith("STREET_")).every((r) => r.pass),
  MULTI_ROAD_GUARD: results
    .filter((r) => r.id.includes("ROAD") || r.id === "PRIMARY_ROAD" || r.id === "SECONDARY_ROAD")
    .every((r) => r.pass),
  EVENT_REASON_GUARD: results
    .filter((r) => r.id.startsWith("EVENT_") || r.id.startsWith("SUM_REASON") || r.id.startsWith("SUM_EVENT"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results
    .filter((r) => r.id.startsWith("SUM_") || r.id.startsWith("LIVE_SUM_"))
    .every((r) => r.pass),
  NO_TRUNCATION_GUARD: results
    .filter((r) => r.id.includes("DANGLING") || r.id.includes("TRUNC") || r.id.includes("NO_PAREN") || r.id.includes("CONTAM"))
    .every((r) => r.pass),
  PROJECTION_LOCALITY_GUARD: results.filter((r) => r.id.startsWith("PROJ_")).every((r) => r.pass),
  LIVE_SNAPSHOT_SHAPE_GUARD: results.filter((r) => r.id.startsWith("LIVE_")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_MUNICIPALITY_PARENTHETICAL_MULTI_ROAD_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_MUNICIPALITY_PARENTHETICAL_MULTI_ROAD_GUARD_PASS");
