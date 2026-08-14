#!/usr/bin/env node
/**
 * Obstruction subtype guard: stationary vehicle after accident + micro-location.
 * Fixture-based general rules — no municipality / street hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  formatObstructionSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
  analyzePrimaryCause,
  normalizeDirectionHuman,
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
  "ulice Jandova v obci Praha okres území Hlavního města Prahy, směr prosecká estakáda, omezení, Pozor! Překážka na vozovce, od 13.8.2026 10:20 do 13.8.2026 17:25, stojící vozidlo po havárii před železničním viaduktem u náměstí OSN, Zdroj: TSK Praha / DIC";

// --- Reference fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    municipality: "Praha",
    street: "Jandova",
    district: "území Hlavního města Prahy",
    direction: "prosecká estakáda",
  };
  const ev = classifyEventPresentation(input);
  const cause = analyzePrimaryCause(REF_RAW, input);
  const lead = formatObstructionSituationLead(facts, REF_RAW);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("EVENT_OBSTRUCTION", ev.kind === "obstacle" && cause === "OBSTACLE", ev.kind + "/" + cause);
  ok("TITLE_OBSTACLE", /PŘEKÁŽKA\s+NA\s+VOZOVCE/i.test(ev.titleCs || ""), ev.titleCs);
  ok("STREET", /Jandova/i.test(facts.street || card.placeLine || ""), facts.street);
  ok("MUNI", /Praha/i.test(facts.city || card.placeLine || ""), facts.city);
  ok(
    "DISTRICT",
    /Hlavního\s+města\s+Prahy/i.test(facts.district || card.placeLine || ""),
    facts.district
  );
  ok(
    "DIRECTION",
    /prosecká\s+estakáda/i.test(facts.directionHuman || "") ||
      /prosecká\s+estakáda/i.test(card.placeLine || ""),
    facts.directionHuman || card.placeLine
  );
  ok("STATIONARY_VEHICLE", facts.obstructionType === "STATIONARY_VEHICLE", facts.obstructionType);
  ok(
    "AFTER_ACCIDENT",
    facts.obstructionContext === "AFTER_ACCIDENT",
    facts.obstructionContext
  );
  ok(
    "LOCATION_DETAIL_PRESENT",
    /železničním\s+viaduktem/i.test(facts.locationDetail || "") &&
      /náměstí\s+OSN/i.test(facts.locationDetail || ""),
    facts.locationDetail
  );
  ok(
    "LOCATION_NOT_STREET",
    !/viadukt|náměstí\s+OSN/i.test(facts.street || ""),
    facts.street
  );
  ok(
    "LOCATION_NOT_DIRECTION",
    !/viadukt|náměstí\s+OSN/i.test(facts.directionHuman || ""),
    facts.directionHuman
  );
  ok("LEAD_SPECIFIC", /stojící\s+vozidlo\s+po\s+havárii/i.test(lead || ""), lead);
  ok("SIT_NOT_GENERIC", !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
  ok("SIT_STATIONARY", /stojící\s+vozidlo/i.test(sit), sit);
  ok("SIT_AFTER_ACCIDENT", /po\s+havárii/i.test(sit), sit);
  ok("SIT_LOCATION", /železničním\s+viaduktem/i.test(sit) && /náměstí\s+OSN/i.test(sit), sit);
  ok("NO_INJURY", !/zraněn/i.test(sit), sit);
  ok(
    "NO_FULL_CLOSE",
    !/neprůjezdn|zcela\s+uzavřen|provoz\s+zastaven|úpln[áa]\s+uzavírk/i.test(sit),
    sit
  );
  ok("NO_FALSE_ACCIDENT_KIND", ev.kind !== "accident", ev.kind);
  ok(
    "RAW_PRESERVED",
    /stojící vozidlo po havárii před železničním viaduktem/i.test(rows.sourceDescription || "")
  );
  ok(
    "PLACE_HAS_DIR",
    /směr\s+prosecká\s+estakáda/i.test(card.placeLine || ""),
    card.placeLine
  );
}

// --- Lowercase landmark direction normalization ---
{
  ok(
    "DIR_LOWERCASE_LANDMARK",
    normalizeDirectionHuman("prosecká estakáda") === "prosecká estakáda"
  );
  ok("DIR_STILL_REJECTS_PROSE", normalizeDirectionHuman("prováděny stavební práce") == null);
}

// --- Information-value: specific obstruction facts must beat bare category ---
{
  const cases = [
    {
      id: "STATIONARY",
      raw: "Překážka na vozovce, stojící vozidlo po havárii před mostem.",
      need: /stojící\s+vozidlo/i,
    },
    {
      id: "TREE",
      raw: "Překážka na vozovce, spadlý strom.",
      need: /spadlý\s+strom/i,
    },
    {
      id: "CARGO",
      raw: "Překážka na vozovce, spadlý náklad.",
      need: /spadlý\s+náklad/i,
    },
    {
      id: "ANIMAL",
      raw: "Překážka na vozovce, zvěř na vozovce.",
      need: /zvěř\s+na\s+vozovce/i,
    },
    {
      id: "BROKEN",
      raw: "Překážka na vozovce, porouchané vozidlo.",
      need: /porouchané\s+vozidlo/i,
    },
  ];
  for (const c of cases) {
    const sit = String(
      buildTrafficSituationSummary({
        impact: c.raw,
        impactFull: c.raw,
        eventType: "prekazka",
      }) || ""
    );
    ok("INFO_NOT_BARE_" + c.id, !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()), sit);
    ok("INFO_HAS_" + c.id, c.need.test(sit), sit);
    if (c.id === "BROKEN") {
      // Broken vehicle is a dedicated primary cause under the obstacle event kind family.
      ok(
        "INFO_STILL_OBSTACLE_" + c.id,
        analyzePrimaryCause(c.raw, { eventType: "prekazka" }) === "BROKEN_VEHICLE" ||
          classifyEventPresentation({ impact: c.raw, impactFull: c.raw, eventType: "prekazka" })
            .kind === "obstacle"
      );
    } else {
      ok(
        "INFO_STILL_OBSTACLE_" + c.id,
        analyzePrimaryCause(c.raw, { eventType: "prekazka" }) === "OBSTACLE"
      );
    }
  }
}

// --- Soft after-accident context must not reclassify to ACCIDENT ---
{
  const cause = analyzePrimaryCause(
    "Překážka na vozovce, stojící vozidlo po havárii.",
    { eventType: "prekazka" }
  );
  ok("SOFT_AFTER_ACCIDENT_STAYS_OBSTACLE", cause === "OBSTACLE", cause);
  const real = analyzePrimaryCause("nehoda, 2 havarovaná vozidla", { eventType: "nehoda" });
  ok("REAL_ACCIDENT_STILL_ACCIDENT", real === "ACCIDENT", real);
}

// --- Cross: Brno accident participants must stay rich ---
{
  const REF =
    "Od 13.8.2026 13:05 do 16:10; v ulici Opuštěná v obci Brno; nehoda nákladního vozidla; překážka, která může bránit provozu v celé šířce vozovky nebo její části; nákladní automobil x osobní automobil.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: REF,
      impactFull: REF,
      eventType: "nehoda",
      road: "42",
      municipality: "Brno",
      street: "Opuštěná",
    }) || ""
  );
  ok("BRNO_NOT_BARE", !/^Nehoda\.?$/i.test(sit.trim()), sit);
  ok("BRNO_TYPES", /nákladní/i.test(sit) && /osobní/i.test(sit), sit);
  ok("BRNO_MAY_BLOCK", /může\s+bránit/i.test(sit), sit);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  JANDOVA_FIXTURE: results
    .filter((r) =>
      [
        "EVENT_OBSTRUCTION",
        "STATIONARY_VEHICLE",
        "AFTER_ACCIDENT",
        "LOCATION_DETAIL_PRESENT",
        "SIT_NOT_GENERIC",
        "SIT_STATIONARY",
        "SIT_AFTER_ACCIDENT",
        "SIT_LOCATION",
      ].includes(r.id)
    )
    .every((r) => r.pass),
  GENERIC_OBSTRUCTION_GUARD: results
    .filter((r) => r.id.includes("NOT_GENERIC") || r.id.includes("NOT_BARE"))
    .every((r) => r.pass),
  STATIONARY_VEHICLE_GUARD: results
    .filter((r) => r.id.includes("STATIONARY"))
    .every((r) => r.pass),
  AFTER_ACCIDENT_CONTEXT_GUARD: results
    .filter((r) => r.id.includes("AFTER_ACCIDENT") || r.id.includes("SOFT_AFTER"))
    .every((r) => r.pass),
  LOCATION_DETAIL_GUARD: results
    .filter((r) => r.id.includes("LOCATION"))
    .every((r) => r.pass),
  EVENT_CLASSIFICATION_GUARD: results
    .filter((r) => r.id.includes("OBSTRUCTION") || r.id.includes("ACCIDENT") || r.id.includes("STILL_OBSTACLE"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("INFO_")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_OBSTRUCTION_STATIONARY_VEHICLE_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_OBSTRUCTION_STATIONARY_VEHICLE_GUARD_PASS");
