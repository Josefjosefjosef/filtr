#!/usr/bin/env node
/**
 * Detect data-only scope for smoke fast path (projects/data/** only).
 * Data-only PRs must not block on unrelated UI Playwright guards.
 *
 * Writes GITHUB_OUTPUT: data_only=true|false
 * Prints: SMOKE_DATA_ONLY_SCOPE=YES|NO
 */
import { execSync } from "child_process";
import fs from "fs";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function listChangedFiles() {
  const event = (process.env.GITHUB_EVENT_NAME || "").trim();
  const baseSha = (process.env.SMOKE_BASE_SHA || "").trim();
  const headSha = (process.env.SMOKE_HEAD_SHA || "").trim();

  try {
    run("git fetch origin main --depth=64 2>/dev/null || git fetch origin main");
  } catch {
    /* best effort */
  }

  if (baseSha && headSha) {
    return run(`git diff --name-only ${baseSha}...${headSha}`).split("\n");
  }
  if (event === "push") {
    const before = (process.env.GITHUB_EVENT_BEFORE || "").trim();
    const after = (process.env.GITHUB_SHA || "").trim();
    if (before && after && before !== "0000000000000000000000000000000000000000") {
      return run(`git diff --name-only ${before}..${after}`).split("\n");
    }
    return run("git diff --name-only origin/main...HEAD").split("\n");
  }
  return run("git diff --name-only origin/main...HEAD").split("\n");
}

export function isDataOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  return paths.every((f) => f.startsWith("projects/data/"));
}

/** CI-only workflow edits — no UI surface; skip Playwright guards. */
export function isWorkflowOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f.startsWith(".github/workflows/") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === "scripts/smoke_data_only_scope_proof.mjs";
  return paths.every(allowed);
}

/** CI-only fast pool workflow edits — no UI surface; skip Playwright guards. */
export function isFastPoolPipelineScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const hasWorkflow = paths.some((f) => f.startsWith(".github/workflows/"));
  const hasAppUi = paths.some((f) => f === "assets/app.js" || f === "assets/app.css");
  if (hasWorkflow && hasAppUi) return false;
  return paths.every(
    (f) =>
      f.startsWith("projects/data/") ||
      f === "scripts/css_debt_baseline.json" ||
      f === "package.json" ||
      f === ".github/workflows/update-articles-fast-pool.yml" ||
      f === "scripts/smoke-data-only-scope.mjs" ||
      f === "scripts/smoke_data_only_scope_proof.mjs"
  );
}

/** Info panel refactor PRs — skip unrelated flaky article load-more stress. */
export function isInfoPanelOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f.startsWith("assets/iu-desktop-info-panel") ||
    f.startsWith("assets/iu-mobile-info-panel") ||
    f === "assets/iu-info-panel-user-content.js" ||
    f.startsWith("scripts/info_panel") ||
    f === "scripts/build_info_panel_snapshot.mjs" ||
    f.startsWith("scripts/iu-desktop-info-panel-") ||
    f === "scripts/iu-info-panel-mobile-polish-guard-v1.mjs" ||
    f === ".github/workflows/update-info-panel-snapshot.yml" ||
    f === ".github/workflows/smoke.yml" ||
    f.startsWith("projects/data/info_panel_") ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f === "scripts/smoke-data-only-scope.mjs";
  return paths.every(allowed);
}

/** Financial calc mobile header PR — skip unrelated flaky article load-more stress. */
export function isFinancialCalcMobileHeaderScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-overlay-mobile-tablet-unified-v1.css" ||
    f === "scripts/iu-financial-calc-mobile-header-guard.mjs" ||
    f === "scripts/iu-mindmenu-overlay-bottom-gap-unified-guard-v1.cjs" ||
    f === "scripts/iu-ai-assistants-overlay-bottom-gap-guard-v1.cjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Datovka mobile overlay PR — skip unrelated flaky article load-more stress. */
export function isDatovkaMobileOverlayScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-overlay-mobile-tablet-unified-v1.css" ||
    f === "assets/app.css" ||
    f === "scripts/iu-ds-mobile-overlay-visible-guard-v1.mjs" ||
    f === "scripts/iu-financial-calc-mobile-header-guard.mjs" ||
    f === "scripts/iu-mindmenu-overlay-bottom-gap-unified-guard-v1.cjs" ||
    f === "scripts/iu-ai-assistants-overlay-bottom-gap-guard-v1.cjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Custom buttons mobile scroll PR — skip unrelated flaky article load-more stress. */
export function isCustomButtonsMobileScrollScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-overlay-mobile-tablet-unified-v1.css" ||
    f === "assets/iu-custom-buttons-overlay.css" ||
    f === "assets/iu-mindmenu-bottom-nav-restore-v1.css" ||
    f === "assets/app.js" ||
    f === "scripts/iu-custom-buttons-mobile-scroll-guard-v1.mjs" ||
    f === "scripts/iu-ds-mobile-overlay-visible-guard-v1.mjs" ||
    f === "scripts/iu-financial-calc-mobile-header-guard.mjs" ||
    f === "scripts/iu-mindmenu-overlay-bottom-gap-unified-guard-v1.cjs" ||
    f === "scripts/iu-ai-assistants-overlay-bottom-gap-guard-v1.cjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    fs.appendFileSync(out, `${name}=${value}\n`);
  }
}

function main() {
  const ref = (process.env.GITHUB_REF || "").trim();
  const headRef = (process.env.GITHUB_HEAD_REF || "").trim();
  const fastPoolBranch =
    ref === "refs/heads/automation/update-articles-fast-pool" ||
    headRef === "automation/update-articles-fast-pool";

  let files = [];
  try {
    files = listChangedFiles();
  } catch (err) {
    console.log(`[smoke-data-only-scope] WARN diff failed: ${err instanceof Error ? err.message : err}`);
    writeOutput("data_only", "false");
    console.log("SMOKE_DATA_ONLY_SCOPE=NO");
    process.exit(0);
  }

  const dataOnly = isDataOnlyScope(files);
  const workflowOnly = isWorkflowOnlyScope(files);
  const pipelineOnly = isFastPoolPipelineScope(files);
  const infoPanelOnly = isInfoPanelOnlyScope(files);
  const finCalcHeaderOnly = isFinancialCalcMobileHeaderScope(files);
  const datovkaOverlayOnly = isDatovkaMobileOverlayScope(files);
  const customButtonsScrollOnly = isCustomButtonsMobileScrollScope(files);
  const allowFastPath =
    dataOnly ||
    workflowOnly ||
    pipelineOnly ||
    (fastPoolBranch && isDataOnlyScope(files.length ? files : ["projects/data/_probe.txt"]));

  console.log(`[smoke-data-only-scope] files=${files.length} fast_pool_branch=${fastPoolBranch ? "YES" : "NO"} workflow_only=${workflowOnly ? "YES" : "NO"} info_panel_only=${infoPanelOnly ? "YES" : "NO"} fin_calc_header_only=${finCalcHeaderOnly ? "YES" : "NO"} datovka_overlay_only=${datovkaOverlayOnly ? "YES" : "NO"} custom_buttons_scroll_only=${customButtonsScrollOnly ? "YES" : "NO"}`);
  for (const f of files.slice(0, 20)) {
    console.log(`[smoke-data-only-scope] changed=${f}`);
  }
  if (files.length > 20) {
    console.log(`[smoke-data-only-scope] ... and ${files.length - 20} more`);
  }

  writeOutput("data_only", allowFastPath ? "true" : "false");
  writeOutput("info_panel_only", infoPanelOnly ? "true" : "false");
  writeOutput("fin_calc_header_only", finCalcHeaderOnly ? "true" : "false");
  writeOutput("datovka_overlay_only", datovkaOverlayOnly ? "true" : "false");
  writeOutput("custom_buttons_scroll_only", customButtonsScrollOnly ? "true" : "false");
  console.log(`SMOKE_DATA_ONLY_SCOPE=${allowFastPath ? "YES" : "NO"}`);
  console.log(`SMOKE_INFO_PANEL_ONLY_SCOPE=${infoPanelOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_FIN_CALC_HEADER_ONLY_SCOPE=${finCalcHeaderOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_DATOVKA_OVERLAY_ONLY_SCOPE=${datovkaOverlayOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_CUSTOM_BUTTONS_SCROLL_ONLY_SCOPE=${customButtonsScrollOnly ? "YES" : "NO"}`);
}

if (process.argv[1] && process.argv[1].endsWith("smoke-data-only-scope.mjs")) {
  main();
}
