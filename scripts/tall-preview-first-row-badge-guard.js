/**
 * Hard guard: tall-window Zprávy + Sport first-row badges = section name only (no NOVÉ / LIVE).
 * Run: node scripts/tall-preview-first-row-badge-guard.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const appJsPath = path.join(ROOT, "assets", "app.js");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const appJs = fs.readFileSync(appJsPath, "utf8");

if (!/data-iu-news-preview-badge>Zprávy</.test(appJs)) {
  fail("❌ assets/app.js: news preview badge must be text Zprávy (data-iu-news-preview-badge>Zprávy)");
}
if (/data-iu-news-preview-badge>NOV[EÉ]</.test(appJs)) {
  fail("❌ assets/app.js: news preview must not use NOVÉ status badge text");
}
if (!/data-iu-sport-preview-live>Sport</.test(appJs)) {
  fail("❌ assets/app.js: sport preview live hook must show Sport (data-iu-sport-preview-live>Sport)");
}
if (/data-iu-sport-preview-live>LIVE</.test(appJs)) {
  fail("❌ assets/app.js: sport preview must not use LIVE status badge text");
}

console.log("✅ Tall preview first-row badge guard OK");
