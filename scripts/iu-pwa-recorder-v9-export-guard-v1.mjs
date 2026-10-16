#!/usr/bin/env node
/**
 * Static guard: recorder v9 attempt-priority export + cross-document correlation keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

const rec = fs.readFileSync(path.join(REPO, "assets/iu-pwa-return-recorder-v1.js"), "utf8");
const html = fs.readFileSync(path.join(REPO, "projects/index.html"), "utf8");

must(/pwa-return-recorder-v9-20261016-export119-shell-boot-race/.test(rec), "static:v9_build");
must(/affiliateSectionProbeState/.test(rec), "static:scoped_aff_probe");
must(/resourceTimingBrief/.test(rec), "static:resource_timing");
must(/entryEvictTier/.test(rec), "static:evict_tier");
must(/persistCorrelationState/.test(rec), "static:correlation_persist");
must(/restoreCorrelationState/.test(rec), "static:correlation_restore");
must(/correlationExport/.test(rec), "static:export_correlation_block");
must(/tryAggregateNetFetch/.test(rec), "static:net_agg");
must(/sectionProbeMode/.test(rec), "static:section_probe_mode");
must(/chmiFeedContentMetrics/.test(rec), "static:chmi_probe");
must(/resourceCountsBefore/.test(rec), "static:stop_counts_before");
must(/origWindowFetch/.test(rec), "static:fetch_unwrap");
must(/attempt:milestone/.test(rec), "static:attempt_milestones");
must(html.includes("pwa-return-recorder-v9-20261016-export119-shell-boot-race"), "static:html_cache_bust");

if (fails.length) {
  console.log("IU_PWA_RECORDER_V9_EXPORT_GUARD=FAIL");
  for (const f of fails) console.log(f);
  process.exit(1);
}
console.log("IU_PWA_RECORDER_V9_EXPORT_GUARD=PASS");
