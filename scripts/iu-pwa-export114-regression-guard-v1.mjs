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

must(/pwa-return-recorder-v9-20261015-export114-fixes/.test(rec), "static:recorder_build");
must(html.includes("pwa-return-recorder-v9-20261015-export114-fixes"), "static:html_bust");
must(/shellMounted \|\| shellVisible/.test(rec), "static:aff_section_active_mounted");
must(/scheduleReturnRelativeMilestones/.test(rec), "static:return_relative_milestones");
must(/anchor: "last_settle_done"/.test(rec), "static:milestone_anchor_settle");
must(/readyPhase: "shell_or_lane"/.test(rec), "static:ready_phase_shell");
must(/droppedByEv/.test(rec), "static:dropped_by_ev");
must(/probeUnmetReasons = unmet/.test(rec), "static:timeout_probe_unmet");
must(/nav:assign/.test(rec), "static:nav_assign_logged");
must(/msSinceLastSettle/.test(rec), "static:correlation_settle_ms");
must(/chipTotal > 0 && !\(m\.partnerReadyCount > 0\)/.test(rec), "static:aff_partner_ready_conditional");

if (fails.length) {
  console.log("IU_PWA_EXPORT114_REGRESSION_GUARD=FAIL");
  console.log(fails.join(","));
  process.exit(1);
}
console.log("IU_PWA_EXPORT114_REGRESSION_GUARD=PASS");
