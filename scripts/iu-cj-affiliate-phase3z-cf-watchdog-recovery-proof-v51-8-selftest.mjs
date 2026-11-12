import {
  proveCfWatchdogRecoveryMatrix,
  CATCHUP_DISPATCH_INPUTS,
} from "./iu-cj-affiliate-phase3z-cf-watchdog-recovery-proof-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const report = proveCfWatchdogRecoveryMatrix();
assert(report.ok === true, "recovery matrix: " + JSON.stringify(report.failed));
assert(CATCHUP_DISPATCH_INPUTS.catchup_dispatch === "1", "catchup marker");
assert(CATCHUP_DISPATCH_INPUTS.arm_publish === "0", "publish disarmed");

console.log(
  JSON.stringify({
    IU_CJ_CF_WATCHDOG_RECOVERY_PROOF_SELFTEST: "PASS",
    cases: report.cases.length,
    catchupInputsSafe: report.catchupInputsSafe,
  }),
);
