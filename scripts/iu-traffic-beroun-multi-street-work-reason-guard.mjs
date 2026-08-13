#!/usr/bin/env node
/**
 * Beroun-class multi-street range + locality dedup + specific work / closure impact.
 * Fixture-based general guards — no Beroun / Dobrovského / Vorlova hardcode pass path.
 * Pure local, no network.
 */
import {
  looksLikeStreetName,
  extractStreetNamesFromOfficialComment,
  extractStreetRangeFromOfficialComment,
  extractSpecificWorkFromOfficialComment,
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  resolveConfirmedStreet,
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
  const rows = (card.expanded && card.expanded.rows) || [];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const REF_RAW =
  "ulice Dobrovského - ulice Vorlova, Beroun, okr. Beroun, uzavřeno, stavební práce, Od 19.08.2026 00:00 Do 30.09.2026 23:59, Rekonstrukce plynovodu, Vydal: Městský úřad Beroun";

// --- Morphology: genitive street names ---
ok("STREET_MORPH_GENITIVE", looksLikeStreetName("Dobrovského") === true);
ok("STREET_MORPH_OVA", looksLikeStreetName("Vorlova") === true);
ok("STREET_MORPH_PALACKEHO", looksLikeStreetName("Palackého") === true);

// --- MULTI_STREET / STREET_RANGE ---
{
  const range = extractStreetRangeFromOfficialComment(REF_RAW);
  ok("RANGE_FROM", range && range.streetFrom === "Dobrovského", JSON.stringify(range));
  ok("RANGE_TO", range && range.streetTo === "Vorlova", JSON.stringify(range));
  const streets = extractStreetNamesFromOfficialComment(REF_RAW);
  ok("STREETS_HAS_FROM", streets.includes("Dobrovského"), JSON.stringify(streets));
  ok("STREETS_HAS_TO", streets.includes("Vorlova"), JSON.stringify(streets));
  ok(
    "STREETS_NO_ULICE_GLUE",
    !streets.some((s) => /\sulice\s+/i.test(s) || /\s-\s*ulice/i.test(s)),
    JSON.stringify(streets)
  );

  const between = extractStreetRangeFromOfficialComment(
    "omezení mezi ulicemi Moskevská a Rokycanská, Plzeň"
  );
  ok(
    "BETWEEN_FROM",
    between && between.streetFrom === "Moskevská",
    JSON.stringify(between)
  );
  ok("BETWEEN_TO", between && between.streetTo === "Rokycanská", JSON.stringify(between));

  const odK = extractStreetRangeFromOfficialComment(
    "od ulice Havlíčkova k ulici Palackého, Frýdlant"
  );
  ok("OD_K_FROM", odK && odK.streetFrom === "Havlíčkova", JSON.stringify(odK));
  ok("OD_K_TO", odK && odK.streetTo === "Palackého", JSON.stringify(odK));
}

// --- Reference card presentation ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("FACT_STREET_FROM", facts.streetFrom === "Dobrovského", facts.streetFrom);
  ok("FACT_STREET_TO", facts.streetTo === "Vorlova", facts.streetTo);
  ok("FACT_STREET_RANGE", facts.streetRange === true);
  ok("FACT_CITY", facts.city === "Beroun", facts.city);
  ok("FACT_DISTRICT", facts.district === "Beroun", facts.district);
  ok(
    "FACT_SPECIFIC_WORK",
    /plynovodu/i.test(facts.specificWork || ""),
    facts.specificWork
  );

  const input = {
    summaryFull: REF_RAW,
    summary: REF_RAW,
    eventType: "roadworks",
    location: "Beroun",
    municipality: "Beroun",
    district: "Beroun",
    streetHint: "Dobrovského - ulice Vorlova",
    ndicV1: { officialComment: REF_RAW },
  };
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  const street = resolveConfirmedStreet(input) || "";
  ok("RENDER_BOTH_STREETS", /Dobrovského/i.test(street) && /Vorlova/i.test(street), street);
  ok("RENDER_NO_ULICE_DUP", !/ulice\s+.*ulice/i.test(street), street);
  ok("RENDER_EN_DASH", /–/.test(street) || /Dobrovského\s+[–-]\s+Vorlova/.test(street), street);
  ok(
    "HEADER_RANGE",
    /Dobrovského/i.test(card.communication.streetLabel || "") &&
      /Vorlova/i.test(card.communication.streetLabel || ""),
    card.communication.streetLabel
  );
  ok(
    "PLACE_RANGE",
    /Dobrovského/i.test(card.placeLine || "") && /Vorlova/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok("PLACE_NO_RAW_GLUE", !/ulice\s+Dobrovského\s*-\s*ulice/i.test(card.placeLine || ""));

  ok("SHOW_MUNICIPALITY", rows.municipality === "Beroun", rows.municipality);
  ok("SHOW_DISTRICT", rows.district === "Beroun", rows.district);
  ok("HIDE_LOCALITY_DUP", !rows.location, rows.location || "");

  const sit = String(card.situationSummary || "");
  ok("SIT_NOT_GENERIC_ONLY", !/^stavební práce\.?$/i.test(sit.trim()), sit);
  ok("SIT_HAS_CLOSURE", /uzavř/i.test(sit), sit);
  ok("SIT_HAS_ROADWORKS", /stavebn/i.test(sit), sit);
  ok("SIT_HAS_GAS", /plynovod/i.test(sit), sit);
  ok("SIT_NO_VYDAL", !/Vydal:/i.test(sit), sit);
  ok("RAW_PRESERVED", /Dobrovského\s*-\s*ulice\s+Vorlova/i.test(rows.sourceDescription || ""));
}

// --- Locality dedup distinct ---
{
  const card = buildTrafficCardPresentation({
    summaryFull: "ulice Moskevská, Beroun, okr. Beroun, stavební práce",
    summary: "ulice Moskevská, Beroun, okr. Beroun, stavební práce",
    eventType: "roadworks",
    municipality: "Beroun",
    district: "Beroun",
    location: "Závodí",
  });
  const rows = rowMap(card);
  ok("DISTINCT_LOC_MUNI", rows.municipality === "Beroun");
  ok("DISTINCT_LOC_SHOWN", rows.location === "Závodí", rows.location || "");
}

// --- Specific work preservation (cross-case) ---
const WORK_CASES = [
  {
    id: "GAS",
    raw: "ulice Testova, Město, okr. Okres, uzavřeno, stavební práce, Rekonstrukce plynovodu, Vydal: X",
    expect: /plynovod/i,
  },
  {
    id: "BRIDGE",
    raw: "silnice I/1, uzavřeno, stavební práce, údržba mostu, Vydal: X",
    expect: /most/i,
  },
  {
    id: "CABLE",
    raw: "místní komunikace, uzavřeno, stavební práce, z důvodu výkopu v komunikaci a uložení VN kabelu ČEZ, Vydal: X",
    expect: /výkop|kabel/i,
  },
  {
    id: "PATCH",
    raw: "silnice II/1, stavební práce, výsprava vozovky, Vydal: X",
    expect: /výsprava/i,
  },
  {
    id: "TUNNEL",
    raw: "tunel, stavební práce, pravidelná údržba tunelu, Vydal: X",
    expect: /údržba\s+tunelu/i,
  },
  {
    id: "CULTURE",
    raw: 'ulice A, uzavřeno, z důvodu konání kulturní akce "Festival", Vydal: X',
    expect: /kulturní\s+akc/i,
  },
];
for (const c of WORK_CASES) {
  const sit = buildTrafficSituationSummary({
    summaryFull: c.raw,
    summary: c.raw,
    eventType: "roadworks",
  });
  const work = extractSpecificWorkFromOfficialComment(c.raw);
  const blob = String(sit || "") + " " + String(work || "");
  ok("WORK_" + c.id + "_NOT_BARE", !/^stavební práce\.?$/i.test(String(sit || "").trim()), sit);
  ok("WORK_" + c.id + "_KEPT", c.expect.test(blob), blob.slice(0, 160));
}

// --- No hallucination ---
{
  const sit = buildTrafficSituationSummary({
    summaryFull: "ulice Testova, Město, stavební práce, Vydal: X",
    summary: "ulice Testova, Město, stavební práce, Vydal: X",
    eventType: "roadworks",
  });
  ok("BARE_NO_GAS", !/plynovod/i.test(sit || ""));
  ok("BARE_NO_CLOSURE_INVENT", !/uzavřena z důvodu/i.test(sit || ""));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-beroun-multi-street-work-reason",
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
