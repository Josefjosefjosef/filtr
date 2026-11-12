import { evaluateEmailTechnicalReadiness } from "./iu-cj-affiliate-phase3z-email-technical-readiness-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const r = evaluateEmailTechnicalReadiness(process.cwd());
assert(r.publicationDefault === "DISARMED", "disarmed");
assert(r.codePathPresent === true, "modules: " + JSON.stringify(r.missing));
assert(r.reconcileSafetyPresent === true, "reconcile safety");
assert(r.verdict === "TECHNICALLY_READY_PUBLICATION_DISARMED", "verdict");

console.log(
  JSON.stringify({
    IU_CJ_EMAIL_TECHNICAL_READINESS_SELFTEST: "PASS",
    verdict: r.verdict,
    ownerActions: r.ownerActions.length,
  }),
);
