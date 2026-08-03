#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const RESTORE = path.join(__dirname, "..", "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const UNIFIED = path.join(__dirname, "..", "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const APP = path.join(__dirname, "..", "assets", "app.js");
const FORM = path.join(__dirname, "..", "assets", "iu-form-premium.css");
const REPORT = path.join(__dirname, "silver-mobile-form-card-ds-safe-area-guard-v1-report.json");

const REQUIRED = [
  {
    id: "restore_no_card_nav_padding",
    file: RESTORE,
    pattern: /Scroll clearance jen na scroll hostech/,
    antiPattern: /\.bakalari-card[\s\S]*iu-mobile-bottom-nav-safe-space/,
  },
  {
    id: "unified_form_cards_content_height",
    file: UNIFIED,
    pattern: /#iuQuickFeed :is\(\.bakalari-card, \.iu-health-card, \.iuQCard[\s\S]*padding-bottom: 0 !important/,
  },
  {
    id: "unified_ds_panel_bottom_nav",
    file: UNIFIED,
    pattern: /iuDsInjectMobileTabletCssOnce[\s\S]*bottom:var\(--iu-tool-overlay-panel-bottom\)|#iuDsPanel\.iu-ds-panel\.iuSectionDS\[data-open="1"\][\s\S]*bottom: var\(--iu-tool-overlay-panel-bottom\)/,
  },
  {
    id: "app_js_ds_inject_no_full_viewport_panel",
    file: APP,
    pattern: /iuDsInjectMobileTabletCssOnce[\s\S]*bottom:var\(--iu-tool-overlay-panel-bottom/,
    antiPattern: /iuDsInjectMobileTabletCssOnce[\s\S]*#iuDsPanel\.iu-ds-panel\.iuSectionDS\[data-open=\\"1\\"\][\s\S]*inset:0!important;left:0!important;transform:none!important;display:block!important;width:100%!important;max-width:none!important;height:100vh!important;height:100dvh!important;max-height:100dvh!important;/,
  },
  {
    id: "form_premium_mobile_cards_visible",
    file: FORM,
    pattern: /@media \(max-width: 1024px\)[\s\S]*\.bakalari-card,[\s\S]*content-visibility: visible/,
  },
];

function main() {
  const checks = REQUIRED.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    let pass = item.pattern.test(src);
    if (pass && item.antiPattern) {
      pass = !item.antiPattern.test(src);
    }
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_MOBILE_FORM_CARD_DS_SAFE_AREA_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
