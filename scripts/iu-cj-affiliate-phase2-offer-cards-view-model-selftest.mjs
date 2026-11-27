#!/usr/bin/env node
import { productCardFromPipeline } from "./iu-cj-affiliate-phase2-offer-cards-view-model.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const gates = { publicationGatesTextOnly: { publicationReady: false, blockers: [] }, productEval: {} };
const withVariant = productCardFromPipeline(
  gates,
  { productId: "same", productVariant: "v", title: "A", price: 10, currency: "CZK" },
  "Shop",
);
const plain = productCardFromPipeline(gates, { productId: "same", title: "A" }, "Shop");
assert(withVariant.productVariant === "v", "variant stays on the card");
assert(withVariant.productId === "same", "product id stays");
assert(withVariant.publicationReady === false, "gate still controls publication");
assert(plain.productVariant == null, "missing variant stays absent");
assert(plain.productId === "same", "plain product id stays");

console.log(JSON.stringify({ IU_CJ_OFFER_CARD_VIEW_MODEL_SELFTEST: "PASS" }));
