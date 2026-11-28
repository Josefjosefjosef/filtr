#!/usr/bin/env node
import { classifyMissRow } from "./iu-cj-miss-row-classification.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pending = classifyMissRow({
  decision: "KEEP_PENDING",
  apiResult: "productIds_miss",
  sourceIdentity: "1|P",
});
assert(pending.classId === "NOT_IN_CURRENT_FEED", "pending class");
assert(pending.classificationVerified === false, "missing flag is not verified");

const explicit = classifyMissRow({
  decision: "KEEP_PENDING",
  apiResult: "productIds_miss",
  classificationVerified: true,
});
assert(explicit.classificationVerified === true, "explicit true stays verified");

const denied = classifyMissRow({
  decision: "KEEP_PENDING",
  apiResult: "productIds_miss",
  classificationVerified: false,
});
assert(denied.classificationVerified === false, "explicit false stays unverified");

const unresolved = classifyMissRow({
  decision: "",
  apiResult: "",
  classificationVerified: true,
});
assert(unresolved.classId === "UNRESOLVED", "unknown stays unresolved");
assert(unresolved.classificationVerified === false, "unresolved is not verified");

const recoveredMissing = classifyMissRow({ decision: "RECOVERED" });
assert(recoveredMissing.classId === "TEMPORARILY_UNAVAILABLE", "recovered class");
assert(recoveredMissing.classificationVerified === false, "recovered without flag is not verified");

const recoveredExplicit = classifyMissRow({
  decision: "RECOVERED",
  classificationVerified: true,
});
assert(recoveredExplicit.classificationVerified === true, "explicit recovered stays verified");

const probes = [true, false, null, undefined, "", "true", "false", 0, 1];
for (const value of probes) {
  const row = classifyMissRow({
    decision: "KEEP_PENDING",
    apiResult: "productIds_miss",
    publicationReady: value,
    publicationSafe: value,
  });
  const expectTrue = value === true;
  assert(row.publicationReady === expectTrue, "publicationReady probe " + String(value));
  assert(row.publicationSafe === expectTrue, "publicationSafe probe " + String(value));
}
const omitted = classifyMissRow({
  decision: "KEEP_PENDING",
  apiResult: "productIds_miss",
});
assert(omitted.publicationReady === false, "missing publicationReady is false");
assert(omitted.publicationSafe === false, "missing publicationSafe is false");

console.log(JSON.stringify({
  IU_CJ_MISS_ROW_CLASSIFICATION_SELFTEST: "PASS",
  pending: pending.classificationVerified,
  explicit: explicit.classificationVerified,
  unresolved: unresolved.classId,
}));
