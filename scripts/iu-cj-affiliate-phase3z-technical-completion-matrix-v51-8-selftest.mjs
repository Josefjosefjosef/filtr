import { buildTechnicalCompletionMatrix } from "./iu-cj-affiliate-phase3z-technical-completion-matrix-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const m = buildTechnicalCompletionMatrix({ repoRoot: process.cwd() });
assert(m.counts.notImplemented === 0, "no NOT_IMPLEMENTED: " + JSON.stringify(m.items.filter((i) => i.status === "NOT_IMPLEMENTED")));
assert(m.verdict === "TECHNICALLY_COMPLETE", "verdict=" + m.verdict);
assert(m.items.some((i) => i.id === "schedule_two_on_final_sha" && i.status === "PENDING_OBSERVATION"), "schedule pending");
assert(m.items.some((i) => i.id === "uncapped_growth_production" && i.status === "BLOCKED_OWNER_ACTION"), "uncapped owner");

console.log(
  JSON.stringify({
    IU_CJ_TECHNICAL_COMPLETION_MATRIX_SELFTEST: "PASS",
    verdict: m.verdict,
    counts: m.counts,
  }),
);
