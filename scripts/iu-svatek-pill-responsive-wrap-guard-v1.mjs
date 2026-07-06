#!/usr/bin/env node
/**
 * Guard: svátek pill wraps to new line only when row lacks space (flex-wrap + display:contents).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "projects", "index.html");
const APP_CSS = path.join(ROOT, "assets", "app.css");
const DHP_CSS = path.join(ROOT, "assets", "iu-desktop-home-premium.css");

const CHECKS = [
  {
    id: "index_meta_flex_wrap",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMeta\{display:flex;flex-wrap:wrap/,
  },
  {
    id: "index_svatek_cluster_contents",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMetaSvatekCluster\{display:contents\}/,
  },
  {
    id: "index_svatek_label_before_sep",
    file: INDEX,
    pattern: /\.iuSilverWelcomeMetaSvatekLabel::before\{content:" · "\}/,
  },
  {
    id: "app_css_meta_wrap",
    file: APP_CSS,
    pattern: /\.iuSilverWelcomeMeta\{[\s\S]*?flex-wrap:\s*wrap/,
  },
  {
    id: "app_css_mobile_no_nowrap_force",
    file: APP_CSS,
    pattern: /@media \(max-width: 768px\)[\s\S]*?\.iuSilverWelcomeMeta[\s\S]*?flex-wrap:\s*wrap[\s\S]*?display:\s*contents/,
  },
  {
    id: "dhp_desktop_row_wrap",
    file: DHP_CSS,
    pattern: /body\.iu-desktop-home-grid #silver-slot #iuSilverWelcomeCard \.iuSilverWelcomeMeta \{[\s\S]*?flex-direction:\s*row[\s\S]*?flex-wrap:\s*wrap/,
  },
  {
    id: "dhp_desktop_svatek_contents",
    file: DHP_CSS,
    pattern: /body\.iu-desktop-home-grid #silver-slot #iuSilverWelcomeCard \.iuSilverWelcomeMetaSvatekCluster \{[\s\S]*?display:\s*contents/,
  },
];

function main() {
  const checks = CHECKS.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    return { id: item.id, pass: item.pattern.test(src) };
  });
  const pass = checks.every((c) => c.pass);
  const out = { pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) };
  process.stdout.write(JSON.stringify(out) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
