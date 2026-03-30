/**
 * Silver dashboard stack guard: CTA source class, weather collapse CSS, spacing system.
 * Run: node scripts/silver-stack-guard.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const cssPath = path.join(ROOT, "assets", "app.css");
const htmlPath = path.join(ROOT, "projects", "index.html");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const css = fs.readFileSync(cssPath, "utf8");
const html = fs.readFileSync(htmlPath, "utf8");

if (!/\.silver-welcome-stack\s*\{[\s\S]*?gap\s*:\s*0\b/.test(css)) {
  fail("❌ .silver-welcome-stack must use gap: 0 (spacing via divider + padding only)");
}

if (!/--iuSilverStackPad(?:X|Y)\s*:/.test(css)) {
  fail("❌ Missing --iuSilverStackPadX / --iuSilverStackPadY on stack");
}

if (/--iuSilverStackRowMinH\b|--iuSilverStackRowExtra\b/.test(css)) {
  fail("❌ Forbidden --iuSilverStackRowMinH / --iuSilverStackRowExtra (small stack rows are content-driven)");
}

if (/--iuSilverStackThird(MinH|Lift)\b/.test(css)) {
  fail("❌ Forbidden --iuSilverStackThirdMinH / --iuSilverStackThirdLift");
}

if (/--iu-tablet-wx-extra\b|--iu-tablet-cal-extra\b/.test(css)) {
  fail("❌ Split tablet wx/cal extras forbidden");
}

if (!/#silver-slot\s+#iuSilverWeatherCard\.silver-weather-card[\s\S]*?padding-top:\s*5px/.test(css)) {
  fail("❌ #silver-slot small stack cards must use padding-top: 5px");
}

if (!/#silver-slot\s+#iuSilverWeatherCard\.silver-weather-card[\s\S]*?min-height:\s*unset/.test(css)) {
  fail("❌ #silver-slot small stack cards must use min-height: unset (no row band)");
}

if (!/#silver-slot\s+#iuSilverTallScrollViewport[\s\S]*?min-height:\s*0\b/.test(css)) {
  fail("❌ #silver-slot #iuSilverTallScrollViewport must use min-height: 0 (flex inner scroll)");
}

if (!/#silver-slot\s+#iuSilverTallScrollViewport[\s\S]*?max-height:\s*none\b/.test(css)) {
  fail("❌ #silver-slot #iuSilverTallScrollViewport must set max-height: none");
}

if (!/#silver-slot\s+#iuSilverTallScrollSection\s*\{[\s\S]*?flex:\s*1\s+1\s+auto\b/.test(css)) {
  fail("❌ #silver-slot #iuSilverTallScrollSection must use flex: 1 1 auto (sole remainder; min-height 0)");
}

if (!/#silver-slot\s+#iuSilverTallScrollSection\s*\{[\s\S]*?min-height:\s*0\b/.test(css)) {
  fail("❌ #silver-slot #iuSilverTallScrollSection must use min-height: 0");
}

if (!/#silver-slot\s+#iuSilverWelcomeStack\s*\{[\s\S]*?height:\s*100%/.test(css)) {
  fail("❌ #silver-slot #iuSilverWelcomeStack must use height: 100% (column fills slot)");
}

if (!/max-height:\s*calc\(var\(--iu-silver-slot-max-h\)\s*-\s*4px\)/.test(css)) {
  fail("❌ #silver-slot max-height must be calc(var(--iu-silver-slot-max-h) - 4px) only (no vh/dvh fallback)");
}

const hiddenBlock = css.match(/\.silver-weather-actions\[hidden\]\s*\{([\s\S]*?)\}/);
if (!hiddenBlock || !/display\s*:\s*none\b/.test(hiddenBlock[1])) {
  fail("❌ .silver-weather-actions[hidden] must use display: none (collapse, no reserved space)");
}

if (/\.iuSilverWelcomeSticky\s*\{[\s\S]*?min-height\s*:\s*(300|400)px\b/.test(css)) {
  fail("❌ Remove fixed min-height (300/400px) from .iuSilverWelcomeSticky");
}

if (!/\.iuSilverWelcomeCard\s*\{[\s\S]*?min-height\s*:\s*0\b/.test(css)) {
  fail("❌ .iuSilverWelcomeCard should use min-height: 0 (content-driven)");
}

if (!/\.silver-weather-card\s*\{[\s\S]*?min-height\s*:\s*0\b/.test(css)) {
  fail("❌ .silver-weather-card should use min-height: 0 (content-driven)");
}

const sepCount = (html.match(/silver-welcome-stack__separator/g) || []).length;
if (sepCount < 2) {
  fail("❌ projects/index.html: expected ≥2 .silver-welcome-stack__separator between stack boxes");
}

if (html.indexOf("silver-weather-btn") < 0) {
  fail("❌ Missing silver-weather-btn in projects/index.html");
}

if (!/<button[^>]*class="[^"]*\bsilver-weather-btn\b[^"]*\biu-nameday-wish\b/.test(html)) {
  fail("❌ Box1 nameday CTA must combine .silver-weather-btn + .iu-nameday-wish on one button");
}

if (!/iuSilverWeatherBtnGeo[\s\S]*?silver-weather-btn/.test(html)) {
  fail("❌ Weather CTA must use .silver-weather-btn");
}

if (!/data-iu-silver-wx-layout/.test(html)) {
  fail("❌ Weather card must expose data-iu-silver-wx-layout (setup vs ready) for stack contract");
}

if (html.indexOf("iuSilverCalendarSummaryShowDay") !== -1) {
  fail("❌ Calendar box3 must not render legacy CTA button (iuSilverCalendarSummaryShowDay)");
}

if (!/silver-calendar-summary-line2main[^>]*data-iu-action-indicator="chevron"/.test(html)) {
  fail("❌ Calendar box3 line2 must include action indicator hook (data-iu-action-indicator=\"chevron\")");
}

console.log("✅ Silver stack guard OK");
