#!/usr/bin/env node
/**
 * Primary street vs referenced / secondary / diversion street guard.
 * Covers Třebíč body-catalog contamination + Třemošná/Kamenitá regressions.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  extractStreetRangeFromOfficialComment,
  clipOfficialCommentLocationScanText,
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
  return Object.fromEntries(
    ((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value])
  );
}

const BODY_CATALOG =
  "Třebíč ul. Znojemská, Riegrova, Hálkova, Nerudova, Sedlákova, Hrotovická, Kosmákova, Okrajová";

const A_RAW =
  "ulice Hrotovická, část obce Hrotovická - ulice Okrajová, část obce Domky, Třebíč, okr. Třebíč, Od 01.09.2026 07:00, Do 30.09.2026 18:00, úplná uzavírka, " +
  BODY_CATALOG +
  ", stavební práce";

const B_RAW =
  "ulice Vaňkovo nám. - ulice Riegrova, Třebíč, část obce Domky, okr. Třebíč, přes: ulice Riegrova, Od 01.09.2026 07:00, Do 30.09.2026 18:00, " +
  BODY_CATALOG;

const C_RAW =
  "ulice Sedlákova, mezi křižovatkami ulic Riegrova a Březinova, Třebíč, část obce Domky, okr. Třebíč, Od 01.09.2026 07:00, Do 30.09.2026 18:00, " +
  BODY_CATALOG;

const TRE_RAW = "ulice K Platince - ulice Luční, Třemošná, okr. Plzeň-sever";

const KAM_RAW =
  "ulice Kamenitá, mezi křižovatkami ulic Na Vršku a Dvorská, Plzeň 6-Litice, okr. Plzeň-město, uzavřeno, stavební práce";

const PREVIOUSLY_CORRECT = [];

function expectStillCorrect(id, cond, detail) {
  ok(id, cond, detail);
  if (!cond) PREVIOUSLY_CORRECT.push(id);
}

// A) Hrotovická – Okrajová range; body catalog must not inject Znojemská
{
  const clip = clipOfficialCommentLocationScanText(A_RAW);
  const range = extractStreetRangeFromOfficialComment(clip);
  const facts = parseOfficialCommentFacts(A_RAW);
  const card = buildTrafficCardPresentation({
    impact: A_RAW,
    impactFull: A_RAW,
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("A_RANGE_FROM_CLIP", range && range.streetFrom === "Hrotovická" && range.streetTo === "Okrajová", JSON.stringify(range));
  ok("A_FACTS_RANGE", facts.streetRange === true, String(facts.streetRange));
  ok("A_FROM", facts.streetFrom === "Hrotovická", facts.streetFrom);
  ok("A_TO", facts.streetTo === "Okrajová", facts.streetTo);
  ok(
    "A_STREET_PAIR",
    /Hrotovická/.test(facts.street || "") && /Okrajová/.test(facts.street || ""),
    facts.street
  );
  ok("A_NO_ZNOJEMSKA", !/Znojemská/i.test(facts.street || "") && !(facts.streets || []).some((s) => /Znojemská/i.test(s)), JSON.stringify(facts.streets));
  ok("A_ROW_NO_ZNOJEMSKA", !/Znojemská/i.test(rows.street || ""), rows.street);
  ok("A_PLACE_NO_ZNOJEMSKA", !/Znojemská/i.test(card.placeLine || ""), card.placeLine);
  ok("A_SOURCE_STILL_HAS_CATALOG", /Znojemská/.test(A_RAW));
}

// B) Vaňkovo nám. – Riegrova; keep nám. form; no Znojemská
{
  const facts = parseOfficialCommentFacts(B_RAW);
  const card = buildTrafficCardPresentation({
    impact: B_RAW,
    impactFull: B_RAW,
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("B_RANGE", facts.streetRange === true, String(facts.streetRange));
  ok("B_FROM_NAM", /Vaňkovo\s+nám\.?/i.test(facts.streetFrom || ""), facts.streetFrom);
  ok("B_TO", facts.streetTo === "Riegrova", facts.streetTo);
  ok(
    "B_STREET_PAIR",
    /Vaňkovo\s+nám\.?/i.test(facts.street || "") && /Riegrova/.test(facts.street || ""),
    facts.street
  );
  ok("B_NO_ZNOJEMSKA", !/Znojemská/i.test(facts.street || "") && !(facts.streets || []).some((s) => /Znojemská/i.test(s)), JSON.stringify(facts.streets));
  ok("B_ROW_NO_ZNOJEMSKA", !/Znojemská/i.test(rows.street || ""), rows.street);
  ok("B_KEEP_NAM_ABBREV", /nám\.?/i.test(facts.streetFrom || ""), facts.streetFrom);
}

// C) Sedlákova primary; referenced Riegrova/Březinova stay locality only
{
  const facts = parseOfficialCommentFacts(C_RAW);
  const card = buildTrafficCardPresentation({
    impact: C_RAW,
    impactFull: C_RAW,
    eventType: "prace",
  });
  const rows = rowMap(card);
  ok("C_PRIMARY", facts.street === "Sedlákova", facts.street);
  ok("C_NO_RANGE", facts.streetRange !== true, String(facts.streetRange));
  ok(
    "C_SEGMENT",
    facts.segmentBetweenIntersections &&
      facts.segmentBetweenIntersections.fromCrossStreet === "Riegrova" &&
      facts.segmentBetweenIntersections.toCrossStreet === "Březinova",
    JSON.stringify(facts.segmentBetweenIntersections)
  );
  ok(
    "C_LOCALITY",
    /mezi křižovatkami ulic Riegrova a Březinova/i.test(facts.localityDetail || ""),
    facts.localityDetail
  );
  ok("C_NO_ZNOJEMSKA", !/Znojemská/i.test(facts.street || "") && !(facts.streets || []).some((s) => /Znojemská/i.test(s)), JSON.stringify(facts.streets));
  ok("C_ROW_STREET", rows.street === "Sedlákova", rows.street);
  ok(
    "C_ROW_LOC",
    /mezi křižovatkami ulic Riegrova a Březinova/i.test(rows.location || ""),
    rows.location
  );
  ok(
    "C_REF_NOT_PRIMARY",
    rows.street !== "Riegrova" && rows.street !== "Březinova",
    rows.street
  );
}

// Regression: Třemošná street-range
{
  const facts = parseOfficialCommentFacts(TRE_RAW);
  expectStillCorrect("TRE_RANGE", facts.streetRange === true, String(facts.streetRange));
  expectStillCorrect("TRE_FROM", /K\s+Platince/i.test(facts.streetFrom || ""), facts.streetFrom);
  expectStillCorrect("TRE_TO", /Luční/i.test(facts.streetTo || ""), facts.streetTo);
  expectStillCorrect(
    "TRE_NO_MUNI_AS_STREET",
    !/Třemošná/i.test(facts.street || "") && !(facts.streets || []).some((s) => /Třemošná/i.test(s)),
    JSON.stringify(facts.streets)
  );
  expectStillCorrect("TRE_CITY", facts.city === "Třemošná", facts.city);
}

// Regression: Kamenitá referenced streets
{
  const facts = parseOfficialCommentFacts(KAM_RAW);
  const card = buildTrafficCardPresentation({
    impact: KAM_RAW,
    impactFull: KAM_RAW,
    eventType: "prace",
  });
  const rows = rowMap(card);
  expectStillCorrect(
    "KAM_PRIMARY",
    facts.street === "Kamenitá",
    facts.street
  );
  expectStillCorrect(
    "KAM_SEGMENT",
    facts.segmentBetweenIntersections &&
      facts.segmentBetweenIntersections.fromCrossStreet === "Na Vršku" &&
      facts.segmentBetweenIntersections.toCrossStreet === "Dvorská",
    JSON.stringify(facts.segmentBetweenIntersections)
  );
  expectStillCorrect("KAM_ROW", rows.street === "Kamenitá", rows.street);
  expectStillCorrect(
    "KAM_NO_CROSS_PRIMARY",
    rows.street !== "Na Vršku" && rows.street !== "Dvorská" && !/Na\s+Vršku\s*[\/–-]/.test(rows.street || ""),
    rows.street
  );
}

const pass = fails.length === 0;
const previouslyBroken = PREVIOUSLY_CORRECT.length;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-primary-vs-referenced-street-guard",
      pass,
      failCount: fails.length,
      fails,
      PREVIOUSLY_CORRECT_CASES_BROKEN: previouslyBroken,
      results,
    },
    null,
    2
  )
);
if (!pass || previouslyBroken !== 0) {
  console.log("IU_TRAFFIC_PRIMARY_VS_REFERENCED_STREET_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_PRIMARY_VS_REFERENCED_STREET_PASS");
console.log("PREVIOUSLY_CORRECT_CASES_BROKEN=0");
