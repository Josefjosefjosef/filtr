import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../assets/iu-affiliate-phase2-offers-v1.js", import.meta.url), "utf8");
const start = src.indexOf("  function classifyAvailability");
const end = src.indexOf("  function availabilityLabel");
assert.ok(start > 0 && end > start);
const classifyAvailability = new Function(src.slice(start, end) + "\nreturn classifyAvailability;")();

assert.equal(classifyAvailability("in stock"), "IN_STOCK");
assert.equal(classifyAvailability("skladem"), "IN_STOCK");
assert.equal(classifyAvailability("preorder"), "PREORDER");
assert.equal(classifyAvailability("backorder"), "BACKORDER");
assert.equal(classifyAvailability("not in stock"), "OUT_OF_STOCK");
assert.equal(classifyAvailability("not available"), "OUT_OF_STOCK");
assert.equal(classifyAvailability("unavailable"), "OUT_OF_STOCK");
assert.equal(classifyAvailability("není skladem"), "OUT_OF_STOCK");
assert.equal(classifyAvailability("neni skladem"), "OUT_OF_STOCK");
assert.equal(classifyAvailability("out of stock"), "OUT_OF_STOCK");

process.stdout.write("IU_CJ_NEGATED_AVAILABILITY_SELFTEST PASS\n");
