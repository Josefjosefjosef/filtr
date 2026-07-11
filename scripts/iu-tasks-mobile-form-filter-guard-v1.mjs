#!/usr/bin/env node
/**
 * Guard: mobile/tablet tasks form in detail panel + compact filter height ≤1024px only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "assets", "app.js");
const TASKS_CSS = path.join(ROOT, "assets", "iu-tasks-premium.css");
const INDEX = path.join(ROOT, "projects", "index.html");

const CHECKS = [
  {
    id: "js_form_root_detail",
    file: APP_JS,
    pattern: /function renderFormView\(\)[\s\S]*?const root = document\.getElementById\("iuTasksDetail"\)/,
  },
  {
    id: "js_form_not_main_mobile",
    file: APP_JS,
    pattern: /function renderFormView\(\)\{[\s\S]{0,1200}getElementById\("iuTasksMain"\)/,
    invert: true,
  },
  {
    id: "js_save_resets_mobile_mode",
    file: APP_JS,
    pattern: /function saveForm\(\)[\s\S]*?setTasksMobileMode\("list"\)/,
  },
  {
    id: "css_filter_compact_max1024",
    file: TASKS_CSS,
    pattern: /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__filter,\s*\n\s*#iuTasksOverlay\.iu-tasksPremiumScope \.iu-tasksOverlay__filter\.is-active[\s\S]*?height:14px[\s\S]*?max-height:14px/,
  },
  {
    id: "css_filter_row_compact_max1024",
    file: TASKS_CSS,
    pattern: /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__filters[\s\S]*?padding:4px 14px[\s\S]*?height:fit-content/,
  },
  {
    id: "index_tasks_css_cache_bust",
    file: INDEX,
      pattern: /iu-tasks-premium\.css\?v=pc-browser-compat-v1-20260711/,
  },
];

function main() {
  const checks = CHECKS.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
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
