import assert from "node:assert/strict";
import { planIdentityNext, planIdentityNextBatch } from "./iu-cj-affiliate-phase3z-lkg-identity-next-v51-8.mjs";

const lkg = planIdentityNext({
  key: "6109393|3338_4-MARK-ATTY16",
  nextState: "lkg",
  stateReason: "ONLY_IN_LKG_SNAPSHOT",
  absenceIsNotRecovery: true,
  publishedProof: false,
});
assert.equal(lkg.nextStep, "RETRY_SOURCE_READ_KEEP_LAST_VALID");
assert.equal(lkg.lkgReason, "ONLY_IN_LKG_SNAPSHOT");
assert.equal(lkg.lastValidSource, null);
assert.equal(lkg.lastVerificationAt, null);
assert.deepEqual(lkg.missing.sort(), ["lastValidSource", "lastVerificationAt"]);
assert.equal(lkg.absenceIsNotRecovery, true);
assert.equal(lkg.publishedProof, false);
assert.equal(lkg.growthExecute, "DISARMED");
assert.equal(lkg.restoreOrSafeRemove, "KEEP_UNTIL_SOURCE_SAYS_UNAVAILABLE");

const pending = planIdentityNext({
  key: "5398156|103236",
  nextState: "pending_verification",
  stateReason: "NOT_IN_CURRENT_OFFERS_NOR_DEFERRED_LEDGER_REVERIFY_REQUIRED",
  absenceIsNotRecovery: true,
});
assert.equal(pending.nextStep, "ENTER_VERIFICATION_QUEUE");
assert.equal(pending.publicationExecute, false);
assert.equal(pending.publishedProof, false);

const absent = planIdentityNext({
  key: "1|gone",
  nextState: "pending_verification",
  absenceIsNotRecovery: true,
});
assert.notEqual(absent.nextStep, "PUBLISH_BECAUSE_ABSENT");
assert.equal(absent.absenceIsNotRecovery, true);

const known = planIdentityNext({
  key: "2|known",
  nextState: "lkg",
  lkgReason: "FETCH_TIMEOUT",
  lastValidSource: "2026-11-20T00:00:00.000Z",
  lastVerificationAt: "2026-11-20T00:00:00.000Z",
});
assert.deepEqual(known.missing, []);
assert.equal(known.lastValidSource, "2026-11-20T00:00:00.000Z");

const batch = planIdentityNextBatch([
  { key: "a|1", nextState: "lkg", stateReason: "ONLY_IN_LKG_SNAPSHOT" },
  { key: "b|2", nextState: "pending_verification", stateReason: "REVERIFY" },
]);
assert.equal(batch.count, 2);
assert.equal(batch.byStep.RETRY_SOURCE_READ_KEEP_LAST_VALID, 1);
assert.equal(batch.byStep.ENTER_VERIFICATION_QUEUE, 1);
assert.equal(batch.growthExecute, "DISARMED");
assert.equal(batch.rows.every((row) => row.publishedProof === false), true);

console.log(
  JSON.stringify({
    IU_CJ_LKG_IDENTITY_NEXT_SELFTEST: "PASS",
    lkgMissing: lkg.missing,
    pendingStep: pending.nextStep,
    batch: batch.byStep,
  }),
);
