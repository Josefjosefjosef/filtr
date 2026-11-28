import assert from "node:assert/strict";
import path from "node:path";
import {
  indexPreviousProductsByIdentity,
  refreshPublishedProductsFromCj,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const prev = {
  sections: [{
    sectionKey: "aff-nabytek",
    products: [
      { advertiserId: "111", productId: "SAME", productVariant: "v", currentPrice: 9, currency: "EUR", lastSuccessfulRefreshAt: "2026-11-26T00:00:00.000Z" },
      { advertiserId: "111", productId: "SAME", productVariant: "w", currentPrice: 2, currency: "EUR", lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z" },
      { advertiserId: "111", productId: "ONLY", currentPrice: 4, currency: "EUR", availability: "backorder", lastSuccessfulRefreshAt: "2026-11-20T00:00:00.000Z" },
    ],
  }],
};
const map = indexPreviousProductsByIdentity(prev);
assert.equal(map.get("111|SAME|v").currentPrice, 9);
assert.equal(map.get("111|SAME|v").currency, "EUR");
assert.equal(map.get("111|SAME|w").currentPrice, 2);
assert.equal(map.get("111|SAME|w").currency, "EUR");
assert.equal(map.get("111|SAME|w").lastSuccessfulRefreshAt, "2026-11-01T00:00:00.000Z");
assert.equal(map.get("111|ONLY").availability, "backorder");
assert.equal(map.get("111|ONLY").currency, "EUR");
assert.equal(map.has("111|SAME"), false);

const out = await refreshPublishedProductsFromCj({
  prevPublic: prev,
  env: {
    IU_CJ_REFRESH_CHECKPOINT_PATH: path.join(process.env.TEMP, "iu-refresh-prev-missing.json"),
  },
});
assert.equal(out.meta.skippedNoCredentials, true);
assert.equal(out.meta.apiRequests, 0);

process.stdout.write("IU_CJ_REFRESH_PREV_VARIANT_SELFTEST PASS\n");
