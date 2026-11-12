import { runPartnerLifecycleScenarios } from "./iu-cj-affiliate-phase3z-partner-lifecycle-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const r = runPartnerLifecycleScenarios();
assert(r.ok === true, "lifecycle: " + JSON.stringify(r.failed));

console.log(
  JSON.stringify({
    IU_CJ_PARTNER_LIFECYCLE_SELFTEST: "PASS",
    scenarios: r.scenarios.length,
  }),
);
