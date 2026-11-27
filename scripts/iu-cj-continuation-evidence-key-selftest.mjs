import assert from "node:assert/strict";
import { continuationEvidenceKey } from "./iu-cj-continuation-evidence-key.mjs";

assert.equal(continuationEvidenceKey({ advertiserId: "111", productId: "SAME" }), "111|SAME");
assert.equal(
  continuationEvidenceKey({ advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" }),
  "111|SAME|v",
);
assert.equal(
  continuationEvidenceKey({ advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" }),
  "111|SAME|w",
);
assert.equal(
  continuationEvidenceKey({ sourceIdentity: "111|SAME|v", advertiserId: "111", productId: "SAME", productVariant: "v" }),
  "111|SAME|v",
);
assert.equal(
  continuationEvidenceKey({ sourceIdentity: "111|SAME", advertiserId: "111", productId: "SAME", productVariant: "v" }),
  "111|SAME|v",
);
assert.equal(
  continuationEvidenceKey({ sourceIdentity: "111|SAME", advertiserId: "111", productId: "SAME" }),
  "111|SAME",
);
assert.equal(
  continuationEvidenceKey({ advertiserId: "111", productId: "SAME", productVariant: "v" })
    === continuationEvidenceKey({ advertiserId: "111", productId: "SAME", productVariant: "w" }),
  false,
);

process.stdout.write("IU_CJ_CONTINUATION_EVIDENCE_KEY_SELFTEST PASS\n");
