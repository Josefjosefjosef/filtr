import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  classifyIdentity,
  exportProductInventoryJsonl,
  indexOffersByAdvertiser,
  reconProductKey,
} from "./iu-cj-affiliate-joined-partner-recon-export-v1.mjs";

assert.equal(reconProductKey("111", { productId: "SAME" }), "111|SAME");
assert.equal(reconProductKey("111", { productId: "SAME", productVariant: "v" }), "111|SAME|v");

const indexed = indexOffersByAdvertiser({
  sections: [
    {
      sectionKey: "aff-nabytek",
      products: [
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
        { advertiserId: "111", productId: "SAME", productVariant: "w", currency: "EUR" },
        { advertiserId: "111", productId: "SAME", productVariant: "v", currency: "EUR" },
      ],
    },
  ],
});
const bucket = indexed.byAdv.get("111");
assert.equal(bucket.productKeys.size, 2);
assert.equal(bucket.productPlacements, 3);
assert.equal(bucket.productKeys.has("111|SAME|v"), true);
assert.equal(bucket.productKeys.has("111|SAME|w"), true);
assert.equal(bucket.productKeys.has("111|SAME"), false);

const ctx = {
  joinedIds: new Set(["111"]),
  endedIds: new Set(),
  publishedKeys: new Set(["111|SAME|v", "111|ONLY"]),
  heldKeys: new Set(),
  invalidKeys: new Set(),
  retryKeys: new Set(),
  deferredKeys: new Set(),
  growthBudgetExhausted: true,
};
const base = {
  advertiserId: "111",
  title: "t",
  imageUrl: "i",
  currentPrice: "1",
  affiliateUrl: "u",
  publicationEligibility: "PUBLICATION_ELIGIBLE",
  freshnessStatus: "SOURCE_VERIFIED",
  currency: "EUR",
};
assert.equal(classifyIdentity({ ...base, productId: "SAME", productVariant: "v" }, ctx), "published");
assert.equal(classifyIdentity({ ...base, productId: "SAME", productVariant: "w" }, ctx), "eligible_new");
assert.equal(classifyIdentity({ ...base, productId: "ONLY" }, ctx), "published");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-cj-recon-variant-"));
const shard = path.join(dir, "iu-affiliate-cj-durable-catalog-shard-v51-s0000.json");
fs.writeFileSync(shard, JSON.stringify({
  products: {
    "111|SAME|v": { ...base, productId: "SAME", productVariant: "v" },
    "111|SAME|w": { ...base, productId: "SAME", productVariant: "w" },
    "111|ONLY": { ...base, productId: "ONLY" },
  },
}));
const exported = await exportProductInventoryJsonl({
  shardFiles: [shard],
  outFile: path.join(dir, "inv.jsonl.gz"),
  ctx,
});
assert.equal(exported.uniqueCompositeIds, 3);
assert.equal(exported.duplicates, 0);
assert.equal(exported.identityCollisions, 0);
const lines = zlib.gunzipSync(fs.readFileSync(exported.jsonl.file)).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
const byKey = new Map(lines.map((line) => [line.key, line]));
assert.equal(byKey.get("111|SAME|v").primaryState, "published");
assert.equal(byKey.get("111|SAME|v").currency, "EUR");
assert.equal(byKey.get("111|SAME|w").primaryState, "eligible_new");
assert.equal(byKey.get("111|SAME|w").currency, "EUR");
assert.equal(byKey.get("111|ONLY").productVariant, null);

process.stdout.write("IU_CJ_RECON_VARIANT_KEY_SELFTEST PASS\n");
