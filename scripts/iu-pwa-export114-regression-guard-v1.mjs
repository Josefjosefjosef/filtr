#!/usr/bin/env node
/**
 * Static regression guard for physical export 114 findings (affiliate probe, milestones, eviction).
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

must(/pwa-return-recorder-v9-20261016-export117-hotovo-boot-hold/.test(rec), "static:recorder_build");
must(html.includes("pwa-return-recorder-v9-20261016-export117-hotovo-boot-hold"), "static:html_bust");
must(/routeChromeActive/.test(rec), "static:aff_route_chrome_split");
must(/sectionActive = hubAff && \(shellMounted \|\| shellVisible\)/.test(rec), "static:aff_section_active_shell_only");
must(!/shellVisible \|\| mobileMain/.test(rec), "static:aff_section_not_mobile_main");
must(/aff_route_chrome_without_shell/.test(rec), "static:aff_route_chrome_unmet");
must(/layoutMountBlockers/.test(rec), "static:aff_mount_blockers");
must(/partnerHrefSlots/.test(rec), "static:aff_partner_href_slots");
must(/contentReadinessScope/.test(rec), "static:content_readiness_scope");
must(/CRITICAL_WINDOW_ANCHOR_KEY/.test(rec), "static:critical_window_anchor");
must(/touchCriticalWindowAnchor/.test(rec), "static:critical_window_touch");
must(/Sliding 120s from the most recent settle/.test(rec), "static:critical_window_sliding");
must(/affLayoutMounted/.test(rec), "static:aff_layout_mounted_field");
must(/export114ParadoxNote/.test(rec), "static:export114_paradox_note");
must(/scheduleReturnRelativeMilestones/.test(rec), "static:return_relative_milestones");
must(/anchor: "last_settle_done"/.test(rec), "static:milestone_anchor_settle");
must(/readyPhase: affShellLane/.test(rec), "static:ready_phase_dynamic");
must(/route_chrome_only/.test(rec), "static:ready_phase_route_chrome");
must(/droppedByEv/.test(rec), "static:dropped_by_ev");
must(/probeUnmetReasons = unmet/.test(rec), "static:timeout_probe_unmet");
must(/nav:assign/.test(rec), "static:nav_assign_logged");
must(/msSinceLastSettle/.test(rec), "static:correlation_settle_ms");
must(/partnerCatalogExpected/.test(rec), "static:aff_partner_catalog_expected");
must(/partners_catalog_not_rendered/.test(rec), "static:aff_partners_not_rendered");

if (fails.length) {
  console.log("IU_PWA_EXPORT114_REGRESSION_GUARD=FAIL");
  console.log(fails.join(","));
  process.exit(1);
}
console.log("IU_PWA_EXPORT114_REGRESSION_GUARD=PASS");
