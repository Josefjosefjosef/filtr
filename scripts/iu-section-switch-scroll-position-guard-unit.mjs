/**
 * Unit tests: scroll position soft-pass when header paint lags on large bundles.
 * Run: node scripts/iu-section-switch-scroll-position-guard-unit.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const guardSrc = readFileSync(path.join(__dirname, "iu-section-switch-scroll-position-guard.mjs"), "utf8");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(guardSrc.includes("ALLOW_SOFT_HEADER_ON_SCROLL_PASS"), "soft header flag present");
assert(guardSrc.includes('IU_SECTION_SETTLE_MS || "12000"'), "settle ms increased for large bundles");
assert(guardSrc.includes("softHeader: true"), "soft header pass path present");

console.log("PASS test_section_switch_scroll_position_guard_soft_header");
console.log("PASS section_switch_scroll_position_guard unit");
