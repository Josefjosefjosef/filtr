#!/usr/bin/env node
/**
 * Perf-loop iter-008: secondary CSS off mobile critical path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

must(/perf-loop-iter008-defer-secondary-css-v1-20260820/.test(index), "marker");

const mustDefer = [
  "iu-ai-overlay.css",
  "iu-custom-buttons-overlay.css",
  "iu-banking-premium.css",
  "iu-form-premium.css",
  "iu-tool-privacy-info.css",
  "iu-myinfouzel-premium-overlay.css",
];
for (const f of mustDefer) {
  const re = new RegExp(
    `href="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*data-iu-defer-overlay-css="1"`
  );
  must(re.test(index), "defer:" + f);
}

const mustDesktop = [
  "iu-desktop-right-rail-cards.css",
  "iu-desktop-parcel-watch-overlay.css",
  "iu-desktop-home-premium.css",
  "iu-desktop-section-close-v1.css",
  "iu-desktop-tool-window-shell-v1.css",
  "iu-desktop-info-panel.css",
];
for (const f of mustDesktop) {
  const re = new RegExp(
    `href="[^"]*${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*media="\\(min-width: 1025px\\)"`
  );
  must(re.test(index), "desktop_mq:" + f);
}

must(/href="[^"]*iu-prehled-dne-v1\.css[^"]*"\s*\/>/.test(index), "prehled:stays_blocking");
must(!/iu-prehled-dne-v1\.css[^>]*data-iu-defer-overlay-css/.test(index), "prehled:not_deferred");
must(/href="[^"]*app\.css[^"]*"\s*\/>/.test(index), "appcss:stays_blocking");
must(/"iu-ai-overlay\.css"/.test(index) && /"iu-myinfouzel-premium-overlay\.css"/.test(index), "frags:extended");

if (fails.length) {
  console.error("[iu-perf-loop-iter008-defer-secondary-css-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter008-defer-secondary-css-guard] PASS");
