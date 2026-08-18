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
    f === "scripts/smoke_data_only_scope_proof.mjs" ||
    // Ads post-migration verify / Admin E2E tooling (no app UI surface)
    f === "scripts/iu-ads-post-migration-prod-verify.mjs" ||
    f.startsWith("cloudflare/iu-ads/scripts/");
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
    f.startsWith("assets/iu-info-panel-") ||
    f.startsWith("scripts/info_panel") ||
    f === "scripts/build_info_panel_snapshot.mjs" ||
    f === "scripts/mpsv_labor_open_data.mjs" ||
    f.startsWith("scripts/iu-desktop-info-panel-") ||
    f.startsWith("scripts/iu-info-panel-") ||
    f === ".github/workflows/update-info-panel-snapshot.yml" ||
    f === ".github/workflows/smoke.yml" ||
    f.startsWith("projects/data/info_panel_") ||
    f.startsWith("docs/data-sources/") ||
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
    f === "assets/iu-mindmenu-bottom-nav-restore-v1.css" ||
    f === "assets/app.css" ||
    f === "scripts/iu-ds-mobile-overlay-visible-guard-v1.mjs" ||
    f === "scripts/iu-ds-mobile-overlay-nav-flush-guard-v1.mjs" ||
    f === "scripts/iu-ds-mobile-scroll-bottom-clearance-guard-v1.mjs" ||
    f === "scripts/iu-financial-calc-mobile-header-guard.mjs" ||
    f === "scripts/iu-mindmenu-overlay-bottom-gap-unified-guard-v1.cjs" ||
    f === "scripts/iu-mindmenu-bottom-nav-restore-guard-v1.cjs" ||
    f === "scripts/iu-ai-assistants-overlay-bottom-gap-guard-v1.cjs" ||
    f === "scripts/iu-legal-documents-mobile-header-guard.mjs" ||
    f === "scripts/iu-moje-sluzby-mobile-keyboard-add-btn-guard-v1.mjs" ||
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

/** Quicktools mobile/tablet visibility PR — skip unrelated flaky article load-more stress. */
export function isQuicktoolsMobileVisibilityScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-custom-buttons-overlay.css" ||
    f === "scripts/iu-quicktools-mobile-visibility-guard-v1.mjs" ||
    f === "scripts/iu-custom-buttons-mobile-scroll-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Desktop article read mark PR — skip unrelated flaky article load-more stress. */
export function isDesktopArticleReadMarkOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const hasFeature = paths.some(
    (f) =>
      f === "assets/app.js" ||
      f === "assets/app.css" ||
      f === "scripts/iu-desktop-article-read-mark-guard-v1.mjs"
  );
  if (!hasFeature) return false;
  const allowed = (f) =>
    f === "assets/app.js" ||
    f === "assets/app.css" ||
    f === "projects/index.html" ||
    f === "scripts/iu-desktop-article-read-mark-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "package.json";
  return paths.every(allowed);
}

/** PC svátek label→pill 4px gap — skip unrelated flaky article / info-panel guards. */
export function isPcSvatekLabelPillGapOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-desktop-home-premium.css" ||
    f.startsWith("scripts/iu-svatek-pill-") ||
    f === "scripts/iu-pc-browser-compat-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Calendar all-day pinned block + 3/day limit — skip unrelated flaky guards. */
export function isCalendarAllDayPinnedLimitScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/app.js" ||
    f === "assets/app.css" ||
    f.startsWith("scripts/iu-calendar-allday-") ||
    f === "scripts/iu-desktop-calendar-allday-toggle-guard-v1.mjs" ||
    f.startsWith("scripts/silver-calendar-premium-") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Legal document section bar spacing PR — skip unrelated flaky article / info-panel guards. */
export function isLegalDocSectionBarOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-legal-documents-pdf-renderer.js" ||
    f === "assets/iu-legal-documents-overlay.css" ||
    f === "assets/iu-legal-documents-mobile-template-v1.css" ||
    f.startsWith("scripts/iu-legal-documents-") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Legal document form-state fix PR — skip unrelated flaky article guards. */
export function isLegalDocsFormStateOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-legal-documents-module.js" ||
    f === "assets/app.js" ||
    f.startsWith("scripts/iu-legal-documents-") ||
    f.startsWith("scripts/iu-legal-") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "package.json";
  return paths.every(allowed);
}

/** User data backup PR — skip unrelated flaky article load-more / entrypoint guards. */
export function isUserDataBackupOnlyScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-user-data-backup-core.js" ||
    f === "assets/iu-user-data-backup-v1.js" ||
    f.startsWith("scripts/iu-user-data-backup-") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Data mgmt restore overlay mobile/tablet PR — skip unrelated flaky guards. */
export function isDataMgmtRestoreOverlayMobileScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-info-center.css" ||
    f === "scripts/iu-data-mgmt-restore-overlay-mobile-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f.startsWith("projects/data/");
  return paths.every(allowed);
}

/** PC left-rail same-window tabs PR — skip unrelated flaky guards. */
export function isPcLeftRailSameWindowTabsScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-desktop-left-rail-new-window-v1.js" ||
    f === "scripts/iu-desktop-left-rail-new-window-guard-v1.mjs" ||
    f === "scripts/iu-perf-regression-guards.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f.startsWith("projects/data/");
  return paths.every(allowed);
}

/** PC tool-window left-rail layout PR — skip unrelated flaky guards. */
export function isPcToolWindowLeftRailLayoutScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/iu-desktop-left-rail-new-window-v1.js" ||
    f === "assets/iu-desktop-tool-window-shell-v1.css" ||
    f === "assets/iu-desktop-tool-window-left-rail-v1.js" ||
    f === "assets/app.js" ||
    f === "scripts/iu-desktop-left-rail-new-window-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f.startsWith("projects/data/");
  return paths.every(allowed);
}

/** Notes unified single-field PR — skip unrelated flaky guards. */
export function isNotesUnifiedFieldScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/app.js" ||
    f === "assets/iu-notes-premium.css" ||
    f === "assets/iu-home-premium-install-box.js" ||
    f === "scripts/iu-notes-unified-field-guard-v1.mjs" ||
    f === "scripts/silver-notes-v2-ux-guard-v1-shared.cjs" ||
    f === "scripts/silver-notes-mobile-tablet-ux-guard-v1-shared.cjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f.startsWith("projects/data/");
  return paths.every(allowed);
}

/** Info panel CNB EUR/USD rates fix — skip unrelated flaky guards. */
export function isInfoPanelCnbRatesScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const hasFeature = paths.some(
    (f) =>
      f === "assets/iu-cnb-exchange-utils.js" ||
      f.startsWith("scripts/iu-info-panel-cnb-rates-guard-") ||
      f === "projects/data/info_panel_snapshot.json" ||
      f === ".github/workflows/update-info-panel-snapshot.yml"
  );
  if (!hasFeature) return false;
  const allowed = (f) =>
    f === "assets/iu-cnb-exchange-utils.js" ||
    f === "assets/iu-desktop-info-panel-data.js" ||
    f === "assets/iu-desktop-info-panel.js" ||
    f.startsWith("scripts/iu-info-panel-cnb-rates-guard-") ||
    f === "scripts/iu-info-panel-mobile-polish-guard-v1.mjs" ||
    f === "scripts/iu-desktop-info-panel-states-guard.mjs" ||
    f === "scripts/build_info_panel_snapshot.mjs" ||
    f === "projects/data/info_panel_snapshot.json" ||
    f === "projects/data/info_panel_scheduler_state.json" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === ".github/workflows/update-info-panel-snapshot.yml" ||
    f === ".github/workflows/layout-guard.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f === "sw.js";
  return paths.every(allowed);
}

/** Jízdní řády section header line orange accent — skip unrelated flaky guards. */
export function isJrSectionHeaderLineColorScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  // Require JR-specific guard script — app.css alone is shared with other UI scopes.
  const hasJrGuard = paths.some((f) => f.startsWith("scripts/iu-jr-section-header-line-guard-"));
  if (!hasJrGuard) return false;
  const allowed = (f) =>
    f === "assets/app.css" ||
    f.startsWith("scripts/iu-jr-section-header-line-guard-") ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** Quicktools fixed tile width PR — skip unrelated flaky guards. */
export function isQuicktoolsFixedWidthScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const hasFeature = paths.some(
    (f) =>
      f === "scripts/iu-quicktools-fixed-width-guard-v1.mjs" ||
      f === "assets/iu-custom-buttons-overlay.css" ||
      f === "assets/iu-myinfouzel-premium-overlay.css"
  );
  if (!hasFeature) return false;
  const allowed = (f) =>
    f === "assets/iu-custom-buttons-overlay.css" ||
    f === "assets/iu-myinfouzel-premium-overlay.css" ||
    f === "assets/app.css" ||
    f === "assets/app.js" ||
    f === "scripts/iu-quicktools-fixed-width-guard-v1.mjs" ||
    f === "scripts/iu-quicktools-mobile-visibility-guard-v1.mjs" ||
    f === "scripts/iu-custom-buttons-mobile-scroll-guard-v1.mjs" ||
    f === "scripts/iu-desktop-article-read-mark-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json";
  return paths.every(allowed);
}

/** PWA offline resilience PR — skip unrelated flaky guards. */
export function isPwaOfflineResilienceScope(files) {
  const paths = files.map((f) => f.trim()).filter(Boolean);
  if (!paths.length) return false;
  const allowed = (f) =>
    f === "assets/app.js" ||
    f === "assets/iu-network-connectivity-v1.js" ||
    f === "assets/iu-article-chunk-loader.js" ||
    f === "scripts/iu-pwa-offline-resilience-guard-v1.mjs" ||
    f === "scripts/smoke-data-only-scope.mjs" ||
    f === ".github/workflows/smoke.yml" ||
    f === "projects/index.html" ||
    f === "package.json" ||
    f === "sw.js" ||
    f.startsWith("projects/data/");
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

  let headCommitDataOnly = false;
  try {
    const inspectSha = (process.env.SMOKE_HEAD_SHA || "").trim() || "HEAD";
    const parentLine = run("git rev-list --parents -n 1 " + inspectSha);
    const parentParts = parentLine.split(/\s+/).filter(Boolean);
    if (parentParts.length >= 3) {
      const headFiles = run("git diff --name-only " + inspectSha + "^1 " + inspectSha).split("\n");
      headCommitDataOnly = isDataOnlyScope(headFiles);
    }
  } catch {
    headCommitDataOnly = false;
  }

  // Catch-up merge at tip may be data-only, but the same push can also include
  // code commits (e.g. guard fix + merge main). Only allow headCommitDataOnly
  // when the push/event range itself is data-only — never mask code changes.
  let pushRangeDataOnly = false;
  try {
    const before = (process.env.GITHUB_EVENT_BEFORE || "").trim();
    const after =
      (process.env.SMOKE_HEAD_SHA || "").trim() || (process.env.GITHUB_SHA || "").trim();
    if (
      before &&
      after &&
      before !== "0000000000000000000000000000000000000000" &&
      before !== after
    ) {
      const pushFiles = run("git diff --name-only " + before + ".." + after).split("\n");
      pushRangeDataOnly = isDataOnlyScope(pushFiles);
    }
  } catch {
    pushRangeDataOnly = false;
  }

  const dataOnly = isDataOnlyScope(files);
  const workflowOnly = isWorkflowOnlyScope(files);
  const pipelineOnly = isFastPoolPipelineScope(files);
  const infoPanelOnly = isInfoPanelOnlyScope(files);
  const finCalcHeaderOnly = isFinancialCalcMobileHeaderScope(files);
  const datovkaOverlayOnly = isDatovkaMobileOverlayScope(files);
  const customButtonsScrollOnly = isCustomButtonsMobileScrollScope(files);
  const quicktoolsMobileVisibilityOnly = isQuicktoolsMobileVisibilityScope(files);
  const quicktoolsFixedWidthOnly = isQuicktoolsFixedWidthScope(files);
  const userDataBackupOnly = isUserDataBackupOnlyScope(files);
  const dataMgmtRestoreOverlayMobileOnly = isDataMgmtRestoreOverlayMobileScope(files);
  const pcLeftRailSameWindowTabsOnly = isPcLeftRailSameWindowTabsScope(files);
  const pcToolWindowLeftRailLayoutOnly = isPcToolWindowLeftRailLayoutScope(files);
  const notesUnifiedFieldOnly = isNotesUnifiedFieldScope(files);
  const pwaOfflineResilienceOnly = isPwaOfflineResilienceScope(files);
  const infoPanelCnbRatesOnly = isInfoPanelCnbRatesScope(files);
  const jrSectionHeaderLineColorOnly = isJrSectionHeaderLineColorScope(files);
  const legalDocSectionBarOnly = isLegalDocSectionBarOnlyScope(files);
  const legalDocsFormStateOnly = isLegalDocsFormStateOnlyScope(files);
  const pcSvatekLabelPillGapOnly = isPcSvatekLabelPillGapOnlyScope(files);
  const calendarAllDayPinnedLimitOnly = isCalendarAllDayPinnedLimitScope(files);
  const desktopArticleReadMarkOnly = isDesktopArticleReadMarkOnlyScope(files);
  const allowFastPath =
    dataOnly ||
    workflowOnly ||
    pipelineOnly ||
    (headCommitDataOnly && pushRangeDataOnly) ||
    (fastPoolBranch && isDataOnlyScope(files.length ? files : ["projects/data/_probe.txt"]));

  console.log(`[smoke-data-only-scope] files=${files.length} head_commit_data_only=${headCommitDataOnly ? "YES" : "NO"} push_range_data_only=${pushRangeDataOnly ? "YES" : "NO"} fast_pool_branch=${fastPoolBranch ? "YES" : "NO"} workflow_only=${workflowOnly ? "YES" : "NO"} info_panel_only=${infoPanelOnly ? "YES" : "NO"} fin_calc_header_only=${finCalcHeaderOnly ? "YES" : "NO"} datovka_overlay_only=${datovkaOverlayOnly ? "YES" : "NO"} custom_buttons_scroll_only=${customButtonsScrollOnly ? "YES" : "NO"} quicktools_mobile_visibility_only=${quicktoolsMobileVisibilityOnly ? "YES" : "NO"} user_data_backup_only=${userDataBackupOnly ? "YES" : "NO"} data_mgmt_restore_overlay_mobile_only=${dataMgmtRestoreOverlayMobileOnly ? "YES" : "NO"} pc_left_rail_same_window_tabs_only=${pcLeftRailSameWindowTabsOnly ? "YES" : "NO"} pc_tool_window_left_rail_layout_only=${pcToolWindowLeftRailLayoutOnly ? "YES" : "NO"} legal_doc_section_bar_only=${legalDocSectionBarOnly ? "YES" : "NO"} legal_docs_form_state_only=${legalDocsFormStateOnly ? "YES" : "NO"} pc_svatek_label_pill_gap_only=${pcSvatekLabelPillGapOnly ? "YES" : "NO"} calendar_allday_pinned_limit_only=${calendarAllDayPinnedLimitOnly ? "YES" : "NO"} desktop_article_read_mark_only=${desktopArticleReadMarkOnly ? "YES" : "NO"} jr_section_header_line_color_only=${jrSectionHeaderLineColorOnly ? "YES" : "NO"} info_panel_cnb_rates_only=${infoPanelCnbRatesOnly ? "YES" : "NO"}`);
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
  writeOutput("quicktools_mobile_visibility_only", quicktoolsMobileVisibilityOnly ? "true" : "false");
  writeOutput("quicktools_fixed_width_only", quicktoolsFixedWidthOnly ? "true" : "false");
  writeOutput("user_data_backup_only", userDataBackupOnly ? "true" : "false");
  writeOutput("data_mgmt_restore_overlay_mobile_only", dataMgmtRestoreOverlayMobileOnly ? "true" : "false");
  writeOutput("pc_left_rail_same_window_tabs_only", pcLeftRailSameWindowTabsOnly ? "true" : "false");
  writeOutput("pc_tool_window_left_rail_layout_only", pcToolWindowLeftRailLayoutOnly ? "true" : "false");
  writeOutput("notes_unified_field_only", notesUnifiedFieldOnly ? "true" : "false");
  writeOutput("pwa_offline_resilience_only", pwaOfflineResilienceOnly ? "true" : "false");
  writeOutput("info_panel_cnb_rates_only", infoPanelCnbRatesOnly ? "true" : "false");
  writeOutput("jr_section_header_line_color_only", jrSectionHeaderLineColorOnly ? "true" : "false");
  writeOutput("legal_doc_section_bar_only", legalDocSectionBarOnly ? "true" : "false");
  writeOutput("legal_docs_form_state_only", legalDocsFormStateOnly ? "true" : "false");
  writeOutput("pc_svatek_label_pill_gap_only", pcSvatekLabelPillGapOnly ? "true" : "false");
  writeOutput("calendar_allday_pinned_limit_only", calendarAllDayPinnedLimitOnly ? "true" : "false");
  writeOutput("desktop_article_read_mark_only", desktopArticleReadMarkOnly ? "true" : "false");
  console.log(`SMOKE_DATA_ONLY_SCOPE=${allowFastPath ? "YES" : "NO"}`);
  console.log(`SMOKE_INFO_PANEL_ONLY_SCOPE=${infoPanelOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_FIN_CALC_HEADER_ONLY_SCOPE=${finCalcHeaderOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_DATOVKA_OVERLAY_ONLY_SCOPE=${datovkaOverlayOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_CUSTOM_BUTTONS_SCROLL_ONLY_SCOPE=${customButtonsScrollOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_QUICKTOOLS_MOBILE_VISIBILITY_ONLY_SCOPE=${quicktoolsMobileVisibilityOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_QUICKTOOLS_FIXED_WIDTH_ONLY_SCOPE=${quicktoolsFixedWidthOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_USER_DATA_BACKUP_ONLY_SCOPE=${userDataBackupOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_DATA_MGMT_RESTORE_OVERLAY_MOBILE_ONLY_SCOPE=${dataMgmtRestoreOverlayMobileOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_PC_LEFT_RAIL_SAME_WINDOW_TABS_ONLY_SCOPE=${pcLeftRailSameWindowTabsOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_PC_TOOL_WINDOW_LEFT_RAIL_LAYOUT_ONLY_SCOPE=${pcToolWindowLeftRailLayoutOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_LEGAL_DOC_SECTION_BAR_ONLY_SCOPE=${legalDocSectionBarOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_LEGAL_DOCS_FORM_STATE_ONLY_SCOPE=${legalDocsFormStateOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_PC_SVATEK_LABEL_PILL_GAP_ONLY_SCOPE=${pcSvatekLabelPillGapOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_CALENDAR_ALLDAY_PINNED_LIMIT_ONLY_SCOPE=${calendarAllDayPinnedLimitOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_DESKTOP_ARTICLE_READ_MARK_ONLY_SCOPE=${desktopArticleReadMarkOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_INFO_PANEL_CNB_RATES_ONLY_SCOPE=${infoPanelCnbRatesOnly ? "YES" : "NO"}`);
  console.log(`SMOKE_JR_SECTION_HEADER_LINE_COLOR_ONLY_SCOPE=${jrSectionHeaderLineColorOnly ? "YES" : "NO"}`);
}

if (process.argv[1] && process.argv[1].endsWith("smoke-data-only-scope.mjs")) {
  main();
}
