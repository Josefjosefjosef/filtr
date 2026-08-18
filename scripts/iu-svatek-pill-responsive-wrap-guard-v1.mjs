#!/usr/bin/env node
/**
 * Guard: svátek pill — label+pill stay inline for namedays; state holidays may wrap when long.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppRuntimeSrc } from "./guards/iu-app-runtime-src.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "projects", "index.html");
const APP_CSS = path.join(ROOT, "assets", "app.css");
const DHP_CSS = path.join(ROOT, "assets", "iu-desktop-home-premium.css");
const RUNTIME_JS = Symbol("runtime");

const CHECKS = [
  {
    id: "index_meta_flex_wrap",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMeta\{display:flex;flex-wrap:wrap/,
  },
  {
    id: "index_svatek_cluster_inline_flex",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMetaSvatekCluster\{display:inline-flex;flex-wrap:nowrap/,
  },
  {
    id: "index_svatek_cluster_state_holiday_wrap",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMetaSvatekCluster--stateHoliday\{flex-wrap:wrap\}/,
  },
  {
    id: "index_svatek_label_before_sep",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMetaSvatekLabel::before\{content:" · "\}/,
  },
  {
    id: "index_no_svatek_icon_css",
    file: INDEX,
    pattern: /\.svatek-icon/,
    invert: true,
  },
  {
    id: "app_css_meta_wrap",
    file: APP_CSS,
    pattern: /\.iuSilverWelcomeMeta\{[\s\S]*?flex-wrap:\s*wrap/,
  },
  {
    id: "app_css_cluster_inline_flex",
    file: APP_CSS,
    pattern: /\.iuSilverWelcomeMetaSvatekCluster\{[\s\S]*?display:\s*inline-flex[\s\S]*?flex-wrap:\s*nowrap/,
  },
  {
    id: "app_css_mobile_cluster_inline_flex",
    file: APP_CSS,
    pattern: /@media \(max-width: 768px\)[\s\S]*?\.iuSilverWelcomeMetaSvatekCluster[\s\S]*?display:\s*inline-flex[\s\S]*?flex-wrap:\s*nowrap/,
  },
  {
    id: "dhp_desktop_row_wrap",
    file: DHP_CSS,
    pattern: /body\.iu-desktop-home-grid #silver-slot #iuSilverWelcomeCard \.iuSilverWelcomeMeta \{[\s\S]*?flex-direction:\s*row[\s\S]*?flex-wrap:\s*wrap/,
  },
  {
    id: "dhp_desktop_svatek_inline_flex",
    file: DHP_CSS,
    pattern: /body\.iu-desktop-home-grid #silver-slot #iuSilverWelcomeCard \.iuSilverWelcomeMetaSvatekCluster \{[\s\S]*?display:\s*inline-flex[\s\S]*?flex-wrap:\s*nowrap/,
  },
  {
    id: "dhp_desktop_svatek_cluster_gap_4px",
    file: DHP_CSS,
    pattern: /body\.iu-desktop-home-grid #silver-slot #iuSilverWelcomeCard \.iuSilverWelcomeMetaSvatekCluster \{[\s\S]*?gap:\s*4px/,
  },
  {
    id: "js_state_holiday_cluster_class",
    file: RUNTIME_JS,
    pattern: /iuSilverWelcomeMetaSvatekCluster--stateHoliday/,
  },
  {
    id: "index_dhp_css_bump",
    file: INDEX,
    pattern: /pc-svatek-label-pill-gap-4px-20260713/,
  },
  {
    id: "js_no_svatek_icon_element",
    file: RUNTIME_JS,
    pattern: /spanIcon\.className\s*=\s*"svatek-icon"/,
    invert: true,
  },
];

function main() {
  const runtime = readAppRuntimeSrc(ROOT);
  const checks = CHECKS.map((item) => {
    const src = item.file === RUNTIME_JS ? runtime : fs.readFileSync(item.file, "utf8");
    const hit = item.pattern.test(src);
    const pass = item.invert ? !hit : hit;
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  const out = { pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) };
  process.stdout.write(JSON.stringify(out) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
