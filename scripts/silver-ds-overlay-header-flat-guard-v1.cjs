#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const FORM_PREMIUM = path.join(__dirname, "..", "assets", "iu-form-premium.css");
const UNIFIED = path.join(__dirname, "..", "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const APP = path.join(__dirname, "..", "assets", "app.js");
const REPORT = path.join(__dirname, "silver-ds-overlay-header-flat-guard-v1-report.json");

const REQUIRED = [
  {
    id: "form_premium_no_ds_panel_radius",
    file: FORM_PREMIUM,
    pattern: /#iuQuickFeed \.iu-banking-ds-modal[\s\S]*border-radius: 18px/,
    antiPattern: /\.iu-ds-panel,\s*\n#iuQuickFeed \.iu-banking-ds-modal/,
  },
  {
    id: "unified_ds_panel_flat",
    file: UNIFIED,
    pattern: /#iuDsPanel\.iu-ds-panel\[data-open="1"\]:not\(\[hidden\]\)[\s\S]*border-radius: 0 !important/,
  },
  {
    id: "unified_ds_header_flat",
    file: UNIFIED,
    pattern: /#iuDsPanel\.iu-ds-panel \.iu-ds-panelHeader[\s\S]*border-top-left-radius: 0 !important/,
  },
  {
    id: "app_js_inject_panel_flat",
    file: APP,
    pattern: /iuDsInjectMobileTabletCssOnce[\s\S]*border-radius:0!important;box-shadow:none!important\}/,
  },
  {
    id: "app_js_inject_header_flat",
    file: APP,
    pattern: /#iuDsPanel\.iu-ds-panel \.iu-ds-panelHeader\{border-top-left-radius:0!important;border-top-right-radius:0!important\}/,
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
    guard: "SILVER_DS_OVERLAY_HEADER_FLAT_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
