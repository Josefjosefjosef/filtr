/**
 * Guard — MindMenu must not reintroduce Uložené/Skryté články;
 * PC dashboard stays 2-col with emails 38fr + tools 62fr.
 * Run: npm run iu-mindmenu-articles-section-removed-guard
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
const appJs = readAppRuntimeSrc(ROOT);
const appCss = read("assets/app.css");
const overlayCss = read("assets/iu-myinfouzel-premium-overlay.css");
const homePremiumCss = read("assets/iu-desktop-home-premium.css");
const indexHtml = read("projects/index.html");

const bannedJsSnippets = [
  'class="iuMyInfoUzelDashboard__col iuMyInfoUzelDashboard__col--saved"',
  'id="iuMmArticleActionsSections"',
  "iuArticleActionsEnsureMindMenuSections",
  ">Uložené články</button>",
  ">Skryté články</button>",
  ">Moje články</div>",
  'aria-label="Moje články"',
  'aria-label="Moje články a témata"',
];

for (const snippet of bannedJsSnippets) {
  if (appJs.includes(snippet)) {
    failures.push(`assets/app.js must not contain MindMenu articles UI: ${snippet}`);
  }
}

if (!appJs.includes("iuArticleActionsRemoveMindMenuArticleSections")) {
  failures.push("assets/app.js must keep RemoveMindMenuArticleSections cleanup");
}

if (!/grid-template-columns:\s*minmax\(300px,\s*38fr\)\s+minmax\(440px,\s*62fr\)/.test(overlayCss)) {
  failures.push("PC MindMenu dashboard must be 2-col: emails 38fr + tools 62fr");
}

if (/minmax\(220px,\s*31fr\)\s+minmax\(220px,\s*31fr\)/.test(overlayCss)) {
  failures.push("PC MindMenu dashboard must not keep old 3-col 31fr/31fr tools+saved split");
}

if (overlayCss.includes(".iuMyInfoUzelDashboard__col--saved")) {
  failures.push("iu-myinfouzel-premium-overlay.css must not style __col--saved");
}

if (homePremiumCss.includes(".iuMmManageTabs")) {
  failures.push("iu-desktop-home-premium.css must not keep iuMmManageTabs styles");
}

if (/#iuMindMenuView\s+\.iu-mmArticleActionsSections[\s\S]{0,80}background:/.test(appCss)) {
  failures.push("app.css must not restyle MindMenu Moje články card");
}

if (!indexHtml.includes("mindmenu-articles-removed-v1-20260803")) {
  failures.push("index.html cache bust token mindmenu-articles-removed-v1-20260803 missing");
}

if (!/\.iuMyInfoUzelMindMenuHost \.mindMenu \.iu-mailbox-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) 36px 40px/.test(overlayCss)) {
  failures.push("left MindMenuHost mailbox grid must stay unchanged");
}

if (!/\.iuMyInfoUzelDashboard__col--emails[\s\S]*padding: 14px 14px 16px/.test(overlayCss)) {
  failures.push("left emails column padding must stay unchanged");
}

const pass = failures.length === 0;
process.stdout.write(JSON.stringify({ pass, failures }) + "\n");
if (!pass) process.exitCode = 1;
