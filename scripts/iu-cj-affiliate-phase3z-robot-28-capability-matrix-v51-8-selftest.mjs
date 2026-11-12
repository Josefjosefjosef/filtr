import { buildRobot28CapabilityMatrix } from "./iu-cj-affiliate-phase3z-robot-28-capability-matrix-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const m = buildRobot28CapabilityMatrix({ cloudflareRecoveryVerified: false });
assert(m.counts.total === 28, "28 caps");
assert(m.counts.notImplemented === 0, "no NOT_IMPLEMENTED");
assert(m.items.find((i) => i.id === 21).status === "TESTED", "recovery not yet PV");
const m2 = buildRobot28CapabilityMatrix({ cloudflareRecoveryVerified: true });
assert(m2.items.find((i) => i.id === 21).status === "PRODUCTION_VERIFIED", "recovery PV");

console.log(
  JSON.stringify({
    IU_CJ_ROBOT_28_MATRIX_SELFTEST: "PASS",
    counts: m.counts,
  }),
);
