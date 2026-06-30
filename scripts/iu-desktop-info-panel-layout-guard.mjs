/**
 * Layout guard — PC informační panel V2 (umístění, desktop-only, soubory).
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
if (!panelCss.includes("overflow-x: auto")) {
  failures.push("panel CSS must use internal horizontal scroll");
}
if (!panelCss.includes("grid-row: 2")) {
  failures.push("panel mount must use grid-row 2 in desktop layout");
}
if (!panelCss.includes("grid-row: 3")) {
  failures.push("homecards must use grid-row 3 below info panel on desktop");
}
if (!panelCss.includes("margin-top: 30px")) {
  failures.push("homecards must have 30px top gap below info panel");
}
if (!panelCss.includes("--iu-dhp-homecards-top-gap: 30px")) {
  failures.push("desktop homecards top gap token must be 30px");
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

const panelData = read("assets/iu-desktop-info-panel-data.js");
const catalogCount = (panelData.match(/id:\s*"/g) || []).length;
if (catalogCount !== 9) {
  failures.push(`catalog must contain 9 items, found ${catalogCount}`);
}
if (!panelData.includes("Data nejsou aktuální")) {
  failures.push("data layer must handle stale state message");
}

const legalDoc = read("docs/data-sources/legal-review-info-panel.md");
if (!legalDoc.includes("Právní přehled zdrojů")) {
  failures.push("legal review doc missing");
}
if (!legalDoc.includes("verified_requires_attribution")) {
  failures.push("legal review doc must document verified sources");
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
