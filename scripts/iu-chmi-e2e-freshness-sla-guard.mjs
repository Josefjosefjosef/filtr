#!/usr/bin/env node
/**
 * Guard: CHMI CAP E2E publish path is configured for ≤15 min SLA.
 * Static checks only (does not hit production HTTP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WF = path.join(ROOT, ".github", "workflows", "update-chmi-cap-v2.yml");
const PAGES = path.join(ROOT, ".github", "workflows", "pages-publish-from-main-data.yml");
const SYNC = path.join(ROOT, "scripts", "chmi-cap-v2-prod-sync.mjs");
const WD = path.join(ROOT, ".github", "workflows", "chmi-cap-v2-freshness-watchdog.yml");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const wf = fs.readFileSync(WF, "utf8");
const pages = fs.readFileSync(PAGES, "utf8");
const sync = fs.readFileSync(SYNC, "utf8");
const wd = fs.existsSync(WD) ? fs.readFileSync(WD, "utf8") : "";

ok("cron_5min", /cron:\s*"\*\/5 \* \* \* \*"/.test(wf), "cron");
ok("sla_env", /IU_CHMI_E2E_SLA_MS/.test(wf), "sla env");
ok("pages_after_merge", /Dispatch Pages after successful data merge/.test(wf), "pages step");
ok("pages_dispatch", /gh workflow run pages\.yml --ref main/.test(wf), "pages.yml");
ok("auto_merge", /gh pr merge .*--auto --squash/.test(wf), "auto-merge");
ok("data_only_scope", /projects\/data\/info_events\/\*/.test(wf), "scope");
ok("pages_catchup_chmi", /Update CHMI CAP v2/.test(pages), "catchup");
ok("freshness_meta", /endToEndLagMs/.test(sync) && /officialLatestSentAt/.test(sync), "meta");
ok("freshness_sla_limit", /slaLimitMs:\s*15\s*\*\s*60\s*\*\s*1000/.test(sync), "15m");
ok("watchdog_exists", wd.length > 0, "watchdog file");
ok("watchdog_fail_closed", /CHMI_CAP_FRESHNESS_WATCHDOG=FAIL/.test(wd) || /SOURCE_NEW_PRODUCTION_STALE/.test(wd), "fail");
ok("watchdog_detects_disabled", /WORKFLOW_DISABLED/.test(wd), "disabled");
ok("watchdog_enable_hint", /gh workflow enable/.test(wd), "enable hint");

if (fails.length) {
  console.error("IU_CHMI_E2E_FRESHNESS_SLA=FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("IU_CHMI_E2E_FRESHNESS_SLA=PASS");
