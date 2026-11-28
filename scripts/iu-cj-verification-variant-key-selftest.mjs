import assert from "node:assert/strict";
import {
  attestEligibility,
  compositeIdentity,
  dedupeVerificationGroups,
  runAuthorizedSourceLookup,
  VERIFICATION_STATE,
} from "./iu-cj-affiliate-phase3z-verification-pipeline-v51-8.mjs";

const full = {
  title: "Desk lamp",
  description: "Metal desk lamp",
  currentPrice: 1290,
  currency: "EUR",
  availability: "IN_STOCK",
  affiliateUrl: "https://www.anrdoezrs.net/click-101883843-111-1",
  imageUrl: "https://cdn.example/lamp.jpg",
  language: "cs",
  sectionId: "aff-dum-zahrada",
  sourceUpdatedAt: "2026-11-26T23:00:00.000Z",
};

assert.equal(compositeIdentity({ advertiserId: "111", productId: "SAME" }).key, "111|SAME");
assert.equal(compositeIdentity({ advertiserId: "111", productId: "SAME", productVariant: "v" }).key, "111|SAME|v");
assert.equal(compositeIdentity({ advertiserId: "111", productId: "ONLY", productVariant: "  " }).key, "111|ONLY");

const grouped = dedupeVerificationGroups([
  {
    source: "hold",
    priority: 1,
    identities: [
      { advertiserId: "111", productId: "SAME", productVariant: "v" },
      { advertiserId: "111", productId: "SAME", productVariant: "w" },
      { advertiserId: "111", productId: "ONLY" },
    ],
  },
]);
assert.equal(grouped.uniqueIdentities, 3);
assert.equal(grouped.duplicateRowsDropped, 0);
const keys = grouped.identities.map((row) => row.key).sort();
assert.deepEqual(keys, ["111|ONLY", "111|SAME|v", "111|SAME|w"]);

const ctx = { relationship: "joined", czEligible: true, termsAccepted: true, nowMs: Date.parse("2026-11-26T23:00:00.000Z") };
const variantV = attestEligibility({ advertiserId: "111", productId: "SAME", productVariant: "v" }, { ...ctx, sourceRecord: full });
const variantW = attestEligibility({ advertiserId: "111", productId: "SAME", productVariant: "w" }, { ...ctx, sourceRecord: { ...full, availability: "UNKNOWN" } });
assert.equal(variantV.key, "111|SAME|v");
assert.equal(variantV.verifiedEligible, true);
assert.equal(variantV.secondaryFlags.includes("currencyNotPreferred"), true);
assert.equal(variantW.key, "111|SAME|w");
assert.equal(variantW.verifiedEligible, false);
assert.equal(variantW.state, VERIFICATION_STATE.DEFERRED_CANDIDATE_UNVERIFIED);
assert.equal(variantW.missing.includes("availability"), true);

const negated = attestEligibility(
  { advertiserId: "111", productId: "SAME", productVariant: "v" },
  { ...ctx, sourceRecord: { ...full, availability: "not in stock" } },
);
assert.equal(negated.verifiedEligible, false);
assert.equal(negated.state, VERIFICATION_STATE.CONFIRMED_UNAVAILABLE);

const preorder = attestEligibility(
  { advertiserId: "111", productId: "SAME", productVariant: "w" },
  { ...ctx, sourceRecord: { ...full, availability: "PREORDER" } },
);
assert.equal(preorder.verifiedEligible, true);
assert.equal(preorder.secondaryFlags.includes("availability:PREORDER"), true);

const looked = await runAuthorizedSourceLookup({
  env: { IU_CJ_PAT: "present", IU_CJ_PUBLISHER_CID: "present" },
  confirmSourceRead: true,
  identities: [
    { advertiserId: "111", productId: "SAME", productVariant: "v" },
    { advertiserId: "111", productId: "SAME", productVariant: "w" },
    { advertiserId: "111", productId: "ONLY" },
  ],
  czEligible: true,
  termsAccepted: true,
  nowMs: ctx.nowMs,
  fetchProducts: async () => ({
    ok: true,
    kind: "success",
    resultList: [{
      id: "SAME",
      title: full.title,
      description: full.description,
      price: { amount: full.currentPrice, currency: "EUR" },
      availability: "IN_STOCK",
      link: full.affiliateUrl,
      imageUrl: full.imageUrl,
      language: "cs",
      lastUpdated: full.sourceUpdatedAt,
      sectionId: full.sectionId,
    }, {
      id: "ONLY",
      title: full.title,
      description: full.description,
      price: { amount: full.currentPrice, currency: "EUR" },
      availability: "IN_STOCK",
      link: full.affiliateUrl,
      imageUrl: full.imageUrl,
      language: "cs",
      lastUpdated: full.sourceUpdatedAt,
      sectionId: full.sectionId,
    }],
  }),
});
assert.equal(looked.liveHttp, false);
assert.equal(looked.growth.allowed, 0);
const byKey = new Map(looked.results.map((row) => [row.key, row]));
assert.equal(byKey.get("111|SAME|v").verifiedEligible, false);
assert.equal(byKey.get("111|SAME|v").state, VERIFICATION_STATE.SOURCE_MISSING);
assert.equal(byKey.get("111|SAME|w").verifiedEligible, false);
assert.equal(byKey.get("111|ONLY").verifiedEligible, true);
assert.equal(byKey.get("111|ONLY").secondaryFlags.includes("currencyNotPreferred"), true);

process.stdout.write("IU_CJ_VERIFICATION_VARIANT_KEY_SELFTEST PASS\n");
