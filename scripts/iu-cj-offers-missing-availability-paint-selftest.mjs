import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../assets/iu-affiliate-phase2-offers-v1.js", import.meta.url), "utf8");
const start = src.indexOf("  function classifyAvailability");
const end = src.indexOf("  function availabilityLabel");
assert.ok(start > 0 && end > start);
const fn = new Function(src.slice(start, end) + "\nreturn { classifyAvailability, availabilityAllowsPublicPaint };");
const api = fn();

assert.equal(api.availabilityAllowsPublicPaint(null), false);
assert.equal(api.availabilityAllowsPublicPaint(""), false);
assert.equal(api.availabilityAllowsPublicPaint("   "), false);
assert.equal(api.availabilityAllowsPublicPaint("out of stock"), false);
assert.equal(api.availabilityAllowsPublicPaint("not-a-status"), false);
assert.equal(api.availabilityAllowsPublicPaint("in stock"), true);
assert.equal(api.availabilityAllowsPublicPaint("preorder"), true);
assert.equal(api.availabilityAllowsPublicPaint("backorder"), true);
assert.equal(api.classifyAvailability("preorder"), "PREORDER");
assert.equal(api.classifyAvailability("backorder"), "BACKORDER");
assert.equal(api.classifyAvailability(null), "UNKNOWN_NULL");

process.stdout.write("IU_CJ_MISSING_AVAILABILITY_PAINT_SELFTEST PASS\n");
