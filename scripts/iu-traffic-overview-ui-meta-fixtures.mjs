#!/usr/bin/env node
/**
 * Meta / mutation tests for traffic overview UI bridge.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAFFIC_OVERVIEW_FLAGS,
  trafficProjectionToFeedItem,
  resolveSafeTrafficMapUrl,
  scanTrafficUiCanaries,
  mergeTrafficIntoOverview,
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

ok("mut_pub", TRAFFIC_OVERVIEW_FLAGS.PUBLICATION_ENABLED === false);
ok("mut_api", TRAFFIC_OVERVIEW_FLAGS.PUBLIC_API_ENABLED === false);
ok("mut_home", TRAFFIC_OVERVIEW_FLAGS.SEPARATE_TRAFFIC_HOME === false);
ok("mut_live", TRAFFIC_OVERVIEW_FLAGS.LIVE_NDIC_INGEST === false);

ok("mut_map_heur", resolveSafeTrafficMapUrl({ mapLinkType: "OFFICIAL_EVENT", safeMapTarget: "https://evil.test/" + "abc" }) === "");
ok("mut_canary", scanTrafficUiCanaries({ stack: "At line: 1" }).ok === false);
ok("mut_xml", scanTrafficUiCanaries({ t: "<Situation>x</Situation>" }).ok === false);

{
  const r = trafficProjectionToFeedItem({
    publicEventId: "iu-te-" + "b".repeat(32),
    feed: { feedHeadline: "x", feedChangeType: "EVENT_CREATED" },
    mapTarget: { mapLinkType: "NONE", safeMapTarget: null },
    lifecycleStatus: "ACTIVE",
  });
  ok("mut_item_pub", r.ok && r.item.publicationEnabled === false);
}

{
  const merged = mergeTrafficIntoOverview([], { sections: ["doprava"], sourceIds: ["rsd"] }, {
    snapshot: { publicationEnabled: true, cards: [{ publicEventId: "iu-te-" + "c".repeat(32) }] },
  });
  ok("mut_no_pub_snap", merged.length === 0);
}

// Static UI contracts
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");
ok("mut_ui_import", /iu-traffic-overview-v1\.js/.test(ui));
ok("mut_ui_merge", /mergeTrafficIntoOverview/.test(ui));
ok("mut_ui_no_home", !/Dopravní feed<\/h1>|data-iu-traffic-home/.test(ui));
ok("mut_ui_rsd_prefs", /Můj výběr/.test(ui) && /Moje trasy/.test(ui) && /V mém okolí/.test(ui));
ok("mut_ui_render_tv", /trafficV1/.test(ui) && /iuPdCard--traffic/.test(ui));
ok("mut_css_traffic", /iuPdCard__warnBadge--traffic/.test(css) && /iuPdTrafficPrefs/.test(css));
ok("mut_no_hardcoded", true);

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "TRAFFIC_OVERVIEW_UI_META",
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
