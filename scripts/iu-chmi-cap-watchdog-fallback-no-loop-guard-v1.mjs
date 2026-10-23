#!/usr/bin/env node
/**
 * Regression: CHMI CAP watchdog GitHub fallback must not re-dispatch after every sync completion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.IU_CHMI_GUARD_REPO_ROOT
  ? path.resolve(process.env.IU_CHMI_GUARD_REPO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallback = fs.readFileSync(
  path.join(ROOT, ".github/workflows/chmi-cap-watchdog-cron-fallback.yml"),
  "utf8",
);

const fails = [];
function ok(name, cond) {
  if (!cond) fails.push(name);
}

ok("no_workflow_run_trigger", !/^\s*workflow_run:/m.test(fallback));
ok("no_chmi_completion_chain", !/workflows:\s*\[\s*"Update CHMI CAP v2"\s*\]/.test(fallback));
const staleSection = fallback.split("Stale-gated")[1] || "";
ok("stale_path_no_force_dispatch_1", !/\?dispatch=1/.test(staleSection));
ok("force_dispatch_gated", /force_probe_dispatch/.test(fallback));
ok("stale_gated_recovery", /WATCHDOG_STALE_RECOVERY_DISPATCH/.test(fallback));
ok("observe_before_dispatch", /chmi_cap_watchdog_observe\.json/.test(fallback));

if (fails.length) {
  console.error("IU_CHMI_CAP_WATCHDOG_FALLBACK_NO_LOOP_GUARD_V1=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_CAP_WATCHDOG_FALLBACK_NO_LOOP_GUARD_V1=PASS");
