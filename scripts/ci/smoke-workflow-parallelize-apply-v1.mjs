#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wfPath = path.join(REPO, ".github", "workflows", "smoke.yml");
const manifest = JSON.parse(
  fs.readFileSync(path.join(REPO, "scripts", "ci", "smoke-guard-manifest-v1.json"), "utf8")
);
const removeNames = new Set(manifest.guards.map((g) => g.name));

const SCOPE_KEYS = [
  "data_only",
  "skip_browser",
  "run_info_events_contract",
  "vault_runtime_scope",
  "info_panel_only",
  "fin_calc_header_only",
  "datovka_overlay_only",
  "custom_buttons_scroll_only",
  "quicktools_mobile_visibility_only",
  "quicktools_fixed_width_only",
  "user_data_backup_only",
  "data_mgmt_restore_overlay_mobile_only",
  "pc_left_rail_same_window_tabs_only",
  "pc_tool_window_left_rail_layout_only",
  "notes_unified_field_only",
  "pwa_offline_resilience_only",
  "info_panel_cnb_rates_only",
  "jr_section_header_line_color_only",
  "legal_doc_section_bar_only",
  "legal_docs_form_state_only",
  "pc_svatek_label_pill_gap_only",
  "calendar_allday_pinned_limit_only",
  "desktop_article_read_mark_only",
  "iu_ads_deploy_unblock_only",
  "chmi_cap_watchdog_deploy_only",
  "chmi_cap_v2_prod_verify_only",
  "cj_affiliate_phase2_offline_only",
  "cj_staging_api_probe_only",
];

const parallelBlock = `      - name: Playwright guard suite (parallel pool, manifest v1)
        if: steps.scope.outputs.data_only != 'true'
        timeout-minutes: 90
        env:
          IU_SMOKE_GUARD_PARALLEL: "4"
${SCOPE_KEYS.map((k) => `          SCOPE_${k}: \${{ steps.scope.outputs.${k} }}`).join("\n")}
        run: node scripts/ci/run-smoke-guards-parallel-v1.mjs

`;

const lines = fs.readFileSync(wfPath, "utf8").split("\n");
const out = [];
let i = 0;
let afterFullUi = false;
let inserted = false;
while (i < lines.length) {
  const line = lines[i];
  if (line.includes("- name: Full UI smoke suite")) afterFullUi = true;
  if (line.includes("- name: Set required status context (smoke)")) {
    afterFullUi = false;
    out.push(line);
    i += 1;
    continue;
  }
  if (afterFullUi && line.startsWith("      - name:")) {
    const name = line.replace(/^\s+- name:\s*/, "").trim();
    if (removeNames.has(name) && !name.includes("Full UI smoke suite")) {
      i += 1;
      while (i < lines.length && !lines[i].startsWith("      - name:") && !lines[i].startsWith("      # Required status")) {
        i += 1;
      }
      if (!inserted) {
        out.push(parallelBlock.trimEnd());
        inserted = true;
      }
      continue;
    }
  }
  out.push(line);
  if (line.includes("- name: Full UI smoke suite")) {
    i += 1;
    while (i < lines.length && !lines[i].startsWith("      - name:")) {
      out.push(lines[i]);
      i += 1;
    }
    continue;
  }
  i += 1;
}

fs.writeFileSync(wfPath, out.join("\n"));
console.log(JSON.stringify({ IU_SMOKE_WORKFLOW_PARALLELIZE: "OK", removedSteps: removeNames.size, insertedParallel: inserted }));
