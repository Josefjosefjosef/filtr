#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const UNIFIED = path.join(__dirname, "..", "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const RESTORE = path.join(__dirname, "..", "assets", "iu-mindmenu-bottom-nav-restore-v1.css");
const INDEX = path.join(__dirname, "..", "projects", "index.html");
const REPORT = path.join(__dirname, "iu-ai-assistants-overlay-bottom-gap-guard-v1-report.json");

const REQUIRED = [
  {
    id: "unified_ai_bottom_gap_token",
    file: UNIFIED,
    pattern: /--iu-ai-overlay-bottom-gap:\s*10px/,
  },
  {
    id: "unified_ai_panel_not_100dvh",
    file: UNIFIED,
    pattern: /Part 7: AI asistenti[\s\S]*min-height: 0 !important[\s\S]*max-height: calc\(100dvh - var\(--iu-tool-overlay-panel-bottom\)\)/,
  },
  {
    id: "unified_ai_scroll_on_body_only",
    file: UNIFIED,
    pattern: /body\.iu-ai-narrow-fullscreen #iu-aiPanel \.iu-aiPanelBody[\s\S]*--iu-ai-overlay-bottom-gap[\s\S]*#iu-aiPanelCards[\s\S]*padding-bottom: 0 !important/,
  },
  {
    id: "unified_ai_modal_no_bottom_padding",
    file: UNIFIED,
    pattern: /body\.iu-ai-narrow-fullscreen #iu-aiPanel \.iu-aiModal[\s\S]*padding-bottom: 0 !important[\s\S]*max-height: 100% !important/,
  },
  {
    id: "restore_ai_body_gap",
    file: RESTORE,
    pattern: /body\.iu-ai-narrow-fullscreen #iu-aiPanel \.iu-aiPanelBody[\s\S]*--iu-ai-overlay-bottom-gap/,
    antiPattern: /body\.iu-ai-narrow-fullscreen #iu-aiPanel :is\(\.iu-aiModal, \.iu-ai-scroll-host, #iu-aiPanelCards\)[\s\S]*--iu-tool-overlay-bottom-gap/,
  },
  {
    id: "index_cache_bust_unified",
    file: INDEX,
    pattern: /iu-overlay-mobile-tablet-unified-v1\.css\?v=legal-docs-mobile-header-unified-v1-20260706/,
  },
  {
    id: "index_cache_bust_restore",
    file: INDEX,
    pattern: /iu-mindmenu-bottom-nav-restore-v1\.css\?v=ai-assistants-overlay-bottom-gap-v1-20260705/,
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
    guard: "IU_AI_ASSISTANTS_OVERLAY_BOTTOM_GAP_GUARD_V1",
    pass,
    checks,
    ts: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) }) + "\n");
  if (!pass) process.exitCode = 1;
}

main();
