/**
 * Guard — PC MindMenu mailbox grid, calendar fixed side slot, custom button single-open.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readAppRuntimeSrc } from "./guards/iu-app-runtime-src.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const failures = [];
const appCss = read("assets/app.css");
const appJs = readAppRuntimeSrc(ROOT);
const tasksCss = read("assets/iu-tasks-premium.css");
const overlayCss = read("assets/iu-myinfouzel-premium-overlay.css");
const indexHtml = read("projects/index.html");

if (!/\.layout > aside\.accordionCol \.mindMenu \.iu-mailbox-row[\s\S]*display: grid !important/.test(appCss)) {
  failures.push("accordionCol mailbox row must use CSS grid on desktop");
}
if (!/grid-template-columns: minmax\(0, 1fr\) 36px 40px/.test(appCss)) {
  failures.push("accordionCol mailbox row must use 3-column grid (input | gear | social)");
}
if (!/\.layout > aside\.accordionCol \.mindMenu \.iu-mailbox-row[\s\S]*gap: 5px !important/.test(appCss)) {
  failures.push("desktop mailbox row must use 5px gap between input, gear, and social");
}
if (!/\.layout > aside\.accordionCol \.mindMenu \.iu-mailbox-gear[\s\S]*grid-column: 2/.test(appCss)) {
  failures.push("desktop mailbox gear must be grid column 2 outside pill");
}
if (/\.mindMenu \.iu-mailbox-gear\{width:32px!important;[\s\S]*border:1px solid rgba\(15,23,42,\.1\)/.test(appCss) && !/@media \(max-width: 1024px\)\{[\s\S]*\.mindMenu \.iu-mailbox-gear\{width:32px!important;[\s\S]*border:1px solid rgba\(15,23,42,\.1\)/.test(appCss)) {
  failures.push("mobile mailbox gear card styling must stay scoped to max-width 1024px");
}
if (!/flex-direction: column/.test(appCss) || !appCss.includes("#iuMailboxControls")) {
  failures.push("mailbox add/remove controls must stack vertically on desktop");
}
if (!appJs.includes("iuQuickToolsBindCustomTileClickOnce")) {
  failures.push("custom quicktool tiles must bind single delegated click handler");
}
if (!appJs.includes('createElement("button")') || !appJs.includes("data-iu-custom-url")) {
  failures.push("custom quicktool tiles must use button + data-iu-custom-url (not anchor target=_blank)");
}
if (!appJs.includes("__iuMindMenuLastExternalOpen")) {
  failures.push("external URL open must dedupe rapid duplicate opens");
}
if (!appJs.includes("iu-calendarOverlay__side--layoutEmpty")) {
  failures.push("calendar desktop side panel must reserve fixed slot via layoutEmpty class");
}
if (!appJs.includes("grid-template-columns:minmax(0,1fr) 340px")) {
  failures.push("calendar desktop body grid must use fixed 340px side column");
}
if (indexHtml.includes("iu-calendarOverlay--sidePanelOpen") && indexHtml.includes("1.15fr")) {
  failures.push("calendar sidePanelOpen must not override body grid with fractional columns");
}
if (!appJs.includes("iu-tasksOverlay__body{display:grid!important;grid-template-columns:450px minmax(0,1fr)!important")) {
  failures.push("tasks desktop overlay must use 450px + detail two-column grid like notes");
}
if (!appJs.includes("iuTasksDetail") || !appJs.includes("isTasksDesktopTwoPanel")) {
  failures.push("tasks overlay must split list and detail panels on desktop");
}
if (!tasksCss.includes("iu-tasksOverlay__body") || !tasksCss.includes("grid-template-columns:450px minmax(0,1fr)")) {
  failures.push("tasks premium CSS must define desktop two-column body grid");
}
if (!/\.iuMyInfoUzelMindMenuHost \.mindMenu \.iu-mailbox-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 36px 40px/.test(overlayCss)) {
  failures.push("MyInfoUzel PC mailbox row must use 1fr pill + gear + social grid");
}
if (!/\.iuMyInfoUzelMindMenuHost \.mindMenu \.iu-mailbox-row[\s\S]*gap: 5px !important/.test(overlayCss)) {
  failures.push("MyInfoUzel PC mailbox row must use 5px gap");
}
if (!/\.iuMyInfoUzelMindMenuHost \.mindMenu \.iu-mailbox-pill[\s\S]*min-width: 0 !important/.test(overlayCss)) {
  failures.push("MyInfoUzel PC mailbox pill must shrink with min-width 0");
}
if (!/\.iuMyInfoUzelMindMenuHost \.mindMenu \.iu-mailbox-row \.iu-mailbox-gear[\s\S]*background: transparent !important/.test(overlayCss)) {
  failures.push("MyInfoUzel PC mailbox gear must stay visually outside pill");
}
if (!/grid-template-columns: minmax\(300px, 38fr\)/.test(overlayCss)) {
  failures.push("MyInfoUzel dashboard must widen emails column on PC");
}
if (!/contain: layout style/.test(appCss) || !/isolation: isolate/.test(appCss)) {
  failures.push("desktop accordionCol mailbox pill must contain background inside grid cell");
}
const cacheBustOk =
  indexHtml.includes("weather-artifact-utf8-eager-boot-v1-20260706") ||
  indexHtml.includes("legal-docs-preview-pc-v1-20260706") ||
  indexHtml.includes("tasks-desktop-two-panel-v1-20260706") ||
  indexHtml.includes("mindmenu-mailbox-pc-pill-gear-gap-v1-20260707") ||
  indexHtml.includes("mindmenu-mailbox-gear-track-v1-20260707") ||
  indexHtml.includes("mindmenu-mailbox-row-pc-layout-v1-20260706") ||
  indexHtml.includes("desktop-mindmenu-calendar-polish-v1-20260706") ||
  indexHtml.includes("svatek-pill-responsive-wrap-v1-20260706") ||
  indexHtml.includes("svatek-pill-inline-layout-v1-20260707") ||
  indexHtml.includes("state-holiday-label-v1-20260706") ||
  indexHtml.includes("ds-mobile-scroll-bottom-clearance-v1-20260707") ||
  indexHtml.includes("legal-docs-hub-header-single-row-v1-20260707") ||
  indexHtml.includes("desktop-left-rail-section-close-v1-20260707") ||
  indexHtml.includes("bakalari-card-count-persist-v1-20260707");
if (!cacheBustOk) {
  failures.push("index.html cache bust token missing");
}

const pass = failures.length === 0;
process.stdout.write(JSON.stringify({ pass, failures }) + "\n");
if (!pass) process.exitCode = 1;
