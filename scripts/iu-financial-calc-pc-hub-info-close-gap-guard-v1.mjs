#!/usr/bin/env node
/**
 * PC hub Finanční kalkulačky: ≥10px gap between ℹ Informace and ✕ close (hub only, ≥1025px).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CSS = path.join(ROOT, "assets", "iu-financial-overlay.css");
const INDEX = path.join(ROOT, "projects", "index.html");

const CHECKS = [
  {
    id: "css_hub_info_absolute_gap",
    file: CSS,
    pattern:
      /iu-financial-overlay-panel--hub[\s\S]*?\.iu-tool-privacy-btn\{[\s\S]*?right:\s*calc\(12px \+ 38px \+ 10px\)/,
  },
  {
    id: "css_hub_close_unchanged",
    file: CSS,
    pattern:
      /iu-financial-overlay-panel--hub #iuFinancialCalcClose\{[\s\S]*?right:\s*12px/,
  },
  {
    id: "css_min_width_1025_scope",
    file: CSS,
    pattern:
      /@media \(min-width: 1025px\)[\s\S]*iu-financial-overlay-panel--hub[\s\S]*\.iu-tool-privacy-btn/,
  },
  {
    id: "index_cache_bust",
    file: INDEX,
    pattern: /financial-calc-pc-hub-info-close-gap-v1-20260707/,
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
