#!/usr/bin/env node
import fs from "node:fs";
import { explicitPublicationReady } from "./iu-cj-explicit-publication-ready.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect("true", explicitPublicationReady(true) === true);
for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  expect("probe_" + String(value), explicitPublicationReady(value) === false);
}

const src = fs.readFileSync(
  new URL("./iu-cj-affiliate-phase3z-v51-5-build-evidence.mjs", import.meta.url),
  "utf8"
);
expect("coupon_call", src.includes("explicitPublicationReady(c.publicationReady)"));
expect("action_call", src.includes("explicitPublicationReady(a.publicationReady)"));
expect("no_fail_open", !src.includes("publicationReady !== false"));

console.log(
  JSON.stringify({
    IU_CJ_EXPLICIT_PUBLICATION_READY_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
