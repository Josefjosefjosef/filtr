#!/usr/bin/env node
import fs from "node:fs";
import { functionalRepairFetched } from "./iu-cj-functional-repair-fetched.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect("explicit_true", functionalRepairFetched({ publicationReady: true }) === true);
for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  const product = { advertiserId: "1", productId: "p" };
  if (value !== undefined) product.publicationReady = value;
  expect("probe_" + String(value), functionalRepairFetched(product) === false);
}
expect("missing_product", functionalRepairFetched(null) === false);

const src = fs.readFileSync(
  new URL("./iu-cj-affiliate-phase3z-v51-8-final-functional-repair-build-evidence.mjs", import.meta.url),
  "utf8"
);
expect("uses_helper", src.includes("functionalRepairFetched(p)"));
expect("no_false_only_skip", !src.includes("publicationReady === false) continue"));

console.log(
  JSON.stringify({
    IU_CJ_FUNCTIONAL_REPAIR_FETCHED_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
