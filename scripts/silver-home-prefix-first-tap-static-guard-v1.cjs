#!/usr/bin/env node
"use strict";

/**
 * Static contract: lazy Silver P0 boot must prefetch + click-hold prefix/quick-action buttons
 * so the first mobile/tablet tap is never a no-op.
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
    {
      id: "marker_present",
      pass: src.indexOf(MARKER) >= 0,
    },
    {
      id: "prefetch_sel_includes_home_prefix",
      pass: /SILVER_P0_PREFETCH_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-prefix\]/.test(boot),
    },
    {
      id: "prefetch_sel_includes_home_quick_action",
      pass: /SILVER_P0_PREFETCH_SEL\s*=\s*[\s\S]*?\[data-iu-silver-home-quick-action\]/.test(boot),
    },
    {
      id: "prefetch_sel_includes_home_ux",
      pass: /SILVER_P0_PREFETCH_SEL\s*=\s*[\s\S]*?#iuSilverHomeInputUx/.test(boot),
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
      id: "click_hold_uses_sel_var",
      pass: /e\.target\.closest\(SILVER_P0_CLICK_HOLD_SEL\)/.test(boot),
    },
    {
      id: "click_hold_reclick_after_ensure",
      pass: /ensure\(\)\.then\(function\s*\(\)\s*\{\s*try\s*\{\s*t\.click\(\);/.test(boot),
    },
    {
      id: "pointerdown_prefetch_registered",
      pass: /addEventListener\(\s*"pointerdown"\s*,\s*onPrefetchEvent\s*,\s*true\s*\)/.test(boot),
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
