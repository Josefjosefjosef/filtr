#!/usr/bin/env node
/**
 * Static performance contracts (no flaky timings).
 * Run: node scripts/iu-perf-stage2-static-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readAppRuntimeSrc } from "./guards/iu-app-runtime-src.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walkJs(dir, acc = []) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "vendor" || e.name === "node_modules") continue;
      walkJs(p, acc);
    } else if (e.isFile() && e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

const ui = read("assets/iu-prehled-dne-ui-v1.js");
const app = read("assets/app.js");
const runtime = readAppRuntimeSrc(ROOT);
const index = read("projects/index.html");
const freeze = read("docs/pre-aggregator-stable/freeze-manifest.json");

must(/feedDomDirty/.test(ui), "ui:feedDomDirty");
must(/keepSettingsDom/.test(ui), "ui:keepSettingsDom");
must(/function openSettings[\s\S]{0,900}mountSettingsOverlay\(\)/.test(ui), "ui:open_overlay_direct");
must(/scheduleEnsureIdle/.test(app), "app:silver_idle_schedule");
must(/__iuSilverP0IdleArmed/.test(app), "app:silver_idle_once");
must(!/iu-silver-p0-engine\.js/.test(index), "index:no_eager_silver_engine_script");
must(/rel="modulepreload"/.test(index) && /iu-prehled-dne-ui-v1\.js/.test(index), "index:modulepreload_prehled_dne_ui");
must(/function openOverlay\(originEl\)\{\s*try \{ ensureStyles\(\); \}/.test(runtime), "app:calendar_styles_on_open");
must(/P1 perf: do not inject calendar CSS/.test(runtime), "app:calendar_init_no_boot_css");
must(/function iuBootCalendarOverlayLazy/.test(app), "app:calendar_lazy_boot");

const files = walkJs(path.join(ROOT, "assets"));
const byMod = new Map();
const re = /from\s+["'](\.\/[^"'?]+?\.js)\?v=([^"']+)["']/g;
for (const abs of files) {
  const txt = fs.readFileSync(abs, "utf8");
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(txt))) {
    const mod = m[1];
    const ver = m[2];
    if (!byMod.has(mod)) byMod.set(mod, new Set());
    byMod.get(mod).add(ver);
  }
}
const dupes = [];
for (const [mod, vers] of byMod.entries()) {
  if (vers.size > 1) dupes.push(mod + " => " + Array.from(vers).join(" | "));
}
must(dupes.length === 0, "esm:no_duplicate_query_versions:" + dupes.join(";"));

if (fails.length) {
  console.error("[iu-perf-stage2-static-guard] FAIL");
  for (const id of fails) console.error("[iu-perf-stage2-static-guard] " + id);
  process.exit(1);
}
console.log("[iu-perf-stage2-static-guard] PASS");
console.log("RESULT=PASS");
