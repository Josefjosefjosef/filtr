#!/usr/bin/env node
import fs from "node:fs";
import { deployProofBucket } from "./iu-cj-deploy-proof-bucket.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

expect("explicit_public", deployProofBucket({ publicationReady: true }) === "public");
expect(
  "hold",
  deployProofBucket({ publicationReady: true, lkgPublicHold: true }) === "hold"
);
expect(
  "blocked",
  deployProofBucket({ publicationReady: true, publicationEligibility: "PUBLICATION_BLOCKED" }) === "hold"
);
expect(
  "public_offer_false",
  deployProofBucket({ publicationReady: true, publicOffer: false }) === "hold"
);

for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  const product = { advertiserId: "1", productId: "p" };
  if (value !== undefined) product.publicationReady = value;
  expect("probe_" + String(value), deployProofBucket(product) === "skip");
}

const src = fs.readFileSync(
  new URL("./iu-cj-affiliate-phase3z-v51-8-final-deploy-proof-build-evidence.mjs", import.meta.url),
  "utf8"
);
expect("uses_bucket", src.includes("deployProofBucket(p)"));
expect("no_false_only_skip", !src.includes("publicationReady === false) continue"));

console.log(
  JSON.stringify({
    IU_CJ_DEPLOY_PROOF_BUCKET_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
