#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const REPORT = path.join(__dirname, "silver-calendar-premium-update-guard-v1-report.json");

const REQUIRED = [
  { id: "all_day_toggle", pattern: /Celodenní událost/ },
  { id: "all_day_field", pattern: /allDay:\s*!!/ },
  { id: "all_day_section", pattern: /iu-calAllDaySection/ },
  { id: "bottom_sheet", pattern: /iuCalEventBottomSheet/ },
  { id: "should_use_bottom_sheet", pattern: /shouldUseCalBottomSheet/ },
  { id: "month_search_btn", pattern: /Vyhledat událost/ },
  { id: "search_overlay", pattern: /iuCalEventSearchOverlay/ },
  { id: "search_table", pattern: /iu-calSearchTable/ },
  { id: "day_abbrev", pattern: /calWeekdayAbbrev/ },
  { id: "celý_den_label", pattern: /Celý den/ },
  { id: "scroll_lock_sync", pattern: /syncCalendarScrollLocks/ },
  { id: "year_scroll_css", pattern: /data-view=year/ },
  { id: "search_reset", pattern: /resetEventSearchState/ },
  { id: "silver_all_day_toggle", pattern: /data-iu-silver-field-all-day/ },
];

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const checks = REQUIRED.map((item) => ({
    id: item.id,
    pass: item.pattern.test(src),
  }));
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_CALENDAR_PREMIUM_UPDATE_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
