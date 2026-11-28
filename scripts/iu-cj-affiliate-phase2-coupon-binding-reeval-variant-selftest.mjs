#!/usr/bin/env node
/**
 * The historical reeval script runs on import, so this test reads it as text
 * and checks the landing batch key helper directly.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { landingBatchKey } from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(here, "iu-cj-affiliate-phase2-coupon-binding-reeval.mjs"),
  "utf8"
);
const call = "landingBatchKey(row.linkId, prod.productId, prod.productVariant)";
if (!src.includes(call)) {
  console.error("reeval landing batch lookup drops productVariant");
  process.exit(1);
}
if (landingBatchKey("L", "P") !== "L:P") {
  console.error("missing variant changed the old batch key");
  process.exit(1);
}
if (landingBatchKey("L", "P", " ") !== "L:P") {
  console.error("blank variant changed the old batch key");
  process.exit(1);
}
if (landingBatchKey("L", "P", "red") !== "L:P:red") {
  console.error("variant products share one landing batch key");
  process.exit(1);
}
if (landingBatchKey("L", "P", "red") === landingBatchKey("L", "P", "blue")) {
  console.error("two variants collapsed");
  process.exit(1);
}
console.log("PASS reeval landing batch variant key");
