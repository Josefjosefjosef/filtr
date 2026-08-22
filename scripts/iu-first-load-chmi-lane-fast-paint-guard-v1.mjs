#!/usr/bin/env node
/**
 * FIRST LOAD: ČHMÚ lane must not wait on traffic fetch; early module boot; no empty interim paint.
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

must(/function startChmiBoot/.test(index), "index:start_chmi_boot");
must(/startChmiBoot\(\)/.test(index), "index:start_chmi_boot_call");
must(/function ensureTrafficFetchPromise/.test(ui), "ui:deferred_traffic_fetch");
must(/state\.trafficFetchPromise = null/.test(ui), "ui:no_boot_traffic_fetch");
must(/data-iu-pd-feed-ready/.test(ui), "ui:feed_ready_gate");
must(/function markPrehledBootPhase/.test(ui), "ui:boot_phase_marks");
must(/markPrehledBootPhase\("chmi-request-start"\)/.test(ui), "ui:chmi_request_mark");
must(/phase:\s*"chmi-first-paint"/.test(ui), "ui:chmi_paint_mark");
must(/Keep static HTML skeleton/.test(ui), "ui:skip_empty_paint");
must(/feedEarlyPainted/.test(ui) && /Merge shell taxonomy/.test(ui), "ui:skip_dup_paint");
must(/chmi-lane-fast-paint-v1-20260822/.test(index), "index:cache_bust");
must(/feedQuickView:\s*"chmu"/.test(ui), "ui:default_chmu");
must(/scheduleTrafficBackgroundPrep/.test(ui), "ui:bg_prep");

if (fails.length) {
  console.error("[iu-first-load-chmi-lane-fast-paint-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-chmi-lane-fast-paint-guard] PASS");
