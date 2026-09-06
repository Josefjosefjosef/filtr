#!/usr/bin/env node
/**
 * Guard: Doprava first open must not download/render the full ~6k NDIC catalog.
 * - Edge head URL (?iu_head=1) for first batch
 * - PAGE_SIZE=50 DOM window + Načíst další
 * - Auto background full hydrate AFTER head (hydrate:true), never blocking first return
 * - Single-flight full hydrate (ensureFull joins scheduleTrafficSnapshotFullHydrate)
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
  "hydrate_opt_in_gate",
  /opts\.hydrate === true/.test(overview),
  "hydrate must stay opt-in (never default-true inside fetchHosted)"
);
ok(
  "no_legacy_auto_default_hydrate",
  !overview.includes("opts.hydrate !== false && !(Number(opts.maxCards) > 0)"),
  "legacy auto-default hydrate pattern"
);
ok(
  "schedule_full_hydrate_fn",
  /function scheduleTrafficSnapshotFullHydrate/.test(overview),
  "scheduleTrafficSnapshotFullHydrate"
);
ok(
  "public_bg_hydrate_export",
  /export function scheduleTrafficBackgroundFullHydrate/.test(overview),
  "scheduleTrafficBackgroundFullHydrate"
);
ok(
  "single_flight_promise",
  /_trafficFullHydratePromise/.test(overview) && /export function getTrafficFullHydratePromise/.test(overview),
  "single-flight promise"
);
ok(
  "ensure_full_joins_schedule",
  /export async function ensureFullTrafficOfflineSnapshot[\s\S]{0,400}scheduleTrafficSnapshotFullHydrate/.test(
    overview
  ),
  "ensureFull must join single-flight schedule (no parallel full GET)"
);
ok(
  "ensure_full_no_parallel_full_fetch",
  !/ensureFullTrafficOfflineSnapshot[\s\S]{0,500}full:\s*true/.test(overview),
  "ensureFull must not start a separate {full:true} fetch"
);
ok(
  "atomic_accept_helper",
  /function shouldAcceptTrafficFullSnapshot/.test(overview),
  "generation/accept helper"
);
ok(
  "no_clobber_full_with_head",
  /Do not clobber an already-ready full catalog/.test(overview) ||
    /!isTrafficSnapshotCapped\(_trafficSnapMem\) && isTrafficSnapshotCapped\(snap\)/.test(overview),
  "head must not overwrite ready full"
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
  "prehled_auto_hydrate_on_traffic_open",
  /scheduleTrafficBackgroundFullHydrate/.test(prehled) &&
    /paintTrafficQuick[\s\S]{0,800}scheduleTrafficBackgroundFullHydrate/.test(prehled),
  "Doprava open must schedule background full hydrate (not wait for filter/Další)"
);
ok(
  "prehled_head_fetch_not_await_full",
  /fetchHostedTrafficOfflineSnapshot\(\{\s*persist:\s*true\s*\}/.test(prehled) &&
    !/fetchHostedTrafficOfflineSnapshot\(\{\s*persist:\s*true,\s*hydrate:\s*true\s*\}/.test(prehled),
  "boot head fetch must not await/block on full hydrate"
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
