#!/usr/bin/env node
/**
 * I/38-class: reversed km range precision + maintenance work + affected lane + open lanes
 * + no broken decimal tokens + no raw location/time scaffolding in DOPRAVNÍ SITUACE.
 * Fixture-based general guards — no I/38 / 44.53 / 40.74 hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractSpecificWorkFromOfficialComment,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  resolveCollapsedKilometerLabel,
  formatKmToken,
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
  "silnice I/38, mezi 44.53 a 40.74 km, v termínu od 17. 08. 2026 06:30 do 17. 08. 2026 14:00, údržba stromů a keřů, rozsah: pravý jízdní pruh (3), počet průjezdných pruhů: 1";

// --- Precision ---
{
  ok("PREC_44_53", formatKmToken("44.53") === "44,53", formatKmToken("44.53"));
  ok("PREC_40_74", formatKmToken("40.74") === "40,74", formatKmToken("40.74"));
  ok("PREC_NOT_TRUNC_40", formatKmToken("40.74") !== "40,7");
  ok("PREC_NOT_TRUNC_44", formatKmToken("44.53") !== "44,5");
}

// --- Reversed ranges preserve source order ---
{
  const cases = [
    ["mezi 44.53 a 40.74 km", "44,53", "40,74"],
    ["km 60–59.5", "60", "59,5"],
    ["km 277,5–276,9", "277,5", "276,9"],
    ["mezi 36.77 a 36.84 km", "36,77", "36,84"],
  ];
  for (const [frag, from, to] of cases) {
    const facts = parseOfficialCommentFacts("silnice I/1, " + frag + ", údržba stromů");
    ok("REV_FROM_" + from, facts.kilometerFrom === from, facts.kilometerFrom);
    ok("REV_TO_" + to, facts.kilometerTo === to, facts.kilometerTo);
    ok(
      "REV_LABEL_" + from,
      facts.kilometerLabel === "km " + from + "–" + to,
      facts.kilometerLabel
    );
  }
}

// --- Comment range beats truncated structured single km ---
{
  const km = resolveCollapsedKilometerLabel({
    summaryFull: REF_RAW,
    impactFull: REF_RAW,
    road: "I/38",
    kilometer: 40.7,
  });
  ok("STRUCT_OVERRIDE_KIND", km && km.kind === "KM_RANGE", km && km.kind);
  ok("STRUCT_OVERRIDE_LABEL", km && km.label === "km 44,53–40,74", km && km.label);
  ok("STRUCT_OVERRIDE_NOT_SINGLE", !(km && km.kind === "SINGLE_KM"));
}

// --- Reference fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const sw = extractSpecificWorkFromOfficialComment(REF_RAW);
  ok("FACT_FROM", facts.kilometerFrom === "44,53", facts.kilometerFrom);
  ok("FACT_TO", facts.kilometerTo === "40,74", facts.kilometerTo);
  ok("FACT_OPEN", facts.openLaneCount === 1, String(facts.openLaneCount));
  ok("FACT_LANE", /pravý\s+jízdní\s+pruh/i.test(facts.affectedLane || ""), facts.affectedLane);
  ok("FACT_WORK", /stromů|keřů/i.test(sw || facts.specificWork || ""), sw || facts.specificWork);
  ok("CAUSE_ROADWORKS", analyzePrimaryCause(REF_RAW, { eventType: "restriction" }) === "ROADWORKS");

  const input = {
    summaryFull: REF_RAW,
    summary: REF_RAW,
    impactFull: REF_RAW,
    eventType: "restriction",
    road: "I/38",
    kilometer: 40.7,
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  const km = resolveCollapsedKilometerLabel(input);

  ok("COLLAPSED_KM_RANGE", /km\s*44,53–40,74/i.test(card.placeLine || ""), card.placeLine);
  ok("EXPANDED_KM_RANGE", rows.kilometer === "km 44,53–40,74", rows.kilometer);
  ok("KM_RESOLVER", km && km.label === "km 44,53–40,74", km && km.label);

  ok("SIT_WORK", /údržba\s+stromů\s+a\s+keřů/i.test(sit), sit);
  ok("SIT_LANE", /pravý\s+jízdní\s+pruh/i.test(sit), sit);
  ok("SIT_OPEN1", /1\s+jízdní\s+pruh/i.test(sit), sit);
  ok("SIT_NO_BROKEN_DEC", !/44\.\s*74|44,\s*74|mezi\s+44\.\s*74/i.test(sit), sit);
  ok("SIT_NO_RAW_ROAD_MEZI", !/silnice\s+I\/38\s*,\s*mezi/i.test(sit), sit);
  ok("SIT_NO_V_TERMINU", !/v\s+termínu/i.test(sit), sit);
  ok("SIT_NO_ROZSAH_COLON", !/rozsah\s*:/i.test(sit), sit);
  ok("SIT_NO_PAREN_3", !/\(3\)/.test(sit), sit);
  ok("SIT_NO_VYDAL", !/Vydal:/i.test(sit), sit);
  ok("RAW_PRESERVED", /44\.53/.test(rows.sourceDescription || "") && /40\.74/.test(rows.sourceDescription || ""));
}

// --- Broken decimal must not appear for nearby fixtures ---
{
  const raws = [
    "silnice I/1, mezi 36.77 a 36.84 km, údržba a opravy mostů, rozsah: zpevněná krajnice, počet průjezdných pruhů: 2",
    "silnice I/2, mezi 44.53 a 40.74 km, údržba stromů a keřů, rozsah: pravý jízdní pruh, počet průjezdných pruhů: 1",
  ];
  for (const raw of raws) {
    const sit = buildTrafficSituationSummary({
      summaryFull: raw,
      impactFull: raw,
      eventType: "restriction",
    });
    ok(
      "NO_BROKEN_" + raw.slice(0, 20),
      !/\d\.\s+\d/.test(sit || "") && !/mezi\s+\d+\.\s+\d+/i.test(sit || ""),
      sit
    );
  }
}

// --- Generic Alfa maintenance + lane + open lanes ---
{
  const raw =
    "silnice I/9, mezi 12.25 a 10.10 km, údržba stromů a keřů, rozsah: levý jízdní pruh (2), počet průjezdných pruhů: 1";
  const sit = buildTrafficSituationSummary({
    summaryFull: raw,
    impactFull: raw,
    eventType: "omezeni",
    road: "I/9",
    kilometer: 10.1,
  });
  const km = resolveCollapsedKilometerLabel({
    summaryFull: raw,
    impactFull: raw,
    kilometer: 10.1,
  });
  ok("GEN_KM", km && km.label === "km 12,25–10,10", km && km.label);
  ok("GEN_WORK", /stromů|keřů/i.test(sit || ""), sit);
  ok("GEN_LANE", /levý\s+jízdní\s+pruh/i.test(sit || ""), sit);
  ok("GEN_OPEN", /1\s+jízdní\s+pruh/i.test(sit || ""), sit);
  ok("GEN_NO_MEZI_RAW", !/mezi\s+12/i.test(sit || ""), sit);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-i38-km-range-situation",
      pass,
      failCount: fails.length,
      fails,
      results,
      KM_RANGE_GUARD: results.filter((r) => /KM|REV_|STRUCT_|FACT_FROM|FACT_TO/.test(r.id)).every((r) => r.pass),
      REVERSED_RANGE_GUARD: results.filter((r) => r.id.startsWith("REV_")).every((r) => r.pass),
      KM_PRECISION_GUARD: results.filter((r) => r.id.startsWith("PREC_")).every((r) => r.pass),
      BROKEN_DECIMAL_GUARD: results.filter((r) => /BROKEN|NO_BROKEN/.test(r.id)).every((r) => r.pass),
      WORK_TYPE_GUARD: results.filter((r) => /WORK|SIT_WORK|GEN_WORK/.test(r.id)).every((r) => r.pass),
      AFFECTED_LANE_GUARD: results.filter((r) => /LANE|SIT_LANE|GEN_LANE/.test(r.id)).every((r) => r.pass),
      OPEN_LANE_COUNT_GUARD: results.filter((r) => /OPEN|SIT_OPEN|GEN_OPEN|FACT_OPEN/.test(r.id)).every((r) => r.pass),
      INFORMATION_VALUE_GUARD: results
        .filter((r) => /SIT_|RAW_|NO_V_|NO_ROZSAH|NO_PAREN|NO_RAW/.test(r.id))
        .every((r) => r.pass),
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
