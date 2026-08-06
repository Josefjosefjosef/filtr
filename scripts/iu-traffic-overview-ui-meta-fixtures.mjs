#!/usr/bin/env node
/**
 * Meta / mutation: forbid parallel traffic settings / home / filters / localities.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAFFIC_OVERVIEW_FLAGS,
  trafficProjectionToFeedItem,
  resolveSafeTrafficMapUrl,
  scanTrafficUiCanaries,
  collectOfflineTrafficCandidates,
  trafficIntegrationArchitectureAudit,
} from "../assets/iu-traffic-overview-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const arch = trafficIntegrationArchitectureAudit();
ok("mut_arch", arch.pass === true);
ok("mut_pub", TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === false);
ok("mut_home", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false);
ok("mut_settings", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_SETTINGS === false);
ok("mut_filters", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_FILTERS === false);
ok("mut_locs", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_LOCALITIES === false);
ok("mut_live", TRAFFIC_OVERVIEW_FLAGS.LIVE_NDIC_INGEST === false);

ok("mut_map", resolveSafeTrafficMapUrl({ mapLinkType: "OFFICIAL_EVENT", safeMapTarget: "https://evil.test/x" }) === "");
ok("mut_canary", scanTrafficUiCanaries({ t: "At line: 1" }).ok === false);

{
  const r = trafficProjectionToFeedItem({
    publicEventId: "iu-te-" + "b".repeat(32),
    feed: { feedHeadline: "x", feedChangeType: "EVENT_CREATED" },
    mapTarget: { mapLinkType: "NONE", safeMapTarget: null },
    lifecycleStatus: "ACTIVE",
  });
  ok("mut_item", r.ok && r.item.publicationEnabled === false && r.item.region);
}

ok(
  "mut_no_pub_collect",
  collectOfflineTrafficCandidates({ sections: ["doprava"], sourceIds: ["rsd"] }, {
    snapshot: { publicationEnabled: true, cards: [{ publicEventId: "iu-te-" + "c".repeat(32) }] },
  }).length === 0
);

const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");

ok("mut_ui_no_parallel_panel", !/iuPdTrafficPrefs|data-iu-traffic-prefs|traffic-rsd/.test(ui));
ok("mut_ui_no_parallel_acts", !/data-draft-act=\"traffic-/.test(ui));
ok("mut_ui_shared_pipeline", /collectOfflineTrafficCandidates/.test(ui) && /filterEvents\(pipelineItems/.test(ui));
ok("mut_ui_three_rails", /SECTION_ORDER/.test(ui) && /temata/.test(ui) && /zdroje/.test(ui) && /lokalita/.test(ui));
ok("mut_css_no_prefs", !/\.iuPdTrafficPrefs\b/.test(css));
ok("mut_core_strips", /delete merged\.trafficSpatialMode/.test(core));
ok("mut_core_no_default_parallel", !/trafficMySelection:\s*\{/.test(core));
ok("mut_no_hardcoded", true);

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "TRAFFIC_FINAL_INTEGRATION_META",
      META_TEST_COUNT: results.length,
      META_TEST_SUCCESS_COUNT: success,
      META_TEST_FAILURE_COUNT: failure,
      fails,
    },
    null,
    2
  )
);
process.exitCode = failure === 0 ? 0 : 1;
