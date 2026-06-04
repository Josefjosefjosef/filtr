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

if (!/id="iuFinancePreviewCardMount"[\s\S]*?data-iu-finance-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Finance preview mount (#iuFinancePreviewCardMount + data-iu-finance-preview-mount)");
}

if (!/id="iuHealthPreviewCardMount"[\s\S]*?data-iu-health-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Zdraví preview mount (#iuHealthPreviewCardMount + data-iu-health-preview-mount)");
}

if (!/id="iuTravelPreviewCardMount"[\s\S]*?data-iu-travel-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Cestování preview mount (#iuTravelPreviewCardMount + data-iu-travel-preview-mount)");
}

if (!/id="iuGamesPreviewCardMount"[\s\S]*?data-iu-games-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Hry preview mount (#iuGamesPreviewCardMount + data-iu-games-preview-mount)");
}

if (!/id="iuCulturePreviewCardMount"[\s\S]*?data-iu-culture-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Kultura / Akce preview mount (#iuCulturePreviewCardMount + data-iu-culture-preview-mount)");
}

if (!/id="iuScienceHistoryPreviewCardMount"[\s\S]*?data-iu-science-history-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Věda & Historie preview mount (#iuScienceHistoryPreviewCardMount + data-iu-science-history-preview-mount)");
}

if (!/id="iuEducationPreviewCardMount"[\s\S]*?data-iu-education-preview-mount/.test(html)) {
  fail("❌ Silver tall viewport must include Vzdělávání preview mount (#iuEducationPreviewCardMount + data-iu-education-preview-mount)");
}

if (!/id="iuSilverParcelWatch"[\s\S]*?id="iuSilverParcelWatchInput"/.test(html)) {
  fail("❌ Silver parcel watch block must include #iuSilverParcelWatch + #iuSilverParcelWatchInput");
}

if (!/id="iuSilverParcelWatchSave"/.test(html)) {
  fail("❌ Silver parcel watch must expose #iuSilverParcelWatchSave");
}

if (!/iu-silver-parcel-dashboard\.css/.test(html)) {
  fail("❌ projects/index.html must link iu-silver-parcel-dashboard.css");
}

if (!/iu-silver-finance-home-card\.css/.test(html)) {
  fail("❌ projects/index.html must link iu-silver-finance-home-card.css");
}

if (!/id="iuSilverFinanceHomeCard"[\s\S]*?data-iuq="fincalc"/.test(html)) {
  fail("❌ Silver finance home card must include #iuSilverFinanceHomeCard with data-iuq=\"fincalc\"");
}

if (!/iu-silver-parcel-dashboard\.js/.test(html)) {
  fail("❌ projects/index.html must load iu-silver-parcel-dashboard.js after app.js");
}

if (html.indexOf("iuSilverCalendarSummaryShowDay") !== -1) {
  fail("❌ Calendar box3 must not render legacy CTA button (iuSilverCalendarSummaryShowDay)");
}

if (!/silver-calendar-summary-line2main[^>]*data-iu-action-indicator="chevron"/.test(html)) {
  fail("❌ Calendar box3 line2 must include action indicator hook (data-iu-action-indicator=\"chevron\")");
}

const calLabelMatches = html.match(/class="[^"]*\biuCalendarSummary__label\b[^"]*"/g) || [];
if (calLabelMatches.length !== 1) {
  fail("❌ Expected exactly one .iuCalendarSummary__label in projects/index.html (found " + calLabelMatches.length + ")");
}

if ((html.match(/\biuCalendarSummary__rest\b/g) || []).length !== 1) {
  fail("❌ Expected exactly one .iuCalendarSummary__rest / id iuSilverCalendarSummaryLine1Rest hook");
}

if (!/iu-mmTopTool--cal[^>]*\biuMindMenuButton\b/.test(html) && !/iuMindMenuButton[^>]*iu-mmTopTool--cal/.test(html)) {
  fail("❌ Mind Menu Kalendář button must combine .iu-mmTopTool--cal + .iuMindMenuButton");
}

if (!css.includes("/* === CALENDAR ACCENT HARD LOCK (DO NOT MODIFY) === */")) {
  fail("❌ assets/app.css must contain CALENDAR ACCENT HARD LOCK banner (anti-regression; EOF docs only — no duplicate rules)");
}

if (!/<span class="iuCalendarSummary__label">Kalendář:<\/span>/.test(html)) {
  fail("❌ Calendar label inner HTML must be exactly Kalendář: (single label span)");
}

if (!/id="iuSilverCalendarSummaryLine1Rest"/.test(html)) {
  fail("❌ Missing #iuSilverCalendarSummaryLine1Rest hook");
}

if (!/id="iuSilverCalendarSummaryCard"[\s\S]*?iuCalendarSummary__icon/.test(html)) {
  fail("❌ Calendar summary icon class must exist in markup under iuSilverCalendarSummaryCard");
}

const calSvg = html.match(/id="iuSilverCalendarSummaryCard"[\s\S]*?<\/svg>/);
if (!calSvg || (calSvg[0].match(/stroke-width="1\.6"/g) || []).length < 2) {
  fail("❌ Calendar summary SVG must keep baseline stroke-width=\"1.6\" (no optical thicken)");
}

const restBlock = css.match(/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__rest\s*\{([^}]*)\}/);
if (!restBlock || /color\s*:\s*#1c8748\b|color\s*:\s*var\(\s*--iu-calendar-accent\s*\)/.test(restBlock[1])) {
  fail("❌ #iuSilverCalendarSummaryCard .iuCalendarSummary__rest must not set accent green as text color (use inherit only)");
}

if (/--iu-calendar-accent\s*:\s*#15803d\b/.test(css)) {
  fail("❌ Retired #15803d for --iu-calendar-accent (too dark on Silver + Mind Menu surfaces)");
}

if (!/--iu-calendar-accent\s*:\s*#1c8748\b/.test(css)) {
  fail("❌ :root --iu-calendar-accent must be #1c8748 (lightened calendar/Mind Menu accent)");
}

if (!/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__label\s*\{[\s\S]*?font-weight\s*:\s*700\b/.test(css)) {
  fail("❌ #iuSilverCalendarSummaryCard .iuCalendarSummary__label must use font-weight: 700");
}

if (!/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__label\s*\{[\s\S]*?color\s*:\s*var\(--iu-calendar-accent\)/.test(css)) {
  fail("❌ Calendar summary label must use color: var(--iu-calendar-accent)");
}

if (!/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__icon\s*\{[\s\S]*?color\s*:\s*var\(--iu-calendar-accent\)/.test(css)) {
  fail("❌ Calendar summary icon must use color: var(--iu-calendar-accent)");
}

if (!/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__icon\s*\{[\s\S]*?font-weight\s*:\s*400\b/.test(css)) {
  fail("❌ Calendar summary icon must use font-weight: 400 (not bold)");
}

if (!/#iuSilverCalendarSummaryCard\s+\.iuCalendarSummary__rest\s*\{[\s\S]*?color\s*:\s*inherit/.test(css)) {
  fail("❌ .iuCalendarSummary__rest must keep color: inherit (body of line not green)");
}

if (!/\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s*\{[\s\S]*?background-color\s*:\s*var\(--iu-calendar-accent\)/.test(css)) {
  fail("❌ Mind Menu calendar button must use background-color: var(--iu-calendar-accent)");
}

if (!/\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s*\{[\s\S]*?color\s*:\s*#fff(?:fff)?\b\s*!important/.test(css)) {
  fail("❌ Mind Menu calendar button must set color: #fff or #ffffff !important (readable on accent; cascade lock)");
}

if (
  !/\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s+\.iu-mmTopToolText\s*,\s*\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s+\.iu-mmTopToolIcon\s*\{[\s\S]*?color\s*:\s*#fff(?:fff)?\b/.test(
    css
  )
) {
  fail("❌ Mind Menu calendar button text + icon must force color: #fff/#ffffff (readable on accent)");
}

if (
  !/\.accordionCol\s+\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s+\.iu-mmTopToolText\s*,\s*\.accordionCol\s+\.mindMenu\s+\.iu-mmTopTool--cal\.iuMindMenuButton\s+\.iu-mmTopToolIcon\s*\{[\s\S]*?color\s*:\s*#fff(?:fff)?\b/.test(
    css
  )
) {
  fail("❌ Mind Menu calendar button text + icon must stay #fff/#ffffff under .accordionCol");
}

console.log("✅ Silver stack guard OK");
