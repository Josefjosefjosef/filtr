#!/usr/bin/env node
/**
 * Construction vehicle / equipment movement fact preservation for roadworks.
 * Specific site-exit facts must beat bare "Práce na silnici." Pure local, no hardcode.
 */
import {
  parseOfficialCommentFacts,
  parseConstructionSiteTrafficFactsFromText,
  formatConstructionSiteMovementLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
  buildLocalityHeaderModel,
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
  "silnice I/35, v katastru obce Řídky, okr. Svitavy, Od 15.08.2026 08:00 Do 15.08.2026 14:00, Pozor! Výjezd vozidel stavby; výjezd a pohyb stavební techniky ze staveniště dálnice, dbejte zvýšené opatrnosti.";

// --- Reference fixture ---
{
  const parsed = parseConstructionSiteTrafficFactsFromText(REF_RAW);
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prace",
    road: "35",
    roadClass: "CLASS_I",
    municipality: "Řídky",
    district: "Svitavy",
  };
  const ev = classifyEventPresentation(input);
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const rows = rowMap(card);
  const lead = formatConstructionSiteMovementLead(facts, REF_RAW);

  ok("EVENT_ROADWORKS", ev.kind === "roadworks", ev.kind);
  ok("TITLE_PRACE", /PRÁCE\s+NA\s+SILNICI/i.test(ev.titleCs || ""), ev.titleCs);
  ok("MUNICIPALITY_SIGN_AFTER", hdr.municipalitySignLabel === "ŘÍDKY", hdr.municipalitySignLabel);
  ok("ROAD_BADGE_AFTER", /I\/35/i.test(card.placeLine || ""), card.placeLine);
  ok(
    "LOCATION_AFTER",
    /I\/35\s*·\s*Řídky\s*·\s*okres\s+Svitavy/i.test(card.placeLine || ""),
    card.placeLine
  );

  ok("CONSTRUCTION_VEHICLE_EXIT_SOURCE_PRESENT", /Výjezd\s+vozidel\s+stavby/i.test(REF_RAW));
  ok("CONSTRUCTION_VEHICLE_EXIT_EXTRACTED", parsed.constructionVehicleExit === true);
  ok("CONSTRUCTION_VEHICLE_EXIT_STRUCTURED", facts.constructionVehicleExit === true);
  ok(
    "CONSTRUCTION_EQUIPMENT_MOVEMENT_EXTRACTED",
    parsed.constructionEquipmentMovement === true
  );
  ok(
    "CONSTRUCTION_EQUIPMENT_MOVEMENT_STRUCTURED",
    facts.constructionEquipmentMovement === true
  );
  ok("CONSTRUCTION_SITE_EXIT", facts.constructionSiteExit === true);

  ok(
    "CONSTRUCTION_VEHICLE_MOVEMENT_FACT_GUARD",
    /výjezd/i.test(sit) && /stavební\s+technik/i.test(sit) && /staveništ/i.test(sit),
    sit
  );
  ok(
    "LEAD_SYNTH",
    /Výjezd\s+vozidel\s+a\s+pohyb\s+stavební\s+techniky\s+ze\s+staveniště/i.test(lead || ""),
    lead
  );

  ok("CAUTION_SOURCE_PRESENT", /dbejte\s+zvýšené\s+opatrnosti/i.test(REF_RAW));
  ok("CAUTION_STRUCTURED", facts.cautionModality === "heed", String(facts.cautionModality));
  ok("CAUTION_GUARD", /Dbejte\s+zvýšené\s+opatrnosti/i.test(sit), sit);
  ok("CAUTION_MODALITY_PRESERVED", !/Průjezd\s+se\s+zvýšenou\s+opatrností/i.test(sit), sit);

  ok(
    "ROADWORK_GENERIC_FALLBACK_GUARD",
    !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()) && !/Práce\s+na\s+silnici/i.test(sit),
    sit
  );
  ok("GENERIC_ROADWORK_FALLBACK_USED_AS_ONLY_SUMMARY_NO", !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()));

  ok(
    "RAW_PRESERVED",
    /Výjezd\s+vozidel\s+stavby/i.test(rows.sourceDescription || "") &&
      /dbejte\s+zvýšené\s+opatrnosti/i.test(rows.sourceDescription || ""),
    rows.sourceDescription
  );
}

// --- TRUE_GENERIC_ROADWORK_POSITIVE_GUARD ---
{
  const raw = "silnice I/11, v obci Sampleville, práce na silnici.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "11",
      roadClass: "CLASS_I",
      municipality: "Sampleville",
    }) || ""
  );
  ok("TRUE_GENERIC_ROADWORK_POSITIVE_GUARD", /^Práce\s+na\s+silnici\.?$/i.test(sit.trim()), sit);
}

// --- ROADWORK_SPECIFICITY_GUARD (lane / alternating beat generic) ---
{
  const raw =
    "silnice I/58, Omezení v jízdním pruhu. Střídavý jednosměrný provoz. Oprava propustků 1-2P.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "58",
      roadClass: "CLASS_I",
    }) || ""
  );
  ok(
    "ROADWORK_SPECIFICITY_GUARD",
    !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()) &&
      (/propustk/i.test(sit) || /střídavý|kyvadlov|jízdním\s+pruhu/i.test(sit)),
    sit
  );
}

// --- Frenštát regression ---
{
  const raw =
    "silnice I/58, v katastru obce Frenštát pod Radhoštěm, okr. Nový Jičín, (Rožnovská) - část obce Buzkovice - (Rožnovská), část obce Kopaná, Od 19.08.2026 00:00, Do 30.11.2026 23:59, Omezení v jízdním pruhu. Střídavý jednosměrný provoz. Oprava propustků 58-060P a 58-061P. Vydal: Krajský úřad Moravskoslezského kraje";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "58",
      roadClass: "CLASS_I",
      municipality: "Frenštát pod Radhoštěm",
      district: "Nový Jičín",
    }) || ""
  );
  ok(
    "FRENSTAT_ROADWORK_REGRESSION",
    /propustk/i.test(sit) &&
      /střídavý|kyvadlov|jízdním\s+pruhu/i.test(sit) &&
      !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()),
    sit
  );
}

// --- D11 FUTURE lane closure regression ---
{
  const raw =
    "D11, km 10–12, směr Praha, Od 20.08.2026 22:00 Do 21.08.2026 05:00, pravý jízdní pruh uzavřen, práce na silnici.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "D11",
      roadClass: "MOTORWAY",
      direction: "Praha",
      kmFrom: 10,
      kmTo: 12,
      lifecycleStatus: "FUTURE",
    }) || ""
  );
  ok(
    "D11_FUTURE_ROADWORK_REGRESSION",
    /pravý\s+jízdní\s+pruh/i.test(sit) && /bude\s+uzavřen|uzavřen/i.test(sit),
    sit
  );
  ok("D11_NOT_GENERIC_ONLY", !/^Práce\s+na\s+silnici\.?$/i.test(sit.trim()), sit);
}

// --- Generic pattern without Řídky hardcode ---
{
  const raw =
    "silnice II/123, v obci Alphaville, Pozor! Výjezd vozidel stavby; výjezd a pohyb stavební techniky ze staveniště, dbejte zvýšené opatrnosti.";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "prace",
      road: "123",
      roadClass: "CLASS_II",
      municipality: "Alphaville",
    }) || ""
  );
  ok(
    "GENERIC_PATTERN_SITE_EXIT",
    /výjezd/i.test(sit) && /stavební\s+technik/i.test(sit) && /Dbejte\s+zvýšené\s+opatrnosti/i.test(sit),
    sit
  );
}

const passN = results.filter((r) => r.pass).length;
const failN = fails.length;
const out = {
  guard: "iu-traffic-roadwork-construction-vehicle-exit-guard",
  pass: failN === 0,
  passCount: passN,
  failCount: failN,
  fails,
  CONSTRUCTION_VEHICLE_MOVEMENT_FACT_GUARD_PASS: results.some(
    (r) => r.id === "CONSTRUCTION_VEHICLE_MOVEMENT_FACT_GUARD" && r.pass
  ),
  CAUTION_GUARD_PASS: results.some((r) => r.id === "CAUTION_GUARD" && r.pass),
  ROADWORK_GENERIC_FALLBACK_GUARD_PASS: results.some(
    (r) => r.id === "ROADWORK_GENERIC_FALLBACK_GUARD" && r.pass
  ),
  TRUE_GENERIC_ROADWORK_POSITIVE_GUARD_PASS: results.some(
    (r) => r.id === "TRUE_GENERIC_ROADWORK_POSITIVE_GUARD" && r.pass
  ),
  ROADWORK_SPECIFICITY_GUARD_PASS: results.some(
    (r) => r.id === "ROADWORK_SPECIFICITY_GUARD" && r.pass
  ),
  FRENSTAT_ROADWORK_REGRESSION_PASS: results.some(
    (r) => r.id === "FRENSTAT_ROADWORK_REGRESSION" && r.pass
  ),
  D11_FUTURE_ROADWORK_REGRESSION_PASS: results.some(
    (r) => r.id === "D11_FUTURE_ROADWORK_REGRESSION" && r.pass
  ),
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_ROADWORK_CONSTRUCTION_VEHICLE_EXIT_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_ROADWORK_CONSTRUCTION_VEHICLE_EXIT_GUARD_PASS");
