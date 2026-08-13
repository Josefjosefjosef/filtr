#!/usr/bin/env node
/**
 * KM-range precision + roadwork detail preservation guard (I/50-style fixtures).
 * Global rules — no hardcode-only pass for a single road/km.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  resolveCollapsedKilometerLabel,
  resolvePresentationRoadNumber,
  formatKmToken,
  preferClassedRoadNumber,
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
  "silnice I/50, mezi 36.77 a 36.84 km, v termínu od 13. 08. 2026 10:00 do 13. 08. 2026 12:00, údržba a opravy mostů, rozsah: zpevněná krajnice (1), počet průjezdných pruhů: 2";

// --- Precision of formatKmToken ---
{
  ok("PREC_36_77", formatKmToken("36.77") === "36,77", formatKmToken("36.77"));
  ok("PREC_36_84", formatKmToken("36.84") === "36,84", formatKmToken("36.84"));
  ok("PREC_NOT_ROUND_BOTH", formatKmToken("36.77") !== formatKmToken("36.84"));
  ok("PREC_98_3", formatKmToken("98.3") === "98,3", formatKmToken("98.3"));
  ok("PREC_INT", formatKmToken("99") === "99", formatKmToken("99"));
  ok("PREC_277_5", formatKmToken("277.5") === "277,5", formatKmToken("277.5"));
  ok("PREC_25_1", formatKmToken("25.1") === "25,1", formatKmToken("25.1"));
}

// --- Range parsing from comment forms ---
{
  const cases = [
    ["mezi 36.77 a 36.84 km", "36,77", "36,84"],
    ["mezi km 98.3 a 99", "98,3", "99"],
    ["km 60–59.5", "60", "59,5"],
    ["km 25–25.1", "25", "25,1"],
    ["km 277,5–276,9", "277,5", "276,9"],
    ["km 98,3–99", "98,3", "99"],
  ];
  for (const [frag, from, to] of cases) {
    const facts = parseOfficialCommentFacts("silnice I/50, " + frag + ", práce na silnici");
    ok("RANGE_FROM_" + from, facts.kilometerFrom === from, facts.kilometerFrom);
    ok("RANGE_TO_" + to, facts.kilometerTo === to, facts.kilometerTo);
    ok(
      "RANGE_LABEL_" + from,
      facts.kilometerLabel === "km " + from + "–" + to,
      facts.kilometerLabel
    );
  }
}

// --- I/50 reference acceptance ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("I50_ROAD_FACT", facts.roadNumber === "I/50", facts.roadNumber);
  ok("I50_KM_FROM", facts.kilometerFrom === "36,77", facts.kilometerFrom);
  ok("I50_KM_TO", facts.kilometerTo === "36,84", facts.kilometerTo);
  ok("I50_OPEN_LANES", facts.openLaneCount === 2, String(facts.openLaneCount));
  ok("I50_AFFECTED", facts.affectedRoadPart === "HARD_SHOULDER", facts.affectedRoadPart);
  ok("I50_WORK", facts.roadworkDetail === "BRIDGE_MAINTENANCE", facts.roadworkDetail);

  const card = buildTrafficCardPresentation({
    impact: REF_RAW,
    impactFull: REF_RAW,
    road: "50",
    eventType: "prace",
  });
  const rows = rowMap(card);
  const sum = String(card.situationSummary || "");
  const km = resolveCollapsedKilometerLabel({ impact: REF_RAW, impactFull: REF_RAW });

  ok("I50_ROAD_SHOWN", resolvePresentationRoadNumber({ road: "50", impact: REF_RAW }) === "I/50");
  ok("I50_ROAD_CLASS", preferClassedRoadNumber("50", "I/50") === "I/50");
  ok("I50_ROW_ROAD", rows.road === "I/50", rows.road);
  ok("I50_ROW_CLASS", /I\.\s*třídy/i.test(rows.roadClass || ""), rows.roadClass);
  ok("I50_ROW_KM", rows.kilometer === "km 36,77–36,84", rows.kilometer);
  ok("I50_PLACE", /I\/50\s*·\s*km\s*36,77–36,84/i.test(card.placeLine || ""), card.placeLine);
  ok("I50_KM_KIND", km && km.kind === "KM_RANGE", km && km.kind);
  ok("I50_NOT_SINGLE_POINT", !/\bkm\s*36,8\b(?!\s*[–-])/.test(card.placeLine || ""));
  ok("I50_NOT_ROUNDED_RANGE", !/36,8–36,8/.test(card.placeLine || ""));

  ok("I50_SUM_BRIDGE", /údržba\s+a\s+opravy\s+mostů/i.test(sum), sum);
  ok("I50_SUM_SHOULDER", /zpevněn/i.test(sum), sum);
  ok("I50_SUM_LANES", /2\s+jízdní\s+pruh/i.test(sum), sum);
  ok("I50_NOT_GENERIC_ONLY", !/^Práce\s+na\s+silnici\.?$/i.test(sum.trim()), sum);
  ok("I50_RAW_PRESERVED", /mezi\s+36\.77\s+a\s+36\.84\s+km/i.test(rows.sourceDescription || ""));
  ok("I50_NO_VYDAL_IN_SUM", !/Vydal:/i.test(sum));
}

// --- Structured kmFrom/kmTo precision ---
{
  const card = buildTrafficCardPresentation({
    impact: "silnice I/50, údržba a opravy mostů",
    impactFull: "silnice I/50, údržba a opravy mostů",
    road: "I/50",
    eventType: "prace",
    kilometerFrom: 36.77,
    kilometerTo: 36.84,
  });
  ok(
    "STRUCT_KM_RANGE",
    /km\s*36,77–36,84/i.test(card.placeLine || ""),
    card.placeLine
  );
  const rows = rowMap(card);
  ok("STRUCT_EXPANDED_KM", rows.kilometer === "km 36,77–36,84", rows.kilometer);
}

// --- Cross-road regression spot ---
{
  const roads = [
    { road: "D1", impact: "D1, km 12, směr Brno, práce na silnici", want: /^D1$/ },
    { road: "D4", impact: "D4, km 3, práce na silnici", want: /^D4$/ },
    { road: "D48", impact: "D48, km 1, práce na silnici", want: /^D48$/ },
    { road: "50", impact: "silnice I/50, mezi 36.77 a 36.84 km, práce na silnici", want: /^I\/50$/ },
    { road: "171", impact: "silnice II/171, km 3, práce na silnici", want: /^II\/171$/ },
    { road: "387", impact: "silnice II/387, km 3, práce na silnici", want: /^II\/387$/ },
  ];
  for (const c of roads) {
    const shown = resolvePresentationRoadNumber({ road: c.road, impact: c.impact, impactFull: c.impact });
    ok("CROSS_ROAD_" + c.road, c.want.test(String(shown || "")), shown);
  }
  const single = buildTrafficCardPresentation({
    impact: "D1, km 42, směr Brno, nehoda",
    impactFull: "D1, km 42, směr Brno, nehoda",
    road: "D1",
    eventType: "nehoda",
  });
  ok("SINGLE_KM_OK", /km\s*42\b/.test(single.placeLine || "") && !/–/.test(single.placeLine || ""), single.placeLine);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  KM_RANGE_GUARD: results.filter((r) => r.id.startsWith("RANGE_") || r.id.startsWith("I50_KM") || r.id.startsWith("STRUCT_")).every((r) => r.pass),
  KM_PRECISION_GUARD: results.filter((r) => r.id.startsWith("PREC_") || r.id.includes("ROUNDED") || r.id.includes("SINGLE_POINT")).every((r) => r.pass),
  ROAD_CLASS_GUARD: results.filter((r) => r.id.includes("ROAD") || r.id.startsWith("CROSS_")).every((r) => r.pass),
  ROADWORK_DETAIL_GUARD: results.filter((r) => r.id.includes("SUM_BRIDGE") || r.id.includes("WORK") || r.id.includes("GENERIC")).every((r) => r.pass),
  AFFECTED_PART_GUARD: results.filter((r) => r.id.includes("AFFECTED") || r.id.includes("SHOULDER")).every((r) => r.pass),
  OPEN_LANE_COUNT_GUARD: results.filter((r) => r.id.includes("OPEN_LANES") || r.id.includes("SUM_LANES")).every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("I50_SUM") || r.id.includes("GENERIC")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_KM_RANGE_ROADWORK_DETAIL_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_KM_RANGE_ROADWORK_DETAIL_GUARD_PASS");
