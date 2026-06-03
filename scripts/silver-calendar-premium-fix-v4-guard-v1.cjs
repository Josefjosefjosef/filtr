#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const REPORT = path.join(__dirname, "silver-calendar-premium-fix-v4-guard-v1-report.json");

const REQUIRED = [
  { id: "v4_style", pattern: /iu-calendar-premium-fix-v4/ },
  { id: "sheet_compact_css", pattern: /#iuCalEventBottomSheet \.iu-calInline--premiumV2/ },
  { id: "two_line_all_day_preserved", pattern: /iu-calAllDayToggleRow__line">Celodenní/ },
  { id: "search_normalize_fn", pattern: /function calEventSearchNormalize/ },
  { id: "search_uses_normalize", pattern: /calEventSearchNormalize\(query\)/ },
  { id: "search_y_to_i", pattern: /replace\(\/y\/g, "i"\)/ },
  { id: "search_nfd", pattern: /normalize\("NFD"\)/ },
  { id: "bottom_sheet_height_preserved", pattern: /92dvh,820px/ },
  { id: "compact_input_44", pattern: /min-height:44px;padding:10px 12px/ },
  { id: "compact_textarea", pattern: /min-height:56px/ },
  { id: "compact_btn_44", pattern: /#iuCalEventBottomSheet \.iu-calInline--premiumV2 \.iu-calInline__btn\{min-height:44px/ },
  { id: "silver_untouched_routing", pattern: /data-iu-silver-field-all-day/ },
];

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const checks = REQUIRED.map((item) => ({
    id: item.id,
    pass: item.pattern.test(src),
  }));
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_CALENDAR_PREMIUM_FIX_V4_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
