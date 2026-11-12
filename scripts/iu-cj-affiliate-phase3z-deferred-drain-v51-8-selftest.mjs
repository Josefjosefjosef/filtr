import { runDeferredDrainScenarios } from "./iu-cj-affiliate-phase3z-deferred-drain-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const r = runDeferredDrainScenarios();
assert(r.ok === true, "deferred drain: " + JSON.stringify(r.failed));

console.log(
  JSON.stringify({
    IU_CJ_DEFERRED_DRAIN_SELFTEST: "PASS",
    scenarios: r.results.length,
  }),
);
