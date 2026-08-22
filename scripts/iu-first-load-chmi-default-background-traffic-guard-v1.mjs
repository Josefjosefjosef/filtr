#!/usr/bin/env node
/**
 * FIRST LOAD: homepage boot defaults to ČHMÚ; traffic DOM deferred; background prep contract.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(/feedQuickView:\s*"chmu"/.test(ui), "ui:default_chmu");
must(/state\.feedQuickView\s*=\s*"chmu"/.test(ui), "ui:boot_force_chmu");
must(/function feedQuickViewIncludesTraffic/.test(ui), "ui:traffic_gate_fn");
must(/feedQuickViewIncludesTraffic\(\)/.test(ui), "ui:traffic_gate_use");
must(/function scheduleTrafficBackgroundPrep/.test(ui), "ui:bg_prep_fn");
must(/iu-traffic-background-ready/.test(ui), "ui:bg_ready_event");
must(/trafficBackgroundReady/.test(ui), "ui:bg_ready_state");
must(!/feedQuickView:\s*"all"/.test(ui), "ui:no_default_all");
must(/chmi-first-home-boot-v1-20260822/.test(index), "index:cache_bust");
must(/PAGE_SIZE\s*=\s*50/.test(ui), "ui:page_size_50");

if (fails.length) {
  console.error("[iu-first-load-chmi-default-background-traffic-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-chmi-default-background-traffic-guard] PASS");
