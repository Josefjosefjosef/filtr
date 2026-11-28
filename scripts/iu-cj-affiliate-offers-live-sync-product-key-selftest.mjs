import assert from "node:assert/strict";
import { publicProductSectionKey } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const a = publicProductSectionKey({ advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" });
const b = publicProductSectionKey({ advertiserId: "222", productId: "SAME", productVariant: "v", currency: "EUR" });
const again = publicProductSectionKey({ advertiserId: "111", productId: "SAME", productVariant: "v", currency: "USD" });
const otherVariant = publicProductSectionKey({ advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" });

assert.notEqual(a, b);
assert.equal(a, again);
assert.notEqual(a, otherVariant);
assert.equal(a, "111|SAME|v");
assert.equal(a.includes("EUR"), false);
assert.equal(b.includes("EUR"), false);

process.stdout.write("IU_CJ_LIVE_PRODUCT_SECTION_KEY_SELFTEST PASS\n");
