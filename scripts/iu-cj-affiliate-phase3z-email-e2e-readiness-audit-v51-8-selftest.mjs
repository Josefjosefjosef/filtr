import { buildEmailE2EReadinessAudit } from "./iu-cj-affiliate-phase3z-email-e2e-readiness-audit-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const a = buildEmailE2EReadinessAudit({ repoRoot: process.cwd() });
assert(a.publishingDisarmed === true, "publishingDisarmed");
assert(a.readOnly === true, "readOnly");
assert(a.emailOfferStagingArmed === false && a.growthArmed === false, "nothing armed");
assert(Array.isArray(a.supportedOfferTypes), "supportedOfferTypes array");
assert(a.supportedOfferTypes.length > 0, "supportedOfferTypes non-empty");
assert(Array.isArray(a.unsupportedOfferTypes), "unsupportedOfferTypes array");
assert(
  a.supportedOfferTypes.every((t) => !a.unsupportedOfferTypes.includes(t)),
  "supported/unsupported disjoint",
);
assert(a.secretNameMapping && Array.isArray(a.secretNameMapping.suggestedMapping), "secret mapping");
assert(typeof a.secretNameMapping.drift === "boolean", "drift flag");

console.log(
  JSON.stringify({
    IU_CJ_EMAIL_E2E_READINESS_AUDIT_SELFTEST: "PASS",
    publishingDisarmed: a.publishingDisarmed,
    supportedOfferTypes: a.supportedOfferTypes,
    unsupportedOfferTypes: a.unsupportedOfferTypes,
    secretNameDrift: a.secretNameMapping.drift,
    verdict: a.verdict,
  }),
);
