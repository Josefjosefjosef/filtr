#!/usr/bin/env node
/**
 * Static performance contracts for stage-3 feed split (no flaky timings).
 * Run: node scripts/iu-perf-stage3-static-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const SHELL_REL = "assets/iu-mobile-bottom-nav-shell-v1.js";
const FEED_REL = "assets/iu-app-feed-pipeline-v1.js";
const SHELL_MAX = 24 * 1024;
const FEED_MIN = 800 * 1024;

must(fs.existsSync(path.join(ROOT, SHELL_REL)), "shell:exists");
must(fs.existsSync(path.join(ROOT, FEED_REL)), "feed:exists");

const shellBytes = fs.statSync(path.join(ROOT, SHELL_REL)).size;
const feedBytes = fs.statSync(path.join(ROOT, FEED_REL)).size;
must(shellBytes > 4000 && shellBytes <= SHELL_MAX, "shell:size_thin:" + shellBytes);
must(feedBytes >= FEED_MIN, "feed:extracted_size:" + feedBytes);

const shell = read(SHELL_REL);
const feed = read(FEED_REL);
const app = read("assets/app.js");
const index = read("projects/index.html");
const sw = read("sw.js");

must(/iuMobileBottomNavShellV1/.test(shell), "shell:iife_name");
must(/__iuMobileGateTabClicksBound/.test(shell), "shell:gate_tab_clicks");
must(/data-iu-bottom-nav/.test(shell), "shell:bottom_nav_attr");
must(/__iuMobileBottomNavInit/.test(shell), "shell:init_flag");
must(/iu-app-feed-pipeline-v1\.js\?v=perf-stage3-feed-split-v1-20260818/.test(shell), "shell:feed_cache_bust");
must(!/modulepreload[^>]+iu-app-feed-pipeline-v1/.test(index), "index:no_feed_modulepreload");
must(!/<script[^>]+src="\/assets\/iu-app-feed-pipeline-v1\.js/.test(index), "index:no_blocking_feed_script");
must(
  /<script type="module" src="\/assets\/iu-mobile-bottom-nav-shell-v1\.js\?v=perf-stage3-bottom-nav-shell-v1-20260818">/.test(
    index
  ),
  "index:shell_script"
);
must(/iu-prehled-dne-ui-v1\.js/.test(index), "index:prehled_script");
const shellIdx = index.indexOf("iu-mobile-bottom-nav-shell-v1.js");
const appIdx = index.indexOf('src="/assets/app.js?v=');
must(shellIdx > 0 && appIdx > shellIdx, "index:shell_before_app");
must(/function iuBootFeedPipelineLazy/.test(app), "app:lazy_feed_boot");
must(/window\.__iuEnsureFeedPipeline/.test(app), "app:ensure_feed_hook");
must(
  /min-width:\s*1025px[\s\S]{0,120}ensure\(\)/.test(app),
  "app:desktop_eager_feed"
);
must(
  /function iuProjectsHubNavigateHardResetFromHomeOrBack\(/.test(app),
  "app:hub_reset_on_critical_path"
);
must(!/from\s+["']\.\/iu-article-chunk-loader\.js/.test(app), "app:no_static_chunk_loader_import");
must(!/from\s+["']\.\/cluster_engine\.js/.test(app), "app:no_static_cluster_import");
must(/from\s+["']\.\/iu-article-chunk-loader\.js/.test(feed), "feed:owns_chunk_loader");
must(/function iuMobileBottomNavInit\(\)/.test(feed), "feed:keeps_full_nav_init");
must(/if \(window\.__iuMobileBottomNavInit\) return/.test(feed), "feed:nav_init_noops_after_shell");
must(
  /if \(!String\(wrap\.getAttribute\("data-iu-mobile-gate"\) \|\| ""\)\.trim\(\)\) setTab\(""\)/.test(feed),
  "feed:preserve_open_gate"
);
must(/iu-mobile-bottom-nav-shell-v1\.js/.test(sw), "sw:shell_in_graph");
must(/iu-app-feed-pipeline-v1\.js/.test(sw), "sw:feed_in_graph");
must(/iu-calendar-overlay-v1\.js/.test(sw), "sw:calendar_in_graph");
must(/CACHE_VERSION = "2026-08-18-perf-stage4-calendar-v1"/.test(sw), "sw:cache_version");
must(/function iuBootCalendarOverlayLazy/.test(app), "app:lazy_calendar_boot");
must(/window\.__iuEnsureCalendarOverlay/.test(app), "app:ensure_calendar_hook");
must(/iu-calendar-overlay-v1\.js\?v=perf-stage4-calendar-v1-20260818/.test(app), "app:calendar_cache_bust");
must(fs.existsSync(path.join(ROOT, "assets", "iu-calendar-overlay-v1.js")), "calendar:exists");
must(/export function initIuCalendarOverlay/.test(read("assets/iu-calendar-overlay-v1.js")), "calendar:export_init");
must(!/\/\/ === Calendar overlay module \(isolated, local-first, Silver API\) ===/.test(app), "app:no_inline_calendar_iife");
must(/rel="modulepreload"[^>]+iu-mobile-bottom-nav-shell-v1\.js/.test(index), "index:shell_modulepreload");
must(!/rel="modulepreload"[^>]+iu-app-feed-pipeline-v1/.test(index), "index:no_feed_preload_head");
must(!/rel="modulepreload"[^>]+iu-calendar-overlay-v1/.test(index), "index:no_calendar_preload_head");

if (fails.length) {
  console.error("[iu-perf-stage3-static-guard] FAIL");
  for (const id of fails) console.error("[iu-perf-stage3-static-guard] " + id);
  process.exit(1);
}
console.log("[iu-perf-stage3-static-guard] PASS");
console.log("RESULT=PASS");
console.log("SHELL_BYTES=" + shellBytes);
console.log("FEED_BYTES=" + feedBytes);
