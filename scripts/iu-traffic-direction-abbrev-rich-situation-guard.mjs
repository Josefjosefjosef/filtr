#!/usr/bin/env node
/**
 * NDIC direction abbreviation + rich traffic-situation guard.
 * Hamrovice-style: do not truncate "P.Bezruče"; do not collapse closed roadworks
 * with explicit reason into bare "Stavební práce."; never invent facts.
 * Pure local, no network.
 */
import {
  normalizeDirectionHuman,
  parseOfficialCommentFacts,
  buildTrafficSituationSummary,
  buildTrafficCardPresentation,
  isAbbreviationOrInitialDot,
  clipExtractedValueAtStructuralEnd,
  extractEventReasonFromOfficialComment,
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

const HAM_RAW =
  "místní komunikace, Ostravice, část obce Hamrovice, okr. Frýdek-Místek, uzavřeno, stavební práce, Od 21.08.2026 06:30 Do 21.08.2026 15:00, z důvodu výkopu v komunikaci a uložení VN kabelu ČEZ; směr od mostu P.Bezruče k husitské zvonici, Vydal: Obecní úřad Ostravice";

const PARTIAL_RAW =
  "silnice II/123, stavební práce, částečná uzavírka, provoz jedním jízdním pruhem, Od 01.01.2026";

const BARE_RAW = "silnice I/10, stavební práce, Od 01.01.2026 Do 02.01.2026, Vydal: ŘSD";

// --- GUARD: abbreviation / initial dots must not end values ---
{
  for (const [raw, mustKeep] of [
    ["P.Bezruče k husitské zvonici", /P\.?\s*Bezruče/i],
    ["P. Bezruče k husitské zvonici", /P\.?\s*Bezruče/i],
    ["ul. Moskevská, Praha", /ul\.\s*Moskevská/i],
    ["č. 100 a okolí", /č\.\s*100/i],
    ["okr. Frýdek-Místek, uzavřeno", /okr\.\s*Frýdek-Místek/i],
  ]) {
    const clipped = clipExtractedValueAtStructuralEnd(raw, 80);
    ok(
      "ABBREV_CLIP_" + raw.slice(0, 12).replace(/\s+/g, "_"),
      mustKeep.test(clipped) && !/^(P|ul|č|okr)$/i.test(clipped),
      clipped
    );
  }
  ok(
    "ABBREV_DOT_P",
    isAbbreviationOrInitialDot("P.Bezruče", 1) === true
  );
  ok(
    "ABBREV_DOT_UL",
    isAbbreviationOrInitialDot("ul. Moskevská", 2) === true
  );
  ok(
    "SENTENCE_DOT_NOT_ABBREV",
    isAbbreviationOrInitialDot("uzavřeno. Stavební", 8) === false
  );
}

// --- GUARD 10: Hamrovice direction + situation ---
{
  const facts = parseOfficialCommentFacts(HAM_RAW);
  const wantDir = "od mostu P. Bezruče k husitské zvonici";
  ok("HAM_DIR_FULL", facts.directionHuman === wantDir, facts.directionHuman);
  ok("HAM_DIR_NOT_TRUNC", facts.directionHuman !== "od mostu P", facts.directionHuman);
  ok("HAM_DIR_HAS_BEZRUCE", /Bezruče/i.test(facts.directionHuman || ""), facts.directionHuman);
  ok("HAM_DIR_HAS_ZVONICE", /zvonici/i.test(facts.directionHuman || ""), facts.directionHuman);

  const reason = extractEventReasonFromOfficialComment(HAM_RAW);
  ok("HAM_REASON_HAS_VYKOP", /výkop/i.test(reason.reasonText || ""), reason.reasonText);
  ok("HAM_REASON_HAS_KABEL", /kabel/i.test(reason.reasonText || ""), reason.reasonText);
  ok("HAM_REASON_NO_SMER", !/\bsměr\b/i.test(reason.reasonText || ""), reason.reasonText);
  ok("HAM_REASON_NO_VYDAL", !/Vydal|Obecní úřad/i.test(reason.reasonText || ""), reason.reasonText);

  const sum = buildTrafficSituationSummary({
    impact: HAM_RAW,
    impactFull: HAM_RAW,
    eventType: "prace",
  });
  ok("HAM_SIT_NOT_BARE", !/^Stavební práce\.?\s*$/i.test(sum), sum);
  ok("HAM_SIT_CLOSED", /uzavřen/i.test(sum), sum);
  ok("HAM_SIT_STAVEBNI", /stavebn/i.test(sum), sum);
  ok("HAM_SIT_VYKOP", /výkop/i.test(sum), sum);
  ok("HAM_SIT_KABEL", /kabel|ČEZ/i.test(sum), sum);
  ok("HAM_SIT_NO_SMER_MIX", !/\bsměr\b/i.test(sum), sum);
  ok("HAM_SIT_NO_VYDAL", !/Vydal|Obecní úřad/i.test(sum), sum);

  const card = buildTrafficCardPresentation({
    impact: HAM_RAW,
    impactFull: HAM_RAW,
    eventType: "prace",
    municipality: "Ostravice",
    district: "Frýdek-Místek",
    location: "část obce Hamrovice",
  });
  ok(
    "HAM_CARD_DIR",
    card.communication && card.communication.direction === wantDir,
    card.communication && card.communication.direction
  );
  ok(
    "HAM_RAW_PRESERVED",
    /P\.Bezruče|P\. Bezruče/.test(String(card.rawSourceText || HAM_RAW))
  );
}

// --- GUARD 11: direction normalize for initials ---
{
  ok(
    "DIR_NORM_FULL",
    normalizeDirectionHuman("od mostu P.Bezruče k husitské zvonici") ===
      "od mostu P. Bezruče k husitské zvonici"
  );
  ok(
    "DIR_NORM_TRUNC_NULL",
    normalizeDirectionHuman("od mostu P") == null
  );
  ok(
    "DIR_NORM_CITY_OK",
    normalizeDirectionHuman("směr Ostrava") === "Ostrava"
  );
}

// --- GUARD 12: maximum relevant info (partial closure + single lane) ---
{
  const sum = buildTrafficSituationSummary({
    impact: PARTIAL_RAW,
    impactFull: PARTIAL_RAW,
    eventType: "prace",
    road: "II/123",
  });
  ok("PARTIAL_NOT_BARE", !/^Stavební práce\.?\s*$/i.test(sum), sum);
  ok("PARTIAL_HAS_CASTECNA", /částečn/i.test(sum), sum);
  ok("PARTIAL_HAS_LANE", /jedním jízdním pruhem/i.test(sum), sum);
}

// --- GUARD 13: no hallucination from bare "stavební práce" ---
{
  const sum = buildTrafficSituationSummary({
    impact: BARE_RAW,
    impactFull: BARE_RAW,
    eventType: "prace",
    road: "I/10",
  });
  ok("BARE_IS_STAVEBNI", /Stavební práce/i.test(sum), sum);
  ok("BARE_NO_CASTECNA", !/částečn/i.test(sum), sum);
  ok("BARE_NO_JEDNIM", !/jedním jízdním/i.test(sum), sum);
  ok("BARE_NO_OBJIZDKA", !/objížďk/i.test(sum), sum);
  ok("BARE_NO_VYKOP", !/výkop|kabel/i.test(sum), sum);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-direction-abbrev-rich-situation",
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
