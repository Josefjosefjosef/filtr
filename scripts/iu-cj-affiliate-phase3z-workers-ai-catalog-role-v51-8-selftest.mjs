import { evaluateWorkersAiCatalogRole } from "./iu-cj-affiliate-phase3z-workers-ai-catalog-role-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const r = evaluateWorkersAiCatalogRole(process.cwd());
assert(r.requiredForCatalogProductSync === false, "not required");
assert(r.verdict === "NON_BLOCKING_SUPPLEMENTARY", "verdict=" + r.verdict);
assert(r.ownerFixGuidePresent === true, "guide");
assert(r.publicationArmed === false, "disarmed");

console.log(
  JSON.stringify({
    IU_CJ_WORKERS_AI_CATALOG_ROLE_SELFTEST: "PASS",
    verdict: r.verdict,
    role: r.role,
  }),
);
