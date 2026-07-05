#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const CSS = path.join(__dirname, "..", "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const INDEX = path.join(__dirname, "..", "projects", "index.html");
const APP = path.join(__dirname, "..", "assets", "app.js");
const REPORT = path.join(__dirname, "iu-mindmenu-bottom-nav-restore-guard-v1-report.json");

const REQUIRED = [
  { id: "restore_marker", pattern: /iu-mindmenu-bottom-nav-restore-v1/ },
  { id: "mobile_tablet_max_1024", pattern: /@media \(max-width: 1024px\)/ },
  { id: "bottom_nav_z_index", pattern: /#iuMobileBottomNav\.iu-mobileBottomNav\s*\{\s*\n\s*z-index: 10200 !important/ },
  { id: "bottom_nav_clearance", pattern: /bottom: var\(--bottom-nav-height, calc\(56px \+ env\(safe-area-inset-bottom, 0px\) \+ 32px\)\) !important/ },
  { id: "v3_unified_scroll_safe_area", pattern: /v3 — unified scroll\/safe-area/ },
  { id: "tool_overlay_bottom_gap", pattern: /--iu-tool-overlay-bottom-gap/ },
  { id: "no_safe_space_in_restore", antiOnly: true, pattern: /--iu-mobile-bottom-nav-safe-space/ },
  { id: "calendar_day_overlay_clearance", pattern: /#iuCalendarDayOverlay\.iu-calendar-day-overlay:not\(\[hidden\]\)/ },
  { id: "quickfeed_gate_scope", pattern: /body\.iu-mobileGateOverlayOpen\.iu-mobileGateToolsQuickOpen #iuQuickFeed/ },
  { id: "calendar_dialog_clearance", pattern: /#iuCalendarOverlay \.iu-calendarOverlay__dialog/ },
  { id: "index_link", file: INDEX, pattern: /iu-mindmenu-bottom-nav-restore-v1\.css/ },
  { id: "js_close_helper", file: APP, pattern: /function iuMindMenuCloseToolOverlaysIfOpen\(\)/ },
];

function main() {
  const css = fs.readFileSync(CSS, "utf8");
  const checks = REQUIRED.map((item) => {
    const src = item.file ? fs.readFileSync(item.file, "utf8") : css;
    const hit = item.pattern.test(src);
    const pass = item.antiOnly ? !hit : hit;
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "IU_MINDMENU_BOTTOM_NAV_RESTORE_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
