#!/usr/bin/env node
import {
  normalizePriceAmount,
  classifyPriceTransition,
  reclassifyPriceChangeEvents,
  PRICE_CHANGE_CLASS,
} from "./iu-cj-affiliate-phase3z-price-normalize-v49.mjs";
import { mergeRefreshedProductIntoCard } from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function eqMinor(a, b, currency, msg) {
  const na = normalizePriceAmount(a, currency);
  const nb = normalizePriceAmount(b, currency);
  assert(na.ok && nb.ok, msg + " both ok");
  assert(na.minorUnits === nb.minorUnits, msg + ` minors ${na.minorUnits}!==${nb.minorUnits}`);
}

eqMinor("4490.00", 4490, "CZK", "4490.00=4490");
eqMinor("1299,00", 1299, "CZK", "1299,00=1299");
eqMinor("1 299,00", 1299, "CZK", "1 299,00=1299");
eqMinor("1,299.00", 1299, "USD", "1,299.00=1299");

assert(
  classifyPriceTransition(1299, 1199, "CZK", "CZK").class === PRICE_CHANGE_CLASS.PRICE_CHANGED,
  "1299→1199 changed"
);
assert(
  classifyPriceTransition(1199, 1299, "CZK", "CZK").class === PRICE_CHANGE_CLASS.PRICE_CHANGED,
  "1199→1299 changed"
);
assert(
  classifyPriceTransition("4490.00", 4490, "CZK", "CZK").class === PRICE_CHANGE_CLASS.FORMAT_ONLY,
  "format only"
);
assert(
  classifyPriceTransition(null, 1299, "CZK", "CZK").class === PRICE_CHANGE_CLASS.PRICE_UNKNOWN,
  "null→value unknown transition"
);
assert(
  classifyPriceTransition(1299, null, "CZK", "CZK").class === PRICE_CHANGE_CLASS.PRICE_UNKNOWN,
  "value→null unknown"
);
assert(
  classifyPriceTransition(100, 100, "CZK", "EUR").class === PRICE_CHANGE_CLASS.CURRENCY_CHANGED,
  "currency change"
);
assert(normalizePriceAmount("abc", "CZK").ok === false, "invalid text");
assert(normalizePriceAmount(-5, "CZK").ok === false, "negative");
assert(normalizePriceAmount(0, "CZK").ok === true, "zero allowed at normalize layer");
assert(normalizePriceAmount(1e20, "CZK").ok === false, "too high");
assert(normalizePriceAmount("1.299", "EUR").ok === false, "ambiguous EU/decimal");
assert(normalizePriceAmount(10, "XXX").ok === false || normalizePriceAmount(10, "XX").ok === false, "bad currency");
assert(normalizePriceAmount(10, "XX").classification === PRICE_CHANGE_CLASS.PRICE_INVALID, "invalid currency class");

const jpy = normalizePriceAmount(1000, "JPY");
assert(jpy.ok && jpy.exponent === 0 && jpy.minorUnits === 1000, "JPY exponent 0");

const sameIdDiffAdv = classifyPriceTransition(10, 12, "CZK", "CZK");
assert(sameIdDiffAdv.economicChange === true, "economic change");

assert(
  classifyPriceTransition("4490.00", "4490.00", "CZK", "CZK").class === PRICE_CHANGE_CLASS.PRICE_UNCHANGED,
  "identical raw unchanged"
);

const hist = reclassifyPriceChangeEvents([
  { advertiserId: "1", productId: "a", previousPrice: "4490.00", newPrice: 4490, currency: "CZK", changeClassification: "PRICE_DELTA" },
  { advertiserId: "1", productId: "b", previousPrice: 100, newPrice: 90, currency: "CZK", changeClassification: "PRICE_DELTA" },
  { advertiserId: "2", productId: "a", previousPrice: 50, newPrice: 50, currency: "EUR", changeClassification: "PRICE_DELTA" },
]);
assert(hist.counts.formatOnly === 1, "reclass format");
assert(hist.counts.priceChanged === 1, "reclass changed");
assert(hist.counts.unchanged === 1, "reclass unchanged");

// Merge must not stamp economic change for format-only
const mergedFmt = mergeRefreshedProductIntoCard(
  { advertiserId: "9", productId: "p1", currentPrice: "4490.00", currency: "CZK", availability: "in stock" },
  { currentPrice: 4490, currency: "CZK", availability: "in stock" },
  "2026-11-05T22:00:00.000Z"
);
assert(mergedFmt.priceChanged === false, "merge format-only not priceChanged");
assert(mergedFmt.card.priceChangedAt == null, "no priceChangedAt on format-only");
assert(mergedFmt.formatOnly === true, "formatOnly flag");

const mergedReal = mergeRefreshedProductIntoCard(
  { advertiserId: "9", productId: "p1", currentPrice: 100, currency: "CZK", availability: "in stock" },
  { currentPrice: 90, currency: "CZK", availability: "in stock" },
  "2026-11-05T22:00:00.000Z"
);
assert(mergedReal.priceChanged === true, "merge real change");
assert(mergedReal.card.previousPrice === 100, "previous stored");

const mergedCur = mergeRefreshedProductIntoCard(
  { currentPrice: 100, currency: "CZK", availability: "in stock" },
  { currentPrice: 100, currency: "EUR", availability: "in stock" },
  "2026-11-05T22:00:00.000Z"
);
assert(mergedCur.priceChanged === false, "currency change not PRICE_CHANGED");
assert(mergedCur.currencyChanged === true, "currencyChanged flag");

console.log(
  JSON.stringify({
    IU_CJ_PRICE_NORMALIZE_V49_SELFTEST: "PASS",
    formatOnly: PRICE_CHANGE_CLASS.FORMAT_ONLY,
    reclass: hist.counts,
  })
);
