#!/usr/bin/env node
/**
 * Děčín-class: roadworks + narrowed lanes + specific reason + admin locality dedup.
 * Fixture-based general guards — no Děčín / Folknářská / III/26228 hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractEventReasonFromOfficialComment,
  extractLocationQualifierFromOfficialComment,
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
  "silnice III/26228 (ulice Folknářská), Děčín, okr. Děčín, zúžené jízdní pruhy, stavební práce, Od 19.08.2026 00:00 Do 31.08.2026 23:59, Zvláštní užívání silnice č. III/26228 (ul. Folknářská) u p.p.č. 2740, k.ú. Děčín, z důvodu realizace sjezdu., Vydal: Magistrát města Děčín";

// --- Facts ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const reason = extractEventReasonFromOfficialComment(REF_RAW);
  ok("ROAD", facts.roadNumber === "III/26228" || /III\/26228/.test(REF_RAW), facts.roadNumber);
  ok("STREET", (facts.streets || []).includes("Folknářská") || facts.street === "Folknářská", facts.street);
  ok("MUNI", facts.city === "Děčín", facts.city);
  ok("DISTRICT", facts.district === "Děčín", facts.district);
  ok("REASON", /sjezdu/i.test(reason.reasonText || ""), reason.reasonText);
  ok("QUALIFIER", /p\.p\.č\.\s*2740/i.test(facts.locationQualifier || ""), facts.locationQualifier);
  ok("NOT_FULL_CLOSURE", isFullScopeClosure(REF_RAW) === false);
}

// --- Collapsed situation ---
{
  const input = {
    summaryFull: REF_RAW,
    summary: REF_RAW,
    impactFull: REF_RAW,
    eventType: "roadworks",
    road: "III/26228",
    municipality: "Děčín",
    district: "Děčín",
    location: "Děčín",
  };
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);

  ok("SIT_NOT_BARE", !/^stavební práce\.?$/i.test(sit.trim()), sit);
  ok("SIT_ROADWORKS", /stavebn/i.test(sit), sit);
  ok("SIT_NARROWED", /zúžen/i.test(sit), sit);
  ok("SIT_REASON", /sjezdu/i.test(sit), sit);
  ok("SIT_NO_FALSE_CLOSURE", !/uzavírka|uzavřena/i.test(sit), sit);
  ok("SIT_NO_HALLUC_ONE_LANE", !/jedním jízdním pruhem/i.test(sit), sit);
  ok("SIT_NO_HALLUC_KYVADLO", !/kyvadlov/i.test(sit), sit);
  ok("SIT_NO_HALLUC_OBJIZDKA", !/objížď/i.test(sit), sit);
  ok("SIT_NO_VYDAL", !/Vydal:/i.test(sit), sit);

  ok("UI_MUNI", rows.municipality === "Děčín");
  ok("UI_DISTRICT", rows.district === "Děčín");
  ok("UI_NO_LOCALITY_DUP", !rows.location, rows.location || "");
  ok("UI_QUALIFIER", /2740/.test(rows.locationQualifier || ""), rows.locationQualifier || "");
  ok("RAW_PRESERVED", /realizace sjezdu/i.test(rows.sourceDescription || ""));
}

// --- Admin dedup: same-name district kept ---
{
  const card = buildTrafficCardPresentation({
    summaryFull: "ulice Testova, ObecX, okr. ObecX, stavební práce",
    summary: "ulice Testova, ObecX, okr. ObecX, stavební práce",
    eventType: "roadworks",
    municipality: "ObecX",
    district: "ObecX",
    location: "ObecX",
  });
  const rows = rowMap(card);
  ok("DEDUP_MUNI_YES", rows.municipality === "ObecX");
  ok("DEDUP_DISTRICT_YES", rows.district === "ObecX");
  ok("DEDUP_LOCALITY_NO", !rows.location);
}

// --- No hallucination from narrowed-only ---
{
  const sit = buildTrafficSituationSummary({
    summaryFull: "silnice I/1, zúžené jízdní pruhy, Od 1.1.2026",
    summary: "silnice I/1, zúžené jízdní pruhy, Od 1.1.2026",
    eventType: "roadworks",
  });
  ok("NARROW_ONLY_HAS_NARROW", /zúžen/i.test(sit || ""), sit);
  ok("NARROW_ONLY_NO_ONE_LANE", !/jedním jízdním pruhem/i.test(sit || ""));
  ok("NARROW_ONLY_NO_FULL_CLOSE", !/úpln[áa]\s+uzavírk|silnice je uzavřena/i.test(sit || ""));
  ok("NARROW_ONLY_NO_OBJIZDKA", !/objížď/i.test(sit || ""));
}

// --- Cross: reason without inventing closure ---
{
  const sit = buildTrafficSituationSummary({
    summaryFull:
      "ulice A, stavební práce, zúžené jízdní pruhy, z důvodu realizace sjezdu, Vydal: X",
    summary: "ulice A, stavební práce, zúžené jízdní pruhy, z důvodu realizace sjezdu, Vydal: X",
    eventType: "roadworks",
  });
  ok("CROSS_HAS_REASON", /sjezdu/i.test(sit || ""), sit);
  ok("CROSS_HAS_NARROW", /zúžen/i.test(sit || ""), sit);
  ok("CROSS_NO_UZAVIRKA_WORD", !/uzavírka je z důvodu/i.test(sit || ""), sit);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-decin-narrowed-lanes-reason",
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
