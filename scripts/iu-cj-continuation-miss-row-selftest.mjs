#!/usr/bin/env node
import fs from "node:fs";
import { classifyMissRow } from "./iu-cj-continuation-miss-row.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const recovered = classifyMissRow({
  decision: "RECOVERED",
  sourceIdentity: "1|p",
  classificationVerified: true,
  publicationReady: true,
  publicationSafe: true,
});
expect("recovered_class", recovered.classId === "TEMPORARILY_UNAVAILABLE");
expect("recovered_verified", recovered.classificationVerified === true);
expect("recovered_ready", recovered.publicationReady === true);
expect("recovered_safe", recovered.publicationSafe === true);

const implied = classifyMissRow({ decision: "KEEP_PENDING", sourceIdentity: "1|q" });
expect("pending_class", implied.classId === "NOT_IN_CURRENT_FEED");
expect("pending_not_verified", implied.classificationVerified === false);
expect("pending_not_ready", implied.publicationReady === false);
expect("pending_not_safe", implied.publicationSafe === false);

const unresolved = classifyMissRow({
  decision: "UNVERIFIED",
  classificationVerified: true,
  publicationReady: true,
  publicationSafe: true,
});
expect("unresolved_class", unresolved.classId === "UNRESOLVED");
expect("unresolved_not_verified", unresolved.classificationVerified === false);

for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  const row = { decision: "REMOVE_CONFIRMED", sourceIdentity: "1|x" };
  if (value !== undefined) {
    row.publicationReady = value;
    row.publicationSafe = value;
    row.classificationVerified = value;
  }
  const classified = classifyMissRow(row);
  expect("ready_" + String(value), classified.publicationReady === false);
  expect("safe_" + String(value), classified.publicationSafe === false);
  expect("verified_" + String(value), classified.classificationVerified === false);
}

const src = fs.readFileSync(
  new URL("./iu-cj-affiliate-phase3z-v51-8-continuation-build-evidence.mjs", import.meta.url),
  "utf8"
);
expect("imported", src.includes('import { classifyMissRow } from "./iu-cj-continuation-miss-row.mjs"'));
expect("no_implied_verified", !src.includes("classificationVerified: classId !== \"UNRESOLVED\""));

console.log(
  JSON.stringify({
    IU_CJ_CONTINUATION_MISS_ROW_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
