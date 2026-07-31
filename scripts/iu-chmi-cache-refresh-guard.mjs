#!/usr/bin/env node
/**
 * Guard: info_events JSON is SW network-first passthrough with offline last-good
 * (never meta TTL stale-while-revalidate as the online path).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SW = path.join(ROOT, "sw.js");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const sw = fs.readFileSync(SW, "utf8");
const core = fs.readFileSync(CORE, "utf8");

ok("sw_info_events_feed", /info_events\/feed\.json/.test(sw), "feed");
ok("sw_info_events_lanes", /info_events\/lanes\//.test(sw), "lanes");
ok(
  "sw_network_first_offline_last_good",
  /network-first \(no-store\)/.test(sw) && /FEED_OFFLINE_CACHE/.test(sw) && /matchFeedOfflineLastGood/.test(sw),
  "strategy"
);
ok("sw_info_events_offline_json", /OFFLINE_NO_LAST_GOOD_FEED/.test(sw), "offline_json");
ok("core_no_store", /cache:\s*["']no-store["']/.test(core), "fetch");
ok("core_data_ver", /iu-data-ver|Date\.now\(\)/.test(core), "bust");

if (fails.length) {
  console.error("IU_CHMI_CACHE_REFRESH=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_CACHE_REFRESH=PASS");
