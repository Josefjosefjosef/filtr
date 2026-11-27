import assert from "node:assert/strict";
import {
  applyVerifiedIdentityRepairsToDoc,
  identityRepairKey,
} from "./iu-cj-affiliate-phase3z-identity-repair-v39.mjs";

assert.equal(identityRepairKey({ advertiserId: "111", productId: "SAME" }), "111|SAME");
assert.equal(identityRepairKey({ advertiserId: "111", productId: "SAME", productVariant: "v" }), "111|SAME|v");

const nowIso = "2026-11-26T23:00:00.000Z";
const doc = {
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR", currentPrice: 10 },
        { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR", currentPrice: 12 },
      ],
    },
  ],
};
const repairEval = {
  rows: [
    {
      sourceIdentity: "111|SAME|v",
      applyRemap: true,
      proposed: { newAdvertiserId: "222", newProductId: "SAME" },
    },
  ],
};
const out = applyVerifiedIdentityRepairsToDoc(doc, repairEval, { nowIso });
const products = out.doc.sections[0].products;
assert.equal(out.stats.remapped, 1);
assert.equal(products[0].advertiserId, "222");
assert.equal(products[0].productVariant, "v");
assert.equal(products[0].currency, "EUR");
assert.equal(products[0].identityRepairedAt, nowIso);
assert.equal(products[1].advertiserId, "111");
assert.equal(products[1].productVariant, "w");
assert.equal(products[1].currency, "EUR");
assert.equal(products[1].identityRepairedAt, undefined);

process.stdout.write("IU_CJ_IDENTITY_REPAIR_VARIANT_KEY_SELFTEST PASS\n");
