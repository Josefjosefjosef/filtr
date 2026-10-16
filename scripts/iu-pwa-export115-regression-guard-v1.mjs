#!/usr/bin/env node
/**
 * Regression guard for physical export 115 (Dokument 115.docx baseline).
 *
 * CI failure 38634183194 @ 90f2c70 (static:aff_in_scope_strict):
 * - Guard required source line: affInScope = mode === "affiliate" && probeState.sectionActive
 * - After schema split, affInScope = contentReadinessScope && probeState.sectionActive
 *   (expected section vs scoped active shell are different fields).
 * - Old regex was a stale proxy for "do not widen sectionActive with mobileMain only";
 *   replacement checks contentReadinessScope + scoped affInScope + export114ParadoxNote.
 * Behavioral paradox repro: npm run iu-pwa-affiliate-paradox-repro-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

const rec = read("assets/iu-pwa-return-recorder-v1.js");
const html = read("projects/index.html");
const feed = read("assets/iu-app-feed-pipeline-v1.js");

must(/pwa-return-recorder-v9-20261016-export118-video-home-diag/.test(rec), "static:recorder_build");
must(/routeChromeActive/.test(rec), "static:route_chrome");
must(/aff_route_chrome_without_shell/.test(rec), "static:route_unmet");
must(/partnerHrefSlots/.test(rec), "static:partner_href");
must(html.includes("iuMobileSilverSlot"), "static:mm_boot_hide_silver");
must(/deferMmBootRelease/.test(feed), "static:defer_boot_release");
must(/mindmenu-scroll-restored/.test(feed), "static:boot_release_after_scroll");
must(/boot-watchdog-2400ms/.test(html), "static:mm_boot_watchdog");
must(/mindmenu-scroll-zero/.test(feed), "static:mm_boot_release_zero_scroll");
must(/mindmenu-scroll-timeout/.test(feed), "static:mm_boot_release_timeout");

must(/contentReadinessScope = mode === "affiliate"/.test(rec), "static:content_readiness_scope");
must(/affInScope = contentReadinessScope && probeState\.sectionActive/.test(rec), "static:aff_in_scope_scoped_shell");
must(/export114ParadoxNote/.test(rec), "static:export114_paradox_documented");

if (fails.length) {
  console.log("IU_PWA_EXPORT115_REGRESSION_GUARD=FAIL");
  console.log(fails.join(","));
  process.exit(1);
}
console.log("IU_PWA_EXPORT115_REGRESSION_GUARD=PASS");
