#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const TASKS_CSS = path.join(__dirname, "..", "assets", "iu-tasks-premium.css");
const REPORT = path.join(__dirname, "silver-calendar-bottom-nav-restore-guard-v1-report.json");

const REQUIRED = [
  { id: "restore_marker", pattern: /iu-calendar-bottom-nav-restore-v1/ },
  { id: "mobile_tablet_max_1024", pattern: /@media\(max-width:1024px\)\{[^}]*#iuCalendarOverlay\.iu-calendarOverlay:not\(\[hidden\]\)\{z-index:10024!important/s },
  { id: "bottom_nav_clearance", pattern: /bottom:var\(--bottom-nav-height,calc\(56px \+ env\(safe-area-inset-bottom,0px\) \+ 32px\)\)!important/ },
  { id: "month_search_fab", pattern: /Vyhledat událost/ },
  { id: "month_add_fab", pattern: /Přidat událost/ },
];

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const tasksCss = fs.readFileSync(TASKS_CSS, "utf8");
  const checks = REQUIRED.map((item) => ({
    id: item.id,
    pass: item.pattern.test(src),
  }));
  checks.push({
    id: "tasks_z_index_reference",
    pass: /#iuTasksOverlay\.iu-tasksPremiumScope\{position:fixed;inset:0;z-index:10024/.test(tasksCss),
  });
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_CALENDAR_BOTTOM_NAV_RESTORE_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
