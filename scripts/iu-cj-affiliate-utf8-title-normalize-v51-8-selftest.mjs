#!/usr/bin/env node
/**
 * Selftest: CP852→UTF-8 title normalize for CS/SK/PL (and related) diacritics.
 */
import {
  CP852_80_FF,
  countBoxDrawing,
  looksLikeCp852Utf8Mojibake,
  normalizeCjProductFields,
  normalizeCjProductText,
  normalizeOffersPublicDocTexts,
  tryRepairCp852Utf8Mojibake,
  tryRepairCp852Utf8MojibakeSegmented,
} from "./iu-cj-affiliate-utf8-title-normalize-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(CP852_80_FF.length === 128, "CP852 table length 128");

/** Encode UTF-8 text as if misread through CP852 (produces production mojibake). */
function toCp852Mojibake(utf8Text) {
  const bytes = Buffer.from(String(utf8Text), "utf8");
  let out = "";
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else out += CP852_80_FF[b - 0x80];
  }
  return out;
}

const samples = [
  { lang: "cs", good: "Gumové autokoberce" },
  { lang: "cs", good: "stolní lampa šedá" },
  { lang: "cs", good: "Pánský troyer" },
  { lang: "sk", good: "Osviežovač vzduchu" },
  { lang: "sk", good: "3D Bavlnené obliečky" },
  { lang: "pl", good: "Książka dla dzieci" },
  { lang: "pl", good: "Łazienka i kuchnia" },
  { lang: "hu", good: "gardróbszekrény tükörrel" },
];

for (const s of samples) {
  const bad = toCp852Mojibake(s.good);
  assert(looksLikeCp852Utf8Mojibake(bad), s.lang + " mojibake detected: " + s.good);
  assert(countBoxDrawing(bad) > 0, s.lang + " has box glyphs");
  const repaired = tryRepairCp852Utf8Mojibake(bad);
  assert(repaired === s.good, s.lang + " repair mismatch: " + JSON.stringify({ bad, repaired, good: s.good }));
  const n = normalizeCjProductText(bad);
  assert(n.repaired === true && n.text === s.good, s.lang + " normalizeCjProductText");
}

// Clean UTF-8 must pass through unchanged
const clean = "Reality Esna stolní lampa šedá";
assert(looksLikeCp852Utf8Mojibake(clean) === false, "clean Czech not flagged");
assert(normalizeCjProductText(clean).repaired === false, "clean not repaired");
assert(normalizeCjProductText(clean).text === clean, "clean preserved");

// Incomplete / non-mojibake refused
assert(tryRepairCp852Utf8Mojibake("plain ascii") === null, "ascii no repair");
assert(normalizeCjProductText("plain").repaired === false, "ascii normalize noop");

const fields = normalizeCjProductFields({
  title: toCp852Mojibake("Měkká knížka"),
  description: toCp852Mojibake("Popis výrobku český"),
});
assert(fields.title === "Měkká knížka", "fields title");
assert(fields.description === "Popis výrobku český", "fields description");
assert(fields.utf8Normalize.titleRepaired === true, "fields title repaired flag");

const doc = {
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [{ title: toCp852Mojibake("Šatní skříň"), description: null }],
    },
  ],
};
const pass = normalizeOffersPublicDocTexts(doc);
assert(pass.titleRepaired === 1 && pass.scanned === 1, "final pass repaired 1");
assert(doc.sections[0].products[0].title === "Šatní skříň", "final pass title clear");

// Windows-1252 literal class (descriptions): ÔÇŽ → … ; must not touch × / Úž
const winEllipsis = normalizeCjProductText("museumÔÇŽ things");
assert(winEllipsis.repaired === true && winEllipsis.text === "museum… things", "win1252 ellipsis");
const winApos = normalizeCjProductText("wonÔÇÖt stay");
assert(winApos.repaired === true && winApos.text === "won’t stay", "win1252 apostrophe");
const keepTimes = normalizeCjProductText("124 × 124");
assert(keepTimes.repaired === false && keepTimes.text === "124 × 124", "keep multiplication sign");
const keepCzech = normalizeCjProductText("Úžasný kousek");
assert(keepCzech.repaired === false && keepCzech.text === "Úžasný kousek", "keep Czech Úž");

// Full table coverage (escape-based) + idempotency + false-positive guards
const winCases = [
  ["a\u00d4\u00c7\u017db", "a\u2026b"],
  ["a\u00d4\u00c7\u00d6b", "a\u2019b"],
  ["a\u00d4\u00c7\u00f6b", "a\u2014b"],
  ["a\u00d4\u00c7\u00f4b", "a\u2013b"],
  ["a\u00d4\u00c7\u0165b\u00d4\u00c7\u0141", "a\u201cb\u201d"],
  ["a\u00d4\u00c7\u00a3b\u00d4\u00c7\u00d8", "a\u201cb\u201d"],
  ["\u00d4\u00c7\u00f3 item", "\u2022 item"],
];
for (const [bad, good] of winCases) {
  const r1 = normalizeCjProductText(bad);
  assert(r1.repaired === true && r1.text === good, "win1252 table " + JSON.stringify(bad));
  const r2 = normalizeCjProductText(r1.text);
  assert(r2.repaired === false && r2.text === good, "win1252 idempotent " + JSON.stringify(bad));
}
for (const keep of ["124 \u00d7 124", "\u00dA\u017easn\u00fd", "Stra\u00dfe 5\u00d7", "\u00d4 \u00c7 \u017d", "\u00d4\u00c7"]) {
  const r = normalizeCjProductText(keep);
  assert(r.repaired === false && r.text === keep, "keep untouched " + JSON.stringify(keep));
}

// Prod residual classes (sweep): English text + CP852 nbsp (U+252C U+00E1), truncated CZ tail, ctaLabel
{
  const nb = normalizeCjProductText("through today \u252c\u00e1 When Americans");
  assert(nb.repaired === true && nb.text === "through today \u00a0 When Americans", "english+nbsp mojibake");
  assert(normalizeCjProductText(nb.text).repaired === false, "english+nbsp idempotent");
  const cta = normalizeCjProductText("Zobrazit v\u251c\u017brobek");
  assert(cta.repaired === true && cta.text === "Zobrazit v\u00fdrobek", "ctaLabel v├Żrobek -> výrobek");
  // truncated mid-character: "ž" = C5 BE → CP852 "Ï" bytes; cut after lead byte C5 (CP852 0xC5 = \u253c)
  const trunc = normalizeCjProductText("Postel \u00e1\u2502\u2551 ulo\u253c");
  assert(trunc.repaired === false || !trunc.text.includes("\ufffd"), "truncated tail never yields U+FFFD");
  // Prod 5335380|800000647117: CP852 reverse is clean Czech plus one trailing U+FFFD
  // (source bytes EF BF BD). Middle U+FFFD still refuses the whole string.
  const fffdMarker =
    CP852_80_FF[0xef - 0x80] + CP852_80_FF[0xbf - 0x80] + CP852_80_FF[0xbd - 0x80];
  const cutGood = "Postel s \u010delem a \u00falo\u017en\u00fdm prostorem";
  const cutBad = toCp852Mojibake(cutGood + "\uFFFD");
  assert(cutBad.endsWith(fffdMarker), "fffd marker is EF BF BD via CP852");
  const cutFixed = tryRepairCp852Utf8Mojibake(cutBad);
  assert(cutFixed === cutGood, "trailing U+FFFD stripped: " + JSON.stringify(cutFixed));
  assert(!String(cutFixed).includes("\uFFFD"), "stripped result has no U+FFFD");
  const cutNorm = normalizeCjProductText(cutBad);
  assert(cutNorm.repaired === true && cutNorm.text === cutGood, "normalize strips trailing U+FFFD");
  assert(normalizeCjProductText(cutNorm.text).repaired === false, "trailing-FFFD repair idempotent");
  const midBad = toCp852Mojibake("Postel \uFFFD \u010delem");
  assert(tryRepairCp852Utf8Mojibake(midBad) === null, "middle U+FFFD refused");
  const mixed = "Postel s \u010delem " + toCp852Mojibake("\u00falo\u017en\u00fd prostor");
  const mixedN = normalizeCjProductText(mixed);
  assert(mixedN.repaired === true && mixedN.text === "Postel s \u010delem \u00falo\u017en\u00fd prostor", "mixed clean+mojibake: " + JSON.stringify(mixedN.text));
  assert(countBoxDrawing(mixedN.text) === 0, "mixed leaves no box");
  assert(normalizeCjProductText("ok\uFFFD").repaired === false, "lone U+FFFD is not stripped");
  const doc2 = { sections: [{ products: [{ title: "ok", ctaLabel: "Zobrazit v\u251c\u017brobek", imageUrl: "https://x/U\u2563\u00fc.jpg" }] }] };
  const p2 = normalizeOffersPublicDocTexts(doc2);
  assert(p2.otherFieldsRepaired === 1 && doc2.sections[0].products[0].ctaLabel === "Zobrazit v\u00fdrobek", "final pass ctaLabel");
  assert(doc2.sections[0].products[0].imageUrl === "https://x/U\u2563\u00fc.jpg", "final pass never touches URLs");
}

console.log(
  JSON.stringify({
    ok: true,
    schema: "iu-cj-affiliate-utf8-title-normalize-v51-8-selftest",
    samples: samples.length,
    finalPass: pass,
    win1252: true,
  })
);
