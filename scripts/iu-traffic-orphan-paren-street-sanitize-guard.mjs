#!/usr/bin/env node
/**
 * Orphan parenthesis street/locality sanitize guard.
 * Ensures NDIC "(ulice X)" extraction never leaves trailing/orphan ),
 * while preserving legitimate balanced parentheses.
 * Pure local, no network.
 */
import {
  sanitizeExtractedValueToken,
  stripUnbalancedParentheses,
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  buildPlaceAndDirectionLine,
  resolveConfirmedStreet,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { extractLocalityFromOfficialComment } from "../scripts/ndic-datex-v1/traffic-card-content-v1.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function parenBalanceOk(s) {
  let d = 0;
  for (const ch of String(s || "")) {
    if (ch === "(") d += 1;
    else if (ch === ")") {
      d -= 1;
      if (d < 0) return false;
    }
  }
  return d === 0;
}

// --- GUARD 1: Boskovická ---
{
  const raw =
    "silnice II/377 (ulice Boskovická), obec Blansko, práce na silnici, Od 01.01.2026";
  const up = extractLocalityFromOfficialComment(raw);
  ok("G1_UPSTREAM_STREET", up.streetHint === "Boskovická", up.streetHint);
  ok("G1_UPSTREAM_NO_TRAIL", !/\)/.test(up.streetHint || ""), up.streetHint);
  ok(
    "G1_SANITIZE",
    sanitizeExtractedValueToken("Boskovická)") === "Boskovická",
    sanitizeExtractedValueToken("Boskovická)")
  );
  const facts = parseOfficialCommentFacts(raw);
  ok("G1_FACTS_STREET", facts.street === "Boskovická", facts.street);
  const hdr = buildLocalityHeaderModel({
    impact: raw,
    impactFull: raw,
    road: "II/377",
    streetHint: up.streetHint,
    location: up.streetHint + ") - silnice II/377",
    municipality: "Blansko",
  });
  ok("G1_HDR_STREET", hdr.street === "Boskovická", hdr.street);
  ok(
    "G1_CARD_RENDER",
    hdr.besideLocality === "ulice: Boskovická" || hdr.streetLabel === "ulice: Boskovická",
    hdr.besideLocality
  );
  ok("G1_NO_ORPHAN_IN_BESIDE", !/\)/.test(hdr.besideLocality || ""), hdr.besideLocality);
}

// --- GUARD 2: Rokycanská ---
{
  const raw = "silnice I/26 (ulice Rokycanská), Plzeň 4, práce na silnici";
  const up = extractLocalityFromOfficialComment(raw);
  ok("G2_UPSTREAM", up.streetHint === "Rokycanská", up.streetHint);
  ok(
    "G2_SANITIZE",
    sanitizeExtractedValueToken("Rokycanská)") === "Rokycanská",
    sanitizeExtractedValueToken("Rokycanská)")
  );
  const street = resolveConfirmedStreet({
    impact: raw,
    impactFull: raw,
    streetHint: "Rokycanská)",
  });
  ok("G2_RESOLVED", street === "Rokycanská", street);
}

// --- GUARD 3: multi-street Olomoucká / Lipenská ---
{
  const raw =
    'silnice III/03554 (ulice Olomoucká - ulice Lipenská), Velký Újezd, okr. Olomouc, Od 16.08.2026 00:00, Do 16.08.2026 23:59, Úplná uzavírka silnice č. III/03554 ul. Olomoucká, Lipenská a silnice č. III/43617 ul. Přerovská v obci Velký Újezd (u domů č. 100, 17 a 63) z důvodu konání kulturní akce "Hodové slavnosti 2026".';
  const up = extractLocalityFromOfficialComment(raw);
  ok(
    "G3_UPSTREAM_NO_TRAIL",
    up.streetHint === "Olomoucká - ulice Lipenská",
    up.streetHint
  );
  ok(
    "G3_SANITIZE_CONTAMINATED",
    sanitizeExtractedValueToken("Olomoucká - ulice Lipenská)") ===
      "Olomoucká - ulice Lipenská",
    sanitizeExtractedValueToken("Olomoucká - ulice Lipenská)")
  );
  const facts = parseOfficialCommentFacts(raw);
  ok(
    "G3_FACTS_STREETS_CLEAN",
    (facts.streets || []).every((s) => !/\)/.test(s) && !/^\(/.test(s)),
    JSON.stringify(facts.streets)
  );
  ok("G3_FACTS_HAS_OLOMOUCKA", (facts.streets || []).includes("Olomoucká"));
  ok("G3_FACTS_HAS_LIPENSKA", (facts.streets || []).includes("Lipenská"));
}

// --- GUARD 4: legitimate balanced parentheses preserved ---
{
  const legit = "Velký Újezd (u domu č. 100)";
  const out = sanitizeExtractedValueToken(legit);
  ok("G4_PRESERVE_EXACT", out === legit, out);
  ok("G4_HAS_OPEN", out.includes("("), out);
  ok("G4_HAS_CLOSE", out.includes(")"), out);
  const multi = "Velký Újezd (u domů č. 100, 17 a 63)";
  ok(
    "G4_PRESERVE_MULTI",
    sanitizeExtractedValueToken(multi) === multi,
    sanitizeExtractedValueToken(multi)
  );
}

// --- GUARD 5: balanced-parentheses invariant ---
{
  const samples = [
    "Boskovická)",
    "(Boskovická",
    "Boskovická) - silnice II/377",
    "ulice Boskovická)",
    "(ulice Rokycanská)",
    "Velký Újezd (u domu č. 100)",
    "Olomoucká - ulice Lipenská)",
  ];
  for (let i = 0; i < samples.length; i += 1) {
    const out = sanitizeExtractedValueToken(samples[i]);
    ok("G5_BALANCE_" + i, parenBalanceOk(out), samples[i] + " => " + out);
    ok(
      "G5_NO_TRAIL_ORPHAN_" + i,
      !/^[^(]*\)$/.test(out) || /\(/.test(out),
      out
    );
  }
  ok(
    "G5_STRIP_HELPER",
    stripUnbalancedParentheses("A) B (c)") === "A B (c)",
    stripUnbalancedParentheses("A) B (c)")
  );
  ok(
    "G5_OPEN_ORPHAN",
    sanitizeExtractedValueToken("(Boskovická") === "Boskovická",
    sanitizeExtractedValueToken("(Boskovická")
  );
}

// --- GUARD 6: card rendering must not show orphan ) ---
{
  const raw =
    "silnice II/377 (ulice Boskovická), obec Blansko, práce na silnici";
  const card = buildTrafficCardPresentation({
    impact: raw,
    impactFull: raw,
    road: "II/377",
    streetHint: "Boskovická)",
    location: "Boskovická) - silnice II/377",
    municipality: "Blansko",
    eventType: "prace",
  });
  const hdr = buildLocalityHeaderModel({
    impact: raw,
    impactFull: raw,
    road: "II/377",
    streetHint: "Boskovická)",
    location: "Boskovická) - silnice II/377",
    municipality: "Blansko",
  });
  const place = buildPlaceAndDirectionLine({
    impact: raw,
    impactFull: raw,
    road: "II/377",
    streetHint: "Boskovická)",
    location: "Boskovická) - silnice II/377",
    municipality: "Blansko",
  });
  const blob = JSON.stringify({
    beside: hdr.besideLocality,
    streetLabel: hdr.streetLabel,
    street: hdr.street,
    place,
    placeLine: card.placeLine,
  });
  ok("G6_NO_BOSKOVICKA_ORPHAN", !/Boskovická\)/.test(blob), blob.slice(0, 280));
  ok(
    "G6_HAS_CLEAN_STREET",
    /ulice:\s*Boskovická(?!\))/.test(hdr.besideLocality || "") ||
      hdr.street === "Boskovická",
    hdr.besideLocality
  );
  ok("G6_PLACE_NO_ORPHAN_STREET", !/Boskovická\)/.test(place || ""), place);
  ok(
    "G6_NOT_WRONG_RENDER",
    (hdr.besideLocality || "") !== "ulice: Boskovická) - silnice II/377",
    hdr.besideLocality
  );
  // Expanded locality/street rows must not carry orphan ).
  const rows = (card.expanded && card.expanded.rows) || [];
  const streetRows = rows.filter(
    (r) => r && (r.key === "street" || r.key === "location" || r.label === "Ulice")
  );
  ok(
    "G6_ROWS_NO_ORPHAN",
    streetRows.every((r) => !/Boskovická\)/.test(String(r.value || ""))),
    JSON.stringify(streetRows)
  );
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-orphan-paren-street-sanitize",
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
