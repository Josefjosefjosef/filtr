#!/usr/bin/env node
/**
 * IU_POST_FIRST_PAINT_STABILITY_GUARD — structural contract against full-page rebuild
 * after home first stable paint markers. Complements runtime forensics; does not
 * add permanent MutationObserver production overhead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const pipeline = fs.readFileSync(path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const tt = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
const singlePaint = fs.readFileSync(path.join(ROOT, "scripts", "iu-startup-single-paint-guard-v1.mjs"), "utf8");

/* Keep static shell: boot must not wipe hero when present. */
must(/FIRST LOAD: never wipe the static HTML shell/.test(ui), "ui_no_wipe_static_shell");
must(/heroReady && feedReady && !options\.forceFullShell/.test(ui), "ui_incremental_paint");
must(/updateFeedDom\(\)/.test(ui), "ui_update_feed_dom");

/* Desktop grid class before app.js (prevents layout flip). */
must(/iu-desktop-home-grid/.test(index) && /matchMedia\("\(min-width: 1025px\)"\)/.test(index), "early_desktop_grid");

/* Trusted Types must not unwrap homepage <picture> (was causing PNG flicker). */
must(/PICTURE:\s*1/.test(tt), "tt_picture_allowed");

/* Existing single-paint / reload latch contract remains frozen from PR #10635. */
must(/iu:pwa:sw-deploy-reload/.test(singlePaint) || /iu:pwa:sw-deploy-reload/.test(index), "sw_reload_latch");
must(/__iuFeedInitDone/.test(pipeline), "feed_init_marker");

/* No production MutationObserver stability watcher (diagnostic-only rule). */
must(!/IU_POST_FIRST_PAINT_STABILITY_RUNTIME/.test(ui), "no_prod_mo_watcher_ui");
must(!/IU_POST_FIRST_PAINT_STABILITY_RUNTIME/.test(pipeline), "no_prod_mo_watcher_pipeline");

if (fails.length) {
  console.error("[IU_POST_FIRST_PAINT_STABILITY_GUARD] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[IU_POST_FIRST_PAINT_STABILITY_GUARD] PASS");
