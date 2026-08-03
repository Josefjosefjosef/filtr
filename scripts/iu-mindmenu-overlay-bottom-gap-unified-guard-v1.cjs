#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const RESTORE = path.join(__dirname, "..", "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const UNIFIED = path.join(__dirname, "..", "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const CUSTOM = path.join(__dirname, "..", "assets", "iu-custom-buttons-overlay.css");
const INDEX = path.join(__dirname, "..", "projects", "index.html");
const REPORT = path.join(__dirname, "iu-mindmenu-overlay-bottom-gap-unified-guard-v1-report.json");

function restoreNoSafeSpaceOnCards(src) {
  const stripped = src.replace(/#iuDsPanel[\s\S]*?\n  \}/g, "");
  return !/(?:\.bakalari-card|#iuQuickFeed \.iuQBody|\.iu-banking-scroll-host)[\s\S]*--iu-mobile-bottom-nav-safe-space/.test(
    stripped
  );
}

const REQUIRED = [
  {
    id: "restore_no_safe_space_on_cards",
    file: RESTORE,
    pattern: /--iu-tool-overlay-bottom-gap/,
    custom: restoreNoSafeSpaceOnCards,
  },
  {
    id: "restore_ds_panel_uses_bottom_nav_height",
    file: RESTORE,
    pattern: /#iuDsPanel[\s\S]*--bottom-nav-height/,
  },
  {
    id: "restore_quickfeed_gate_bottom_gap",
    file: RESTORE,
    pattern: /body\.iu-mobileGateOverlayOpen\.iu-mobileGateToolsQuickOpen #iuQuickFeed[\s\S]*--iu-tool-overlay-bottom-gap/,
  },
  {
    id: "unified_part6_tasks_scroll",
    file: UNIFIED,
    pattern: /Part 6: Úkoly[\s\S]*\.iu-tasksOverlay__scroll[\s\S]*--iu-tool-overlay-bottom-gap/,
  },
  {
    id: "unified_scroll_hosts_bottom_gap",
    file: UNIFIED,
    pattern: /scroll hosts: clearance above nav[\s\S]*#iuCustomButtonsScrollHost[\s\S]*--iu-tool-overlay-bottom-gap/,
  },
  {
    id: "custom_buttons_no_safe_space",
    file: CUSTOM,
    pattern: /--iu-tool-overlay-bottom-gap/,
    antiPattern: /--iu-mobile-bottom-nav-safe-space/,
  },
  {
    id: "index_cache_bust_restore",
    file: INDEX,
    pattern: /iu-mindmenu-bottom-nav-restore-v1\.css\?v=ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803-kb-restore-v3-20260803/,
  },
  {
    id: "index_cache_bust_unified",
    file: INDEX,
    pattern: /iu-overlay-mobile-tablet-unified-v1\.css\?v=ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803-kb-restore-v3-20260803/,
  },
];

function main() {
  const checks = REQUIRED.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    let pass = item.pattern.test(src);
    if (pass && item.antiPattern) {
      pass = !item.antiPattern.test(src);
    }
    if (pass && item.custom) {
      pass = item.custom(src);
    }
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  const report = {
    guard: "IU_MINDMENU_OVERLAY_BOTTOM_GAP_UNIFIED_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
