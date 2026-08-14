#!/usr/bin/env node
/**
 * D4-class maintenance + km RANGE guard (general rules, no road/dir hardcode pass path).
 * - Comment/structured km range must not collapse to a single endpoint.
 * - "práce údržby" beats generic "Práce na silnici".
 * - "do N min" is stored, never rendered as delay/waiting/closure.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  resolveCollapsedKilometerLabel,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyRoadPresentation,
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

function normKm(t) {
  return String(t || "").trim().replace(",", ".");
}

const REF_RAW =
  "D4 ve směru Písek, 46,3 - 47,7 km, práce údržby, Od 12.08.2026 18:33 Do 13.08.2026 14:58, Práce údržby do 20 min";

// --- Reference fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prace",
    road: "D4",
    roadClass: "MOTORWAY",
    direction: "Písek",
    kilometer: 47.7,
    validFrom: "2026-08-12T16:33:00.000Z",
    validTo: "2026-08-13T12:58:00.000Z",
  };
  const roadPres = classifyRoadPresentation(input.road, { roadClass: input.roadClass });
  const km = resolveCollapsedKilometerLabel(input, facts);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("ROAD_D4", roadPres.road === "D4" || /D4/i.test(card.placeLine || ""), roadPres.road);
  ok("ROAD_CLASS_MOTORWAY", roadPres.roadClass === "MOTORWAY", roadPres.roadClass);
  ok("DIRECTION", /směr\s+Písek/i.test(card.placeLine || ""), card.placeLine);
  ok("KM_FROM", normKm(facts.kilometerFrom) === "46.3", facts.kilometerFrom);
  ok("KM_TO", normKm(facts.kilometerTo) === "47.7", facts.kilometerTo);
  ok("KM_RANGE_PRESENT", km && km.kind === "KM_RANGE", km && km.kind);
  ok("KM_SOURCE_COMMENT_OR_STRUCT", km && (km.source === "comment" || km.source === "structured_range"), km && km.source);
  ok(
    "COLLAPSED_FROM",
    /km\s+46,3\s*[–-]\s*47,7/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok(
    "COLLAPSED_TO",
    /km\s+46,3\s*[–-]\s*47,7/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok(
    "DETAIL_KM_RANGE",
    /km\s+46,3\s*[–-]\s*47,7/i.test(rows.kilometer || ""),
    rows.kilometer
  );
  ok("NOT_SINGLE_ENDPOINT", !/\bkm\s+47,7\b(?!\s*[–-])/i.test(card.placeLine || "") || /46,3/.test(card.placeLine || ""), card.placeLine);
  ok("WORK_MAINTENANCE", facts.roadworkDetail === "MAINTENANCE", facts.roadworkDetail);
  ok("SIT_NOT_GENERIC", !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()), sit);
  ok("SIT_MAINTENANCE", /^Práce\s+údržby\.?$/i.test(sit.trim()) || /Práce\s+údržby/i.test(sit), sit);
  ok("DUR_HINT_STORED", facts.workDurationHintMinutes === 20, String(facts.workDurationHintMinutes));
  ok(
    "NO_TWENTY_MIN_INFER",
    !/zdržen|čekán|delay|uzavírk.{0,12}20|20\s*min/i.test(sit),
    sit
  );
  ok("RAW_PRESERVED", /46,3\s*-\s*47,7\s*km/i.test(rows.sourceDescription || "") && /do\s+20\s*min/i.test(rows.sourceDescription || ""));
  ok("DECIMAL_COMMA", /46,3/.test(card.placeLine || "") && /47,7/.test(card.placeLine || ""), card.placeLine);
}

// --- Unicode minus range ---
{
  const t = "silnice I/1, 12,5 − 13,2 km, práce údržby";
  const facts = parseOfficialCommentFacts(t);
  ok("UNICODE_MINUS_FROM", normKm(facts.kilometerFrom) === "12.5", facts.kilometerFrom);
  ok("UNICODE_MINUS_TO", normKm(facts.kilometerTo) === "13.2", facts.kilometerTo);
}

// --- Structured range without comment ---
{
  const sit = String(
    buildTrafficSituationSummary({
      eventType: "prace",
      road: "D5",
      roadClass: "MOTORWAY",
      direction: "Rozvadov",
      kilometerFrom: 10.1,
      kilometerTo: 12.4,
      impact: "práce údržby",
      impactFull: "práce údržby",
    }) || ""
  );
  const card = buildTrafficCardPresentation({
    eventType: "prace",
    road: "D5",
    roadClass: "MOTORWAY",
    direction: "Rozvadov",
    kilometerFrom: 10.1,
    kilometerTo: 12.4,
    impact: "práce údržby",
    impactFull: "práce údržby",
  });
  ok("STRUCT_RANGE_PLACE", /km\s+10,1\s*[–-]\s*12,4/i.test(card.placeLine || ""), card.placeLine);
  ok("STRUCT_MAINT_SIT", /Práce\s+údržby/i.test(sit), sit);
}

// --- Point guard: must not fabricate X–X ---
{
  const card = buildTrafficCardPresentation({
    eventType: "prace",
    road: "I/34",
    roadClass: "CLASS_I",
    kilometer: 121.5,
    impact: "práce na silnici",
    impactFull: "práce na silnici",
  });
  ok("POINT_I34", /km\s+121,5/i.test(card.placeLine || ""), card.placeLine);
  ok("POINT_NOT_FAKE_RANGE", !/121,5\s*[–-]\s*121,5/i.test(card.placeLine || ""), card.placeLine);

  const same = buildTrafficCardPresentation({
    eventType: "prace",
    road: "D1",
    roadClass: "MOTORWAY",
    kilometerFrom: 50,
    kilometerTo: 50,
    impact: "práce na silnici",
    impactFull: "práce na silnici",
  });
  const kmSame = resolveCollapsedKilometerLabel({
    kilometerFrom: 50,
    kilometerTo: 50,
    impact: "práce na silnici",
  });
  ok("EQUAL_ENDS_NOT_RANGE", !kmSame || kmSame.kind !== "KM_RANGE", kmSame && kmSame.kind);
  ok("EQUAL_ENDS_PLACE_POINT", !/50\s*[–-]\s*50/i.test(same.placeLine || ""), same.placeLine);
}

// --- Comment range beats structured single endpoint ---
{
  const raw = "silnice I/7, 18,0 - 22,5 km, práce údržby";
  const card = buildTrafficCardPresentation({
    eventType: "prace",
    road: "I/7",
    roadClass: "CLASS_I",
    kilometer: 22.5,
    impact: raw,
    impactFull: raw,
  });
  ok(
    "COMMENT_BEATS_POINT",
    /km\s+18(?:,0)?\s*[–-]\s*22,5/i.test(card.placeLine || ""),
    card.placeLine
  );
}

// --- Information-value: maintenance subtype ---
{
  const cases = [
    { id: "MAINT", raw: "práce údržby", need: /Práce\s+údržby/i },
    { id: "BRIDGE", raw: "údržba a opravy mostů", need: /Údržba\s+a\s+opravy\s+mostů/i },
    { id: "GENERIC", raw: "práce na silnici", need: /^Práce\s+na\s+silnici\.?$/i },
  ];
  for (const c of cases) {
    const sit = String(
      buildTrafficSituationSummary({
        impact: c.raw,
        impactFull: c.raw,
        eventType: "prace",
      }) || ""
    );
    ok("INFO_" + c.id, c.need.test(sit), sit);
  }
}

// --- Cross regression: prior fixtures must stay rich ---
{
  const jandova =
    "ulice Jandova v obci Praha okres území Hlavního města Prahy, směr prosecká estakáda, omezení, Pozor! Překážka na vozovce, od 13.8.2026 10:20 do 13.8.2026 17:25, stojící vozidlo po havárii před železničním viaduktem u náměstí OSN, Zdroj: TSK Praha / DIC";
  const sitJ = String(
    buildTrafficSituationSummary({
      impact: jandova,
      impactFull: jandova,
      eventType: "prekazka",
      municipality: "Praha",
      street: "Jandova",
      direction: "prosecká estakáda",
    }) || ""
  );
  ok("JANDOVA_OK", /stojící\s+vozidlo/i.test(sitJ), sitJ);

  const kry =
    "Od 13.8.2026 14:35 do 16:40; na silnici 592 v obci Kryštofovo Údolí okres Liberec; nehoda; probíhá vyšetřování nehody; DOD x MOTO, se zraněním.";
  const sitK = String(
    buildTrafficSituationSummary({
      impact: kry,
      impactFull: kry,
      eventType: "nehoda",
      road: "592",
      roadClass: "CLASS_II",
    }) || ""
  );
  ok("KRY_OK", /dodávk/i.test(sitK) && /motocykl/i.test(sitK), sitK);

  const i38 =
    "silnice I/38, mezi 44.53 a 40.74 km, údržba stromů a keřů, rozsah: pravý jízdní pruh, počet průjezdných pruhů: 1";
  const card38 = buildTrafficCardPresentation({
    impact: i38,
    impactFull: i38,
    eventType: "prace",
    road: "38",
    roadClass: "CLASS_I",
  });
  ok("I38_RANGE", /44,53/.test(card38.placeLine || "") && /40,74/.test(card38.placeLine || ""), card38.placeLine);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  D4_FIXTURE: results
    .filter((r) =>
      [
        "ROAD_D4",
        "ROAD_CLASS_MOTORWAY",
        "KM_RANGE_PRESENT",
        "COLLAPSED_FROM",
        "COLLAPSED_TO",
        "WORK_MAINTENANCE",
        "SIT_MAINTENANCE",
        "NO_TWENTY_MIN_INFER",
      ].includes(r.id)
    )
    .every((r) => r.pass),
  RANGE_GUARD: results
    .filter((r) => r.id.includes("RANGE") || r.id.includes("COMMENT_BEATS") || r.id.includes("STRUCT_RANGE"))
    .every((r) => r.pass),
  POINT_GUARD: results.filter((r) => r.id.includes("POINT") || r.id.includes("EQUAL_ENDS")).every((r) => r.pass),
  DECIMAL_FORMAT_GUARD: results.filter((r) => r.id.includes("DECIMAL")).every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("INFO_") || r.id.includes("SIT_")).every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_D4_KM_RANGE_MAINTENANCE_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_D4_KM_RANGE_MAINTENANCE_GUARD_PASS");
