#!/usr/bin/env node
/**
 * Karlovy Vary-class: closed street + engineering-network work + concrete cable work
 * + access-from-street + street/locality dedup.
 * Fixture-based general guards — no Karlovy Vary / Ondřejská / Vřídelní hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractSpecificWorkFromOfficialComment,
  extractAccessInformationFromOfficialComment,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  isFullScopeClosure,
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
  "ulice Ondřejská, Karlovy Vary, okr. Karlovy Vary, uzavřeno, práce na inženýrských sítích, Od 18.08.2026 08:00 Do 21.08.2026 15:00, Zajištění realizace umístění kabelového vedení k nové trafostanici. Příjezd do ulice Ondřejská zajištěn DIO z ulice Vřídelní., Vydal: Magistrát města Karlovy Vary";

// --- Facts ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const sw = extractSpecificWorkFromOfficialComment(REF_RAW);
  const acc = extractAccessInformationFromOfficialComment(REF_RAW);

  ok("STREET", (facts.streets || []).includes("Ondřejská") || facts.street === "Ondřejská", facts.street);
  ok("MUNI", facts.city === "Karlovy Vary", facts.city);
  ok("DISTRICT", facts.district === "Karlovy Vary", facts.district);
  ok("CLOSED_SCOPE", isFullScopeClosure(REF_RAW) === true);
  ok("WORK_ENGINEERING", /inženýrských\s+sítích/i.test(REF_RAW));
  ok("SPECIFIC_WORK", /kabel|trafostanic/i.test(sw || facts.specificWork || ""), sw || facts.specificWork);
  ok("CABLE_FACT", /kabel/i.test(sw || facts.specificWork || ""), sw);
  ok("TRANSFORMER_FACT", /trafostanic/i.test(sw || facts.specificWork || ""), sw);
  ok("ACCESS_YES", !!(acc && facts.accessInformation), JSON.stringify(acc));
  ok("ACCESS_DEST", /Ondřejská/i.test((acc && acc.destinationStreet) || ""), acc && acc.destinationStreet);
  ok("ACCESS_FROM", /Vřídelní/i.test((acc && acc.fromStreet) || ""), acc && acc.fromStreet);
  ok("ACCESS_NOT_DETOUR", acc && acc.isDetour === false);
}

// --- Collapsed situation ---
{
  const input = {
    summaryFull: REF_RAW,
    summary: REF_RAW,
    impactFull: REF_RAW,
    eventType: "roadworks",
    municipality: "Karlovy Vary",
    district: "Karlovy Vary",
    location: "Ondřejská",
    street: "Ondřejská",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("SIT_NOT_BARE", !/^práce na inženýrských sítích\.?$/i.test(sit.trim()), sit);
  ok("SIT_ENGINEERING", /inženýrských\s+sítích/i.test(sit), sit);
  ok("SIT_CLOSURE", /uzavřen/i.test(sit), sit);
  ok("SIT_CABLE", /kabel/i.test(sit), sit);
  ok("SIT_TRANSFORMER", /trafostanic/i.test(sit), sit);
  ok("SIT_ACCESS", /příjezd/i.test(sit) && /Vřídelní/i.test(sit), sit);
  ok("SIT_NO_DETOUR", !/objížď/i.test(sit), sit);
  ok("SIT_NO_VYDAL", !/Vydal:/i.test(sit), sit);
  ok("SIT_NO_DIO_JARGON", !/\bDIO\b/.test(sit), sit);

  ok("UI_STREET", rows.street === "Ondřejská");
  ok("UI_MUNI", rows.municipality === "Karlovy Vary");
  ok("UI_DISTRICT", rows.district === "Karlovy Vary");
  ok("UI_NO_LOCALITY_DUP", !rows.location, rows.location || "");
  ok("UI_ACCESS", /Vřídelní/i.test(rows.accessInformation || ""), rows.accessInformation || "");
  ok("RAW_PRESERVED", /Vřídelní/i.test(rows.sourceDescription || "") && /trafostanic/i.test(rows.sourceDescription || ""));
}

// --- Street/locality dedup + same-name admin levels ---
{
  const card = buildTrafficCardPresentation({
    summaryFull: "ulice Testova, ObecX, okr. ObecX, uzavřeno, práce na inženýrských sítích",
    summary: "ulice Testova, ObecX, okr. ObecX, uzavřeno, práce na inženýrských sítích",
    eventType: "roadworks",
    street: "Testova",
    municipality: "ObecX",
    district: "ObecX",
    location: "Testova",
  });
  const rows = rowMap(card);
  ok("DEDUP_STREET_YES", rows.street === "Testova");
  ok("DEDUP_MUNI_YES", rows.municipality === "ObecX");
  ok("DEDUP_DISTRICT_YES", rows.district === "ObecX");
  ok("DEDUP_LOCALITY_NO", !rows.location);
}

// --- Access ≠ detour for generic fixture ---
{
  const raw =
    "ulice Alfa, uzavřeno, práce na inženýrských sítích, umístění kabelového vedení k nové trafostanici. Příjezd do ulice Alfa zajištěn DIO z ulice Beta., Vydal: X";
  const acc = extractAccessInformationFromOfficialComment(raw);
  const sit = buildTrafficSituationSummary({
    summaryFull: raw,
    summary: raw,
    impactFull: raw,
    eventType: "roadworks",
    street: "Alfa",
  });
  ok("GEN_ACCESS_FROM", /Beta/i.test((acc && acc.fromStreet) || ""), acc && acc.fromStreet);
  ok("GEN_ACCESS_DEST", /Alfa/i.test((acc && acc.destinationStreet) || ""), acc && acc.destinationStreet);
  ok("GEN_SIT_ACCESS", /příjezd/i.test(sit || "") && /Beta/i.test(sit || ""), sit);
  ok("GEN_SIT_NO_DETOUR", !/objížď/i.test(sit || ""), sit);
  ok("GEN_SIT_CLOSURE", /uzavřen/i.test(sit || ""), sit);
  ok("GEN_SIT_CABLE", /kabel/i.test(sit || ""), sit);
}

// --- No hallucination from engineering-network-only ---
{
  const sit = buildTrafficSituationSummary({
    summaryFull: "ulice A, práce na inženýrských sítích, Od 1.1.2026",
    summary: "ulice A, práce na inženýrských sítích, Od 1.1.2026",
    eventType: "roadworks",
  });
  ok("BARE_HAS_ENGINEERING", /inženýrských/i.test(sit || ""), sit);
  ok("BARE_NO_CABLE", !/kabel/i.test(sit || ""), sit);
  ok("BARE_NO_ACCESS", !/příjezd/i.test(sit || ""), sit);
  ok("BARE_NO_DETOUR", !/objížď/i.test(sit || ""), sit);
  ok("BARE_NO_FALSE_FULL_CLOSE_WORDING", !/úpln[áa]\s+uzavírk/i.test(sit || ""), sit);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-karlovy-vary-closure-access",
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
