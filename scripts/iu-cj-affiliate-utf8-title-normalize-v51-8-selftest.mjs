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

console.log(
  JSON.stringify({
    ok: true,
    schema: "iu-cj-affiliate-utf8-title-normalize-v51-8-selftest",
    samples: samples.length,
    finalPass: pass,
  })
);
