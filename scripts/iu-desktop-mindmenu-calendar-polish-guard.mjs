/**
 * Guard — PC MindMenu mailbox grid, calendar fixed side slot, custom button single-open.
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
const appCss = read("assets/app.css");
const appJs = read("assets/app.js");
const premiumCss = read("assets/iu-desktop-home-premium.css");
const indexHtml = read("projects/index.html");

if (!/\.layout > aside\.accordionCol \.mindMenu \.iu-mailbox-row[\s\S]*display: grid !important/.test(appCss)) {
  failures.push("accordionCol mailbox row must use CSS grid on desktop");
}
if (!/grid-template-columns: minmax\(0, 1fr\) 36px 40px/.test(appCss)) {
  failures.push("accordionCol mailbox row must use 3-column grid (input | gear | social)");
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
if (!premiumCss.includes("iuMmManageTabs__tab.is-active") || !premiumCss.includes("data-iu-manage-action=\"unsave\"")) {
  failures.push("desktop premium CSS must enhance active tabs and Odebrat button");
}
if (!indexHtml.includes("desktop-mindmenu-calendar-polish-v1-20260706")) {
  failures.push("index.html cache bust token missing");
}

const pass = failures.length === 0;
process.stdout.write(JSON.stringify({ pass, failures }) + "\n");
if (!pass) process.exitCode = 1;
