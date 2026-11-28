#!/usr/bin/env node
import { runGrowthShadowMode } from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";

const existing = Array.from({ length: 10 }, (_, i) => ({
  advertiserId: "1",
  productId: "live-" + i,
  title: "L" + i,
  currentPrice: 10,
  currency: "CZK",
  affiliateUrl: "https://www.kqzyfj.com/click-101883843-1-live-" + i,
  publicationReady: true,
  publicOffer: true,
  publicationEligibility: "PUBLICATION_ELIGIBLE",
  availability: "IN_STOCK",
  availabilityClass: "IN_STOCK",
  sectionKey: "aff-elektro",
}));
const offersDoc = {
  sections: [
    { sectionKey: "aff-elektro", coupons: [], actions: [], products: existing },
  ],
  publicGrowthBudget: { deferredNew: 1 },
};
const report = runGrowthShadowMode({
  offersDoc,
  durableProducts: [
    ...existing,
    {
      advertiserId: "1",
      productId: "P",
      productVariant: "v",
      title: "P",
      currentPrice: 10,
      currency: "CZK",
      affiliateUrl: "https://www.kqzyfj.com/click-101883843-1-P",
      publicationReady: true,
      publicOffer: true,
      publicationEligibility: "PUBLICATION_ELIGIBLE",
      availability: "IN_STOCK",
      availabilityClass: "IN_STOCK",
      sectionKey: "aff-elektro",
    },
  ],
  joinedPartners: [{ advertiserId: "1", cjStatus: "JOINED", name: "A" }],
  iterations: 1,
  batchSize: 5,
  uncappedShadow: true,
});
const admitted = (report.shadowDoc?.sections || [])
  .flatMap((section) => section.products || [])
  .find((product) => product.productId === "P");
if (!admitted || admitted.productVariant !== "v") {
  console.error(JSON.stringify(admitted || null));
  process.exit(1);
}
if (report.wroteProjectsData !== false || report.growthGateStillLocked !== true) {
  console.error("gate");
  process.exit(1);
}
if (process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED === "1") {
  console.error("env");
  process.exit(1);
}
console.log(JSON.stringify({
  SHADOW_VARIANT_SELFTEST: "PASS",
  productVariant: admitted.productVariant,
  wroteProjectsData: report.wroteProjectsData,
  growthGateStillLocked: report.growthGateStillLocked,
}));
