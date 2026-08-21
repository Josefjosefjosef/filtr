#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

must(/first-load-feed-lanes-not-feedjson-v1-20260821/.test(index), "marker_lanes");
must(/first-load-prehled-bootstrap-before-appjs-v1-20260821/.test(index), "marker_bootstrap");
must(/first-load-early-chmi-boot-v1-20260821/.test(index), "marker_early_boot");
must(/lanes\/pocasi\.json/.test(index), "preload_pocasi");
must(/__iuPocasiLanePrefetch/.test(index), "pocasi_prefetch");
must(/__iuPocasiLanePrefetch/.test(core), "core_reuses_prefetch");
must(/preferLaneIds|preferLanes|feedSource:\s*"lanes"|fromLanes/.test(core), "core_lanes_path");
must(/allowFullFeed/.test(core), "core_allow_full_feed_flag");
must(
  /when NDIC is omitted, do NOT download feed\.json/.test(core) ||
    /do NOT download feed\.json/.test(core),
  "core_comment"
);
// Bootstrap classic script must appear before app.js module (preferably early <head>).
const bootIdx = index.indexOf("iuDeferPrehledDneUiUntilFcp");
const appIdx = index.indexOf('<script type="module" src="/assets/app.js');
const headEnd = index.indexOf("</head>");
must(bootIdx > 0 && appIdx > 0 && bootIdx < appIdx, "bootstrap_before_appjs");
must(headEnd > 0 && bootIdx < headEnd, "bootstrap_in_head");

if (fails.length) {
  console.error("[iu-first-load-feed-lanes-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-feed-lanes-guard] PASS");
