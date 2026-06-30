/**
 * Layout guard — PC informační panel V3 (umístění, navigace, gap, overlay).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const failures = [];

const indexHtml = read("projects/index.html");
const mountIdx = indexHtml.indexOf("id=\"iuDesktopInfoPanelMount\"");
const tallIdx = indexHtml.indexOf("id=\"iuSilverTallScrollSection\"");
if (mountIdx < 0) failures.push("missing #iuDesktopInfoPanelMount in index.html");
if (tallIdx < 0) failures.push("missing #iuSilverTallScrollSection in index.html");
if (mountIdx >= 0 && tallIdx >= 0 && mountIdx >= tallIdx) {
  failures.push("info panel mount must appear before HomeCards section in DOM");
}

if (!indexHtml.includes("iu-desktop-info-panel.css")) {
  failures.push("missing iu-desktop-info-panel.css link in index.html");
}
if (!indexHtml.includes("iu-desktop-info-panel.js")) {
  failures.push("missing iu-desktop-info-panel.js script in index.html");
}

const panelCss = read("assets/iu-desktop-info-panel.css");
if (!/max-width:\s*1024px/.test(panelCss) || !panelCss.includes("display: none")) {
  failures.push("panel CSS must hide mount at max-width 1024px");
}
if (!panelCss.includes("min-width: 1025px")) {
  failures.push("panel CSS must scope desktop rules to min-width 1025px");
}
if (!panelCss.includes("scrollbar-width: none")) {
  failures.push("panel CSS must hide horizontal scrollbar");
}
if (!panelCss.includes("iuDesktopInfoPanel__nav")) {
  failures.push("panel CSS must define arrow navigation buttons");
}
if (!panelCss.includes("--iu-dhp-info-panel-mindmenu-gap: 30px")) {
  failures.push("mindmenu gap token must be 30px");
}
if (!panelCss.includes("grid-row: 2")) {
  failures.push("panel mount must use grid-row 2 in desktop layout");
}
if (!panelCss.includes("grid-row: 3")) {
  failures.push("homecards must use grid-row 3 below info panel on desktop");
}
if (!panelCss.includes("--iu-dhp-homecards-mt-sync")) {
  failures.push("homecards must use synced top gap CSS variable");
}
if (!panelCss.includes("z-index: 10150")) {
  failures.push("detail overlay must use z-index above HomeCards (10150)");
}

const panelJs = read("assets/iu-desktop-info-panel.js");
if (!panelJs.includes("min-width: 1025px")) {
  failures.push("panel JS must gate on min-width 1025px");
}
if (!panelJs.includes("iu-desktop-home-grid")) {
  failures.push("panel JS must require iu-desktop-home-grid");
}
if (!panelJs.includes("getLoadingInfoPanelItems")) {
  failures.push("panel JS must show loading state before async fetch");
}
if (!panelJs.includes("syncMindMenuPanelGap")) {
  failures.push("panel JS must sync 30px gap from MindMenu button");
}
if (!panelJs.includes("data-iu-info-panel-nav")) {
  failures.push("panel JS must implement arrow navigation");
}
if (!panelJs.includes("document.body.appendChild(dlg)")) {
  failures.push("detail dialog must portal to document.body");
}
if (!panelJs.includes("data-iu-info-panel-ready")) {
  failures.push("panel JS must mark mount ready after data bind");
}
if (!panelJs.includes("iuDesktopInfoPanelLayoutSync")) {
  failures.push("panel JS must export layout sync for gap guards");
}

const panelData = read("assets/iu-desktop-info-panel-data.js");
const catalogCount = (panelData.match(/id:\s*"/g) || []).length;
if (catalogCount !== 9) {
  failures.push(`catalog must contain 9 items, found ${catalogCount}`);
}
if (!panelData.includes("Data nejsou aktuální")) {
  failures.push("data layer must handle stale state message");
}
if (panelData.includes("Zdroj se ověřuje")) {
  failures.push("catalog must not contain placeholder text Zdroj se ověřuje");
}
if (!panelData.includes("IU_INFO_PANEL_MINDMENU_GAP_PX")) {
  failures.push("data layer must export mindmenu gap constant");
}

const legalDoc = read("docs/data-sources/legal-review-info-panel.md");
if (!legalDoc.includes("Právní přehled zdrojů")) {
  failures.push("legal review doc missing");
}
if (!legalDoc.includes("verified_requires_attribution")) {
  failures.push("legal review doc must document verified sources");
}
if (!legalDoc.includes("DataStat")) {
  failures.push("legal review doc must document CSU DataStat sources");
}

if (!fs.existsSync(path.join(ROOT, "projects/data/info_panel_snapshot.json"))) {
  failures.push("missing projects/data/info_panel_snapshot.json");
}

if (failures.length) {
  console.error("IU_DESKTOP_INFO_PANEL_LAYOUT_GUARD_FAIL");
  failures.forEach((f) => console.error(f));
  process.exit(1);
}

console.log("IU_DESKTOP_INFO_PANEL_LAYOUT_GUARD_PASS");
console.log(`catalog_items=9`);
console.log(`mount_before_homecards=${mountIdx < tallIdx}`);
