#!/usr/bin/env node
/**
 * FIRST LOAD: shrink CHMI-critical module graph — early import kick + lazy traffic/settings.
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

must(/iu:fl-prehled-import-kick/.test(index), "index:early_import_kick");
must(/startPocasiPrefetch\(\)/.test(index), "index:pocasi_prefetch");
must(/window\.iuEnsurePrehledDneUi\(\)/.test(index), "index:early_import_call");
must(/modulepreload.*iu-info-system-core-v1/.test(index), "index:preload_core");
must(/modulepreload.*iu-feed-filter-v1/.test(index), "index:preload_feed_filter");
must(/modulepreload.*iu-prehled-dne-ui-v1/.test(index), "index:preload_prehled_ui");
must(/chmi-asset-waterfall-v1-20260822/.test(index), "index:cache_bust");
must(!/from "\.\/iu-traffic-overview-v1\.js/.test(ui), "ui:no_static_traffic_import");
must(!/from "\.\/iu-prehled-dne-feed-settings-v1\.js/.test(ui), "ui:no_static_feed_settings_import");
must(/function loadTrafficOverview/.test(ui), "ui:lazy_traffic");
must(/function loadFeedSettings/.test(ui), "ui:lazy_feed_settings");
must(/quickViewBarHtml/.test(ui), "ui:quick_view_feed_filter");
must(/iu-traffic-overview-flags-v1/.test(ui), "ui:traffic_flags_tiny");

if (fails.length) {
  console.error("[iu-first-load-chmi-asset-waterfall-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-chmi-asset-waterfall-guard] PASS");
