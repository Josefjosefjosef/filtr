#!/usr/bin/env node
/**
 * Guard: Doprava first open must not download/render the full ~6k NDIC catalog.
 * - Edge head URL (?iu_head=1) + deferred full hydrate
 * - PAGE_SIZE=50 DOM window + Načíst další
 * - Filter-before-page invariant (full catalog when locality/detail filters active)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const overview = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-v1.js"), "utf8");
const flags = fs.readFileSync(path.join(ROOT, "assets", "iu-traffic-overview-flags-v1.js"), "utf8");
const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const worker = fs.readFileSync(
  path.join(ROOT, "cloudflare", "iu-site-redirects", "src", "index.ts"),
  "utf8"
);

ok(
  "head_url_defined",
  /TRAFFIC_UI_SNAPSHOT_HEAD_URL[\s\S]{0,80}iu_head=1/.test(overview),
  "missing head URL"
);
ok(
  "live_meta_url",
  /TRAFFIC_LIVE_META_URL[\s\S]{0,120}traffic_live_meta\.json/.test(overview),
  "missing live meta URL"
);
ok(
  "no_auto_full_hydrate",
  /opts\.hydrate === true/.test(overview) && !overview.includes("opts.hydrate !== false && !(Number(opts.maxCards) > 0)"),
  "auto full hydrate still default"
);
ok(
  "ensure_full_export",
  /export async function ensureFullTrafficOfflineSnapshot/.test(overview),
  "ensureFull missing"
);
ok(
  "capped_helper",
  /export function isTrafficSnapshotCapped/.test(overview),
  "isTrafficSnapshotCapped"
);
ok(
  "filter_needs_full",
  /export function trafficPrefsNeedFullCatalog/.test(overview),
  "trafficPrefsNeedFullCatalog"
);
ok(
  "first_paint_cap_200",
  /TRAFFIC_UI_FIRST_PAINT_CARD_CAP\s*=\s*200/.test(flags),
  "FIRST_PAINT_CARD_CAP"
);
ok(
  "prehled_page_size_50",
  /const PAGE_SIZE\s*=\s*50/.test(prehled),
  "PAGE_SIZE"
);
ok(
  "prehled_ensure_catalog_on_more",
  /act === "more"[\s\S]{0,220}ensureTrafficCatalogForCurrentFilters/.test(prehled),
  "more → ensure catalog"
);
ok(
  "prehled_load_more_capped",
  /trafficCatalogMayHaveMore/.test(prehled),
  "capped load-more"
);
ok(
  "worker_head_key",
  /R2_SNAPSHOT_HEAD_KEY/.test(worker) && /traffic_offline_snapshot_head\.json/.test(worker),
  "worker head key"
);
ok(
  "worker_head_cap_200",
  /TRAFFIC_HEAD_CARD_CAP\s*=\s*200/.test(worker),
  "worker head cap"
);
ok(
  "worker_write_head_on_publish",
  /writeSnapshotHeadFromFullBody/.test(worker),
  "publish writes head"
);
ok(
  "worker_live_meta_path",
  /TRAFFIC_LIVE_META_PATH/.test(worker) && /traffic_live_meta\.json/.test(worker),
  "live meta path"
);
ok(
  "worker_iu_head_query",
  /iu_head/.test(worker),
  "iu_head query"
);

const report = {
  TRAFFIC_FIRST_BATCH_PAGINATION_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
  REAL_IOS: "NOT_TESTED",
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
