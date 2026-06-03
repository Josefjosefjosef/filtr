#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const REPORT = path.join(__dirname, "silver-calendar-premium-fix-v2-guard-v1-report.json");

const REQUIRED = [
  { id: "scroll_guard", pattern: /restoreCalendarScrollGuard/ },
  { id: "scroll_snapshot", pattern: /releaseCalScrollLockSnapshot/ },
  { id: "day_touch_pan_y", pattern: /touch-action:pan-y/ },
  { id: "overscroll_contain", pattern: /overscroll-behavior:contain/ },
  { id: "form_premium_v2", pattern: /iu-calInline--premiumV2/ },
  { id: "form_label_datum", pattern: /iu-calInline__label">Datum/ },
  { id: "form_label_cas", pattern: /iu-calInline__label">Čas/ },
  { id: "form_label_nazev", pattern: /Název události/ },
  { id: "form_stack_actions", pattern: /iu-calInline__actions--stack/ },
  { id: "all_day_two_lines", pattern: /iu-calAllDayToggleRow__line">Celodenní/ },
  { id: "input_16px", pattern: /font-size:16px!important/ },
  { id: "btn_min_height_52", pattern: /min-height:52px/ },
  { id: "delete_confirm", pattern: /iuCalDeleteConfirm/ },
  { id: "delete_confirm_text", pattern: /Opravdu chcete odstranit tuto událost\?/ },
  { id: "delete_confirm_yes", pattern: /Ano, odstranit/ },
  { id: "request_delete", pattern: /requestDeleteInlineEditor/ },
  { id: "bottom_sheet_taller", pattern: /92dvh,820px/ },
  { id: "vv_skip_bottom_sheet", pattern: /shouldUseCalBottomSheet\(\)\) return/ },
  { id: "scroll_preserve_iso", pattern: /data-iu-cal-rendered-iso/ },
  { id: "silver_all_day_two_lines", pattern: /iuSilverDraftAllDayLine">Celodenní/ },
];

function main() {
  const src = fs.readFileSync(APP, "utf8");
  const checks = REQUIRED.map((item) => ({
    id: item.id,
    pass: item.pattern.test(src),
  }));
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_CALENDAR_PREMIUM_FIX_V2_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
