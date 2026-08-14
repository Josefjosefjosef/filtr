#!/usr/bin/env node
/**
 * I/34-class: tight km range precision + typed obstacle must not wipe concrete
 * maintenance / hard-shoulder / open-lane facts from official comment.
 * Fixture-based general guards — no I/34 / 121.47 hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractSpecificWorkFromOfficialComment,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  resolveCollapsedKilometerLabel,
  formatKmToken,
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

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

const REF_RAW =
  "silnice I/34, mezi 121.47 a 121.48 km, v termínu od 19. 08. 2026 14:00 do 19. 08. 2026 16:00, údržba a opravy svislých značek a větrných rukávů, rozsah: zpevněná krajnice (1), počet průjezdných pruhů: 1";

const IMPACT_TRUNC =
  "silnice I/34, mezi 121.47 a 121.48 km, v termínu od 19. 08. 2026 14:00 do 19. 08. 2026 16:00, údržba a opravy svislých značek a větrných rukávů, rozsah: zpevně…";

// --- Precision ---
{
  ok("PREC_121_47", formatKmToken("121.47") === "121,47", formatKmToken("121.47"));
  ok("PREC_121_48", formatKmToken("121.48") === "121,48", formatKmToken("121.48"));
  ok("PREC_NOT_121_5", formatKmToken("121.47") !== "121,5");
  ok("PREC_NOT_ROUND_EQUAL", formatKmToken("121.47") !== formatKmToken("121.48"));
  ok("PREC_44_53", formatKmToken("44.53") === "44,53", formatKmToken("44.53"));
  ok("PREC_40_74", formatKmToken("40.74") === "40,74", formatKmToken("40.74"));
  ok("PREC_50_24", formatKmToken("50.24") === "50,24", formatKmToken("50.24"));
  ok("PREC_36_77", formatKmToken("36.77") === "36,77", formatKmToken("36.77"));
  ok("PREC_36_84", formatKmToken("36.84") === "36,84", formatKmToken("36.84"));
}

// --- Range parsing preserves both endpoints ---
{
  const cases = [
    ["mezi 121.47 a 121.48 km", "121,47", "121,48"],
    ["mezi 44.53 a 40.74 km", "44,53", "40,74"],
    ["mezi 50.24 a 35 km", "50,24", "35"],
    ["mezi 36.77 a 36.84 km", "36,77", "36,84"],
  ];
  for (const [frag, from, to] of cases) {
    const facts = parseOfficialCommentFacts("silnice I/1, " + frag + ", údržba");
    ok("RANGE_FROM_" + from, facts.kilometerFrom === from, facts.kilometerFrom);
    ok("RANGE_TO_" + to, facts.kilometerTo === to, facts.kilometerTo);
    ok(
      "RANGE_LABEL_" + from,
      facts.kilometerLabel === "km " + from + "–" + to,
      facts.kilometerLabel
    );
    ok(
      "RANGE_NOT_SINGLE_" + from,
      !new RegExp("^km\\s+" + from.replace(",", "\\,") + "$").test(facts.kilometerLabel || "")
    );
  }
}

// --- Reference fixture facts ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const sw = extractSpecificWorkFromOfficialComment(REF_RAW);
  ok("I34_ROAD", facts.roadNumber === "I/34", facts.roadNumber);
  ok("I34_KM_FROM", facts.kilometerFrom === "121,47", facts.kilometerFrom);
  ok("I34_KM_TO", facts.kilometerTo === "121,48", facts.kilometerTo);
  ok("I34_KM_LABEL", facts.kilometerLabel === "km 121,47–121,48", facts.kilometerLabel);
  ok("I34_OPEN", facts.openLaneCount === 1, String(facts.openLaneCount));
  ok("I34_AFFECTED", facts.affectedRoadPart === "HARD_SHOULDER", facts.affectedRoadPart);
  ok(
    "I34_WORK",
    /svislých\s+značek|větrných\s+rukávů/i.test(sw || facts.specificWork || ""),
    sw || facts.specificWork
  );
  ok("I34_WORK_DETAIL", facts.roadworkDetail === "MAINTENANCE_REPAIR", facts.roadworkDetail);
}

// --- Typed obstacle must keep maintenance situation (category title may stay obstacle) ---
{
  const input = {
    road: "34",
    roadClass: "CLASS_I",
    eventType: "prekazka",
    illustrationKey: "prekazka",
    location: "34",
    impact: IMPACT_TRUNC,
    impactFull: REF_RAW,
    kilometer: 121.5,
    preciseLocationVerified: true,
  };
  const ev = classifyEventPresentation(input);
  ok("I34_TITLE_OBSTACLE", ev.kind === "obstacle", ev.kind);
  ok(
    "I34_TITLE_CS",
    /PŘEKÁŽKA\s+NA\s+VOZOVCE/i.test(ev.titleCs || ""),
    ev.titleCs
  );
  // Typed prekazka still classifies as OBSTACLE cause — situation must not be generic-only.
  ok(
    "I34_CAUSE_TYPED",
    analyzePrimaryCause(REF_RAW, { eventType: "prekazka" }) === "OBSTACLE"
  );

  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  const km = resolveCollapsedKilometerLabel(input);

  ok("I34_KM_KIND", km && km.kind === "KM_RANGE", km && km.kind);
  ok("I34_KM_LABEL_UI", km && km.label === "km 121,47–121,48", km && km.label);
  ok("I34_PLACE_RANGE", /I\/34\s*·\s*km\s*121,47–121,48/i.test(card.placeLine || ""), card.placeLine);
  ok("I34_PLACE_NOT_SINGLE", !/\bkm\s*121,5\b/.test(card.placeLine || ""), card.placeLine);
  ok("I34_EXPANDED_KM", rows.kilometer === "km 121,47–121,48", rows.kilometer);
  ok("I34_EXPANDED_NOT_SINGLE", rows.kilometer !== "km 121,5", rows.kilometer);

  ok("I34_SIT_WORK", /svisl|značek|větrn|rukáv/i.test(sit), sit);
  ok("I34_SIT_SHOULDER", /zpevněn/i.test(sit), sit);
  ok("I34_SIT_LANES", /1\s+jízdní\s+pruh/i.test(sit), sit);
  ok(
    "I34_SIT_NOT_GENERIC_ONLY",
    !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()) &&
      !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()),
    sit
  );
  ok("I34_NO_INVENTED_LANE_CLOSE", !/uzavřen\s+(?:pravý|levý)\s+jízdní/i.test(sit), sit);
  ok("I34_NO_INVENTED_FULL_CLOSE", !/úpln[áa]\s+uzavírk/i.test(sit), sit);
  ok("I34_NO_INVENTED_SHUTTLE", !/kyvadlov/i.test(sit), sit);
  ok(
    "I34_RAW_PRESERVED",
    /mezi\s+121\.47\s+a\s+121\.48\s+km/i.test(rows.sourceDescription || "")
  );
}

// --- Structured midpoint must lose to comment range ---
{
  const km = resolveCollapsedKilometerLabel({
    impactFull: REF_RAW,
    road: "I/34",
    kilometer: 121.5,
  });
  ok("STRUCT_OVERRIDE_KIND", km && km.kind === "KM_RANGE", km && km.kind);
  ok("STRUCT_OVERRIDE_LABEL", km && km.label === "km 121,47–121,48", km && km.label);
  ok("STRUCT_NOT_121_5", !(km && /\b121,5\b/.test(km.label || "")));
}

// --- Cross-case spot checks ---
{
  const spots = [
    {
      id: "I38A",
      road: "I/38",
      raw: "silnice I/38, mezi 44.53 a 40.74 km, údržba stromů a keřů, rozsah: pravý jízdní pruh (3), počet průjezdných pruhů: 1",
      wantKm: "44,53–40,74",
      eventType: "prace",
    },
    {
      id: "I38B",
      road: "I/38",
      raw: "silnice I/38, mezi 50.24 a 35 km, údržba a opravy svislých značek a větrných rukávů, rozsah: pravý jízdní pruh (3), počet průjezdných pruhů: 1",
      wantKm: "50,24–35",
      eventType: "prekazka",
    },
    {
      id: "I50",
      road: "I/50",
      raw: "silnice I/50, mezi 36.77 a 36.84 km, údržba a opravy mostů, rozsah: zpevněná krajnice (1), počet průjezdných pruhů: 2",
      wantKm: "36,77–36,84",
      eventType: "prace",
    },
    {
      id: "I15",
      road: "I/15",
      raw: "silnice I/15, km 12, práce na silnici",
      wantKm: "12",
      eventType: "prace",
      single: true,
    },
    {
      id: "D1",
      road: "D1",
      raw: "D1, km 42, směr Brno, nehoda",
      wantKm: "42",
      eventType: "nehoda",
      single: true,
    },
    {
      id: "D3",
      road: "D3",
      raw: "D3, km 10, práce na silnici",
      wantKm: "10",
      eventType: "prace",
      single: true,
    },
    {
      id: "D4",
      road: "D4",
      raw: "D4, km 3, práce na silnici",
      wantKm: "3",
      eventType: "prace",
      single: true,
    },
    {
      id: "D48",
      road: "D48",
      raw: "D48, km 1, práce na silnici",
      wantKm: "1",
      eventType: "prace",
      single: true,
    },
    {
      id: "II387",
      road: "II/387",
      raw: "silnice II/387, km 3, práce na silnici",
      wantKm: "3",
      eventType: "prace",
      single: true,
    },
  ];
  for (const c of spots) {
    const card = buildTrafficCardPresentation({
      impact: c.raw,
      impactFull: c.raw,
      eventType: c.eventType,
      road: c.road,
    });
    const re = new RegExp("km\\s*" + c.wantKm.replace(/[–,]/g, (ch) => "\\" + ch), "i");
    ok("CROSS_KM_" + c.id, re.test(card.placeLine || ""), card.placeLine);
    if (c.single) {
      ok("CROSS_SINGLE_" + c.id, !/–/.test(card.placeLine || ""), card.placeLine);
    } else {
      ok("CROSS_RANGE_" + c.id, /–/.test(card.placeLine || ""), card.placeLine);
    }
    if (c.eventType === "prekazka" && /rukáv|značek/i.test(c.raw)) {
      const sit = String(card.situationSummary || "");
      ok("CROSS_OBS_WORK_" + c.id, /svisl|značek|větrn|rukáv/i.test(sit), sit);
      ok(
        "CROSS_OBS_NOT_GENERIC_" + c.id,
        !/^Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()),
        sit
      );
    }
  }
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  I34_FIXTURE: results.filter((r) => r.id.startsWith("I34_")).every((r) => r.pass),
  KM_RANGE_GUARD: results
    .filter((r) => r.id.startsWith("RANGE_") || r.id.includes("KM_") || r.id.startsWith("STRUCT_"))
    .every((r) => r.pass),
  KM_PRECISION_GUARD: results.filter((r) => r.id.startsWith("PREC_")).every((r) => r.pass),
  WORK_TYPE_GUARD: results
    .filter((r) => r.id.includes("WORK") || r.id.includes("SIT_WORK"))
    .every((r) => r.pass),
  AFFECTED_PART_GUARD: results
    .filter((r) => r.id.includes("AFFECTED") || r.id.includes("SHOULDER"))
    .every((r) => r.pass),
  OPEN_LANE_COUNT_GUARD: results
    .filter((r) => r.id.includes("OPEN") || r.id.includes("LANES"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results
    .filter((r) => r.id.includes("GENERIC") || r.id.includes("NOT_GENERIC"))
    .every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_I34_KM_RANGE_SIGNS_WINDSOCKS_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_I34_KM_RANGE_SIGNS_WINDSOCKS_GUARD_PASS");
