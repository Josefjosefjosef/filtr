import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../assets/iu-affiliate-phase2-offers-v1.js", import.meta.url), "utf8");
const start = src.indexOf("function iuAffiliateWindowPlan");
const end = src.indexOf("try {\n    window.iuAffiliateWindowPlan");
assert.ok(start > 0 && end > start);
const fn = new Function(src.slice(start, end) + "\nreturn iuAffiliateWindowPlan;");
const iuAffiliateWindowPlan = fn();

const oldHeight = 608172;
const wide = iuAffiliateWindowPlan({
  count: 2764,
  columns: 6,
  rowHeight: 220,
  windowSize: 48,
  scrollIntoList: 0,
});
assert.ok(wide.totalPx < oldHeight / 4, wide.totalPx);
assert.equal(wide.start, 0);
assert.equal(wide.end, 48);
assert.equal(wide.topPx, 0);

const mid = iuAffiliateWindowPlan({
  count: 500,
  columns: 4,
  rowHeight: 220,
  windowSize: 48,
  scrollIntoList: 20 * 220,
});
assert.equal(mid.start, 80);
assert.ok(mid.end - mid.start <= 48);
assert.equal(mid.totalPx, 125 * 220);
assert.ok(mid.start <= 80 && 80 < mid.end);

const seen = new Set();
const count = 500;
const columns = 4;
for (let i = 0; i < count; i += 1) {
  const row = Math.floor(i / columns);
  const plan = iuAffiliateWindowPlan({
    count,
    columns,
    rowHeight: 220,
    windowSize: 48,
    scrollIntoList: row * 220,
  });
  assert.ok(plan.start <= i && i < plan.end, String(i));
  assert.equal(plan.start % columns, 0);
  for (let k = plan.start; k < plan.end; k += 1) seen.add(k);
}
assert.equal(seen.size, count);

assert.equal(src.includes("IntersectionObserver"), false);
assert.equal(src.includes("spacer.style.height = prev + h"), false);
assert.equal(src.includes("iu-offers-section-last-good-v1"), true);
const planStart = src.indexOf("function offersOfflinePaintPlan");
const planEnd = src.indexOf("function lastGoodRequest");
assert.ok(planStart > 0 && planEnd > planStart);
const offersOfflinePaintPlan = new Function(src.slice(planStart, planEnd) + "\nreturn offersOfflinePaintPlan;")();
assert.equal(offersOfflinePaintPlan(true, false), "LAST_GOOD");
assert.equal(offersOfflinePaintPlan(false, true), "KEEP");
assert.equal(offersOfflinePaintPlan(false, false), "NOTICE");

console.log(JSON.stringify({
  IU_CJ_OFFERS_WINDOW_SELFTEST: "PASS",
  wideTotalPx: wide.totalPx,
  oldMeasuredPx: oldHeight,
  reachable: seen.size,
}));
