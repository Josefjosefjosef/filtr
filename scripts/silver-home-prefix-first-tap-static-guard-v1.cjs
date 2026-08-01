#!/usr/bin/env node
"use strict";

/**
 * Static contract: Silver P0 deferred boot must viewport-prefetch on mobile/tablet,
 * optimistically apply prefix UI, and finalize a single pending tap (no lost/double fire).
 * Run: node scripts/silver-home-prefix-first-tap-static-guard-v1.cjs
 */

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const MARKER = "IU_SILVER_HOME_PREFIX_FIRST_TAP_HOLD_V1";

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const start = src.indexOf("/* IU_SILVER_P0_ENGINE_START */");
  const end = src.indexOf("/* IU_SILVER_P0_ENGINE_END */");
  const boot = start >= 0 && end > start ? src.slice(start, end) : "";

  const checks = [
    { id: "marker_present", pass: src.indexOf(MARKER) >= 0 },
    {
      id: "prefetch_sel_includes_home_prefix",
      pass: /SILVER_P0_PREFETCH_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-prefix\]/.test(boot),
    },
    {
      id: "prefetch_sel_includes_home_quick_action",
      pass: /SILVER_P0_PREFETCH_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-quick-action\]/.test(boot),
    },
    {
      id: "click_hold_sel_includes_home_prefix",
      pass: /SILVER_P0_CLICK_HOLD_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-prefix\]/.test(boot),
    },
    {
      id: "click_hold_sel_includes_home_quick_action",
      pass: /SILVER_P0_CLICK_HOLD_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-quick-action\]/.test(boot),
    },
    {
      id: "viewport_prefetch_armed",
      pass: /function armViewportPrefetch\(/.test(boot) && /IntersectionObserver/.test(boot),
    },
    {
      id: "pageshow_visibility_prefetch",
      pass: /addEventListener\(\s*"pageshow"/.test(boot) && /visibilitychange/.test(boot),
    },
    {
      id: "optimistic_prefix_apply",
      pass: /function applyOptimisticPrefix\(/.test(boot) && /__iuSilverPrefixOptimisticCount/.test(boot),
    },
    {
      id: "single_pending_finalize",
      pass: /function finalizePendingTap\(/.test(boot) && /pendingGen/.test(boot) && /cancelPendingTap/.test(boot),
    },
    {
      id: "prefix_finalize_no_reclick",
      pass: /pending\.kind === "prefix"/.test(boot) && /__iuSilverSyncHomeUxEmptyState/.test(boot),
    },
    {
      id: "reclick_path_for_non_prefix",
      pass: /kind === "prefix" \? "prefix" : "reclick"/.test(boot) || /kind = prefixKey \? "prefix" : "reclick"/.test(boot),
    },
    {
      id: "pointerdown_prefetch_registered",
      pass: /addEventListener\(\s*"pointerdown"\s*,\s*onPrefetchEvent\s*,\s*true\s*\)/.test(boot),
    },
    {
      id: "ready_marker_attr",
      pass: /data-iu-silver-p0-ready/.test(boot),
    },
  ];

  const pass = checks.every((c) => c.pass);
  const failed = checks.filter((c) => !c.pass).map((c) => c.id);
  process.stdout.write(
    JSON.stringify({
      guard: "SILVER_HOME_PREFIX_FIRST_TAP_STATIC_GUARD_V1",
      pass,
      failed,
      ts: new Date().toISOString(),
    }) + "\n"
  );
  if (!pass) process.exitCode = 1;
}

main();
