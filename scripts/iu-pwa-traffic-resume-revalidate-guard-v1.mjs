#!/usr/bin/env node
/**
 * Guard: PWA warm resume / new-entry must revalidate traffic without blocking first paint.
 *
 * Static (always):
 * - scheduleTrafficForegroundRevalidate + single-flight promise
 * - resume uses head probe; full hydrate only on generation change
 * - clears stale full-hydrate single-flight when gen changes
 * - prehled: visibility (after hidden), pageshow(persisted), online
 * - no unconditional pageshow → revalidate (would storm in-app)
 * - architecture: head → paint → background full hydrate remains
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
const prehled = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");

ok(
  "export_foreground_revalidate",
  /export function scheduleTrafficForegroundRevalidate/.test(overview),
  "missing scheduleTrafficForegroundRevalidate"
);
ok(
  "export_get_fg_promise",
  /export function getTrafficForegroundRevalidatePromise/.test(overview),
  "missing getTrafficForegroundRevalidatePromise"
);
ok(
  "fg_single_flight",
  /if \(_trafficForegroundRevalidatePromise\) return _trafficForegroundRevalidatePromise/.test(overview),
  "foreground revalidate must single-flight"
);
ok(
  "fg_offline_keeps_cache",
  /navigator\.onLine === false[\s\S]{0,120}loadOfflineTrafficSnapshot/.test(overview),
  "offline must return cached snap"
);
ok(
  "fg_head_probe",
  /scheduleTrafficForegroundRevalidate[\s\S]{0,900}TRAFFIC_UI_SNAPSHOT_HEAD_URL/.test(overview),
  "resume must probe head URL"
);
ok(
  "fg_clear_full_on_gen_change",
  /genChanged[\s\S]{0,200}_trafficFullHydratePromise = null/.test(overview),
  "gen change must allow a new full hydrate"
);
ok(
  "fg_phase_resume_head",
  /phase:\s*"resume-head"/.test(overview),
  "resume-head event phase"
);
ok(
  "fg_same_gen_no_full",
  /Same generation:[\s\S]{0,80}return prev/.test(overview) ||
    /Same generation[\s\S]{0,120}return prev/.test(overview),
  "same generation must not force full GET"
);
ok(
  "bg_hydrate_preserved",
  /export function scheduleTrafficBackgroundFullHydrate/.test(overview) &&
    /function scheduleTrafficSnapshotFullHydrate/.test(overview),
  "background full-hydrate architecture"
);
ok(
  "prehled_helper",
  /function scheduleTrafficForegroundRevalidateIfNeeded/.test(prehled),
  "prehled lifecycle helper"
);
ok(
  "prehled_visibility_after_hidden",
  /trafficSawHidden[\s\S]{0,400}scheduleTrafficForegroundRevalidateIfNeeded\("visibilitychange"\)/.test(
    prehled
  ),
  "visibility revalidate only after hidden"
);
ok(
  "prehled_pageshow_persisted_only",
  /ev\.persisted[\s\S]{0,120}scheduleTrafficForegroundRevalidateIfNeeded\("pageshow-bfcache"\)/.test(
    prehled
  ),
  "pageshow revalidate only when persisted"
);
ok(
  "prehled_online",
  /scheduleTrafficForegroundRevalidateIfNeeded\("online"\)/.test(prehled),
  "online reconnect revalidate"
);
ok(
  "prehled_gates_traffic_enabled",
  /scheduleTrafficForegroundRevalidateIfNeeded[\s\S]{0,250}trafficEnabled === false/.test(prehled),
  "must respect trafficEnabled"
);
ok(
  "no_focus_storm",
  !/addEventListener\("focus"[\s\S]{0,200}scheduleTrafficForegroundRevalidate/.test(prehled),
  "do not hook window focus (duplicates visibility)"
);
ok(
  "no_bare_pageshow_revalidate",
  !/addEventListener\("pageshow",\s*\(\)\s*=>\s*\{[\s\S]{0,200}scheduleTrafficForegroundRevalidateIfNeeded/.test(
    prehled
  ),
  "bare pageshow must not always revalidate"
);

const report = {
  PWA_TRAFFIC_RESUME_REVALIDATE_GUARD: fails.length ? "FAIL" : "PASS",
  fails,
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
process.exit(0);
