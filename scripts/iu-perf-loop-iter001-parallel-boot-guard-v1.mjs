#!/usr/bin/env node
/**
 * Perf-loop iter-001: shell/feed/traffic boot must not be strictly sequential.
 * Run: npm run iu-perf-loop-iter001-parallel-boot-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(
  /loadInfoSystemShellData[\s\S]{0,800}Promise\.all\(\[\s*fetchJson\(iuInfoDataUrl\("manifest\.json"\)/.test(core),
  "core:shell_parallel_manifest"
);
must(/fetch all shell JSON in parallel/.test(core), "core:comment_marker");
must(
  /const feedPromise = loadInfoSystemFeedOnly\(/.test(ui) &&
    /const trafficPromise =/.test(ui) &&
    /const shell = await loadInfoSystemShellData/.test(ui),
  "ui:boot_parallel_promises"
);
must(/Promise\.resolve\(trafficPromise\)/.test(ui), "ui:uses_early_traffic_promise");
must(/perf-loop-iter001-parallel-boot-v1-20260819/.test(index), "index:cache_bust");
must(
  /iu-info-system-core-v1\.js\?v=evening-theme-settings-v1-20260818-perf-loop-iter001-parallel-boot-v1-20260819/.test(
    fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8")
  ),
  "traffic_overview:core_cache_bust_unified"
);

if (fails.length) {
  console.error("[iu-perf-loop-iter001-parallel-boot-guard] FAIL");
  for (const id of fails) console.error("[iu-perf-loop-iter001-parallel-boot-guard] " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter001-parallel-boot-guard] PASS");
console.log("RESULT=PASS");
