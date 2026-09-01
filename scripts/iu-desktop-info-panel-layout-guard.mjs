/**
 * Layout guard — PC informační panel V3 (umístění, navigace, gap, overlay).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  IU_INFO_PANEL_CATALOG,
  IU_INFO_PANEL_CATALOG_COUNT,
  IU_INFO_PANEL_ORDER_IDS,
  IU_INFO_PANEL_EXCLUDED,
} from "../assets/iu-desktop-info-panel-catalog.js";

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
if (!panelData.includes("IU_INFO_PANEL_CATALOG_COUNT")) {
  failures.push("data layer must export catalog count constant");
}
if (IU_INFO_PANEL_CATALOG_COUNT < 7) {
  failures.push(`catalog must contain at least 7 items, found ${IU_INFO_PANEL_CATALOG_COUNT}`);
}
const catalogIds = IU_INFO_PANEL_CATALOG.map((item) => item.id);
if (catalogIds.length !== IU_INFO_PANEL_CATALOG_COUNT) {
  failures.push("catalog count constant mismatch");
}
if (catalogIds.join("|") !== IU_INFO_PANEL_ORDER_IDS.join("|")) {
  failures.push("catalog order ids mismatch");
}
for (let i = 1; i < IU_INFO_PANEL_CATALOG.length; i++) {
  if (IU_INFO_PANEL_CATALOG[i].order < IU_INFO_PANEL_CATALOG[i - 1].order) {
    failures.push("catalog must be sorted by order field");
    break;
  }
}
if (IU_INFO_PANEL_CATALOG.some((item) => !item.sourceName || !item.termsUrl || !item.licenseNote)) {
  failures.push("catalog items must include legal metadata for source dialog");
}
if (IU_INFO_PANEL_CATALOG.some((item) => !item.maxAgeMs || !item.updateNote)) {
  failures.push("catalog items must define stale/update metadata");
}
if (catalogIds.includes("trains") || catalogIds.includes("aviation")) {
  failures.push("removed proxy cards trains/aviation must not be in catalog");
}
if (catalogIds.includes("environment")) {
  failures.push("removed environment indicator must not be in catalog");
}
if (!IU_INFO_PANEL_EXCLUDED.length) {
  failures.push("excluded source list must be documented");
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

if (!panelJs.includes("buildSourcesRow")) {
  failures.push("panel JS must render unified sources row");
}
if (panelJs.includes("iuDesktopInfoPanel__legal")) {
  failures.push("panel JS must not render disclaimer on main panel (detail dialog only)");
}
if (!panelJs.includes("showScrollHint")) {
  failures.push("panel JS must support mobile scroll hint");
}
if (!panelData.includes("bucketFetchedAt")) {
  failures.push("data layer must use bucketFetchedAt for per-source freshness");
}
if (!panelJs.includes("getInfoPanelUserContent")) {
  failures.push("panel JS must use user-facing dialog content");
}
if (IU_INFO_PANEL_CATALOG.some((item) => !item.title || !item.publishFrequency || !item.providerShortName)) {
  failures.push("catalog items must include title, publishFrequency and providerShortName");
}
if (!fs.existsSync(path.join(ROOT, "assets/iu-info-panel-user-content.js"))) {
  failures.push("missing assets/iu-info-panel-user-content.js");
}
if (!fs.existsSync(path.join(ROOT, "scripts/info_panel_scheduler.mjs"))) {
  failures.push("missing scripts/info_panel_scheduler.mjs");
}
if (!fs.existsSync(path.join(ROOT, "projects/data/info_panel_scheduler_state.json"))) {
  failures.push("missing projects/data/info_panel_scheduler_state.json");
}

if (!panelCss.includes("iuDesktopInfoPanel__sources")) {
  failures.push("panel CSS must define unified sources row");
}
if (!panelCss.includes("text-overflow: unset")) {
  failures.push("panel CSS must allow full label visibility (no ellipsis clipping)");
}

const mobileCss = read("assets/iu-mobile-info-panel.css");
if (!mobileCss.includes("max-height: none")) {
  failures.push("mobile panel CSS must use auto height (max-height none)");
}
if (!mobileCss.includes("iuDesktopInfoPanel__sources")) {
  failures.push("mobile panel CSS must style sources row");
}
if (!mobileCss.includes("iuDesktopInfoPanel__scrollHint")) {
  failures.push("mobile panel CSS must define horizontal scroll hint");
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
console.log(`catalog_items=${IU_INFO_PANEL_CATALOG_COUNT}`);
console.log(`mount_before_homecards=${mountIdx < tallIdx}`);
