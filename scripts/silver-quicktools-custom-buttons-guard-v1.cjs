#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "assets", "app.js");
const FEED = path.join(__dirname, "..", "assets", "iu-app-feed-pipeline-v1.js");
const REPORT = path.join(__dirname, "silver-quicktools-custom-buttons-guard-v1-report.json");

const REQUIRED = [
  {
    id: "apply_config_accepts_override",
    file: APP,
    pattern: /function iuQuickToolsApplyConfig\(cfgOverride\)/,
  },
  {
    id: "save_and_apply_passes_cfg",
    file: APP,
    pattern: /function iuQuickToolsSaveAndApply\(cfg\)[\s\S]*iuQuickToolsApplyConfig\(cfg\)/,
  },
  {
    id: "delete_confirm_in_body_helper",
    file: APP,
    pattern: /function iuCustomButtonsEnsureDeleteConfirmInBody\(\)/,
  },
  {
    id: "delete_confirm_fixed_layer",
    file: APP,
    pattern: /#iuCustomButtonsDeleteConfirm:not\(\[hidden\]\)\{position:fixed;inset:0;z-index:10031/,
  },
  {
    id: "reset_button_closest_delegate",
    file: APP,
    pattern: /closest\("\.iu-quicktools-settings-reset"\)/,
  },
  {
    id: "delete_by_id_refreshes_with_cfg",
    file: APP,
    pattern: /function iuCustomButtonsDeleteById\(id\)[\s\S]*iuCustomButtonsRefreshList\(cfg\)/,
  },
  {
    id: "reset_refreshes_custom_list",
    file: APP,
    pattern: /function iuQuickToolsPerformReset\(\)[\s\S]*iuCustomButtonsRefreshList\(cfg\)/,
  },
  {
    id: "get_all_grids_helper",
    file: APP,
    pattern: /function iuQuickToolsGetAllGrids\(\)/,
  },
  {
    id: "apply_config_syncs_all_grids",
    file: APP,
    pattern: /function iuQuickToolsApplyConfig\(cfgOverride\)[\s\S]*iuQuickToolsGetAllGrids\(\)[\s\S]*forEach/,
  },
  {
    id: "tools_host_grid_selector",
    file: APP,
    pattern: /#iuMyInfoUzelToolsHost section\.iu-mmQuickLinks \.iu-mmQuickGrid/,
  },
  {
    id: "delete_by_id_all_grids",
    file: APP,
    pattern: /function iuCustomButtonsDeleteById\(id\)[\s\S]*iuQuickToolsGetAllGrids\(\)\.forEach/,
  },
];

function main() {
  const src = fs.readFileSync(APP, "utf8") + "\n" + (fs.existsSync(FEED) ? fs.readFileSync(FEED, "utf8") : "");
  const checks = REQUIRED.map((item) => ({
    id: item.id,
    pass: item.pattern.test(src),
  }));
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "SILVER_QUICKTOOLS_CUSTOM_BUTTONS_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
