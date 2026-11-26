import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildAssortmentProfile } from "./iu-cj-affiliate-phase3z-assortment-v8.mjs";
import { planAdaptiveBatch } from "./iu-cj-affiliate-phase3z-adaptive-growth-controller-v51-8.mjs";
import { executePartnerAutomaticStep } from "./iu-cj-affiliate-phase3z-partner-automatic-actions-v51-8.mjs";
import {
  attestEligibility,
  dedupeVerificationGroups,
  loadCheckpoint,
  runVerificationBatch,
  VERIFICATION_STATE,
} from "./iu-cj-affiliate-phase3z-verification-pipeline-v51-8.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const full = {
  title: "Desk lamp",
  description: "Metal desk lamp",
  currentPrice: 1290,
  currency: "CZK",
  availability: "IN_STOCK",
  affiliateUrl: "https://www.anrdoezrs.net/click-1",
  imageUrl: "https://cdn.example/lamp.jpg",
  language: "cs",
  sectionId: "aff-dum-zahrada",
  sourceUpdatedAt: "2026-11-26T08:00:00.000Z",
};

const overlap = dedupeVerificationGroups([
  { source: "deferred", priority: 1, identities: [{ advertiserId: "1", productId: "a" }, { advertiserId: "1", productId: "b" }] },
  { source: "hold", priority: 5, identities: [{ advertiserId: "1", productId: "a" }, { advertiserId: "2", productId: "c" }] },
  { source: "lkg", priority: 4, identities: [{ key: "2|c" }] },
]);
expect("unique_not_sum", overlap.inputRows === 5 && overlap.uniqueIdentities === 3 && overlap.duplicateRowsDropped === 2);

const titleOnly = attestEligibility(
  { advertiserId: "9", productId: "x" },
  { relationship: "joined", sourceRecord: { title: "A", currentPrice: 10, affiliateUrl: "https://www.dpbolvw.net/click-1" }, czEligible: true, termsAccepted: true }
);
expect("title_price_url_not_eligible", titleOnly.verifiedEligible === false && titleOnly.state === VERIFICATION_STATE.DEFERRED_CANDIDATE_UNVERIFIED);

const eligible = attestEligibility(
  { advertiserId: "9", productId: "ok" },
  { relationship: "joined", sourceRecord: full, czEligible: true, termsAccepted: true }
);
expect("full_record_eligible", eligible.verifiedEligible === true && eligible.state === VERIFICATION_STATE.VERIFIED_ELIGIBLE);

const backorder = attestEligibility(
  { advertiserId: "9", productId: "bo" },
  { relationship: "joined", sourceRecord: { ...full, availability: "BACKORDER", currency: "EUR" }, czEligible: true, termsAccepted: true }
);
expect("backorder_not_invalid", backorder.verifiedEligible === true && backorder.secondaryFlags.includes("availability:BACKORDER") && backorder.secondaryFlags.includes("currencyNotPreferred"));

const missingSource = attestEligibility({ advertiserId: "9", productId: "ms" }, { relationship: "joined" });
expect("source_missing", missingSource.state === VERIFICATION_STATE.SOURCE_MISSING);

const ended = attestEligibility({ advertiserId: "9", productId: "end" }, { relationship: "ended", sourceRecord: full, czEligible: true, termsAccepted: true });
expect("ended_not_joined", ended.state === VERIFICATION_STATE.PARTNER_NOT_JOINED);

const noSourceTime = attestEligibility(
  { advertiserId: "9", productId: "age" },
  { relationship: "joined", sourceRecord: { ...full, sourceUpdatedAt: null }, czEligible: true, termsAccepted: true }
);
expect("missing_source_updated_at", noSourceTime.state === VERIFICATION_STATE.PENDING_REFRESH && noSourceTime.verifiedEligible === false && noSourceTime.sourceUpdatedAt == null);

const identities = [
  { advertiserId: "A", productId: "1", key: "A|1", priority: 1, localRecord: full },
  { advertiserId: "A", productId: "2", key: "A|2", priority: 1, localRecord: full },
  { advertiserId: "A", productId: "3", key: "A|3", priority: 1, localRecord: full },
  { advertiserId: "B", productId: "1", key: "B|1", priority: 1, localRecord: full },
];
const outPath = path.join(os.tmpdir(), "iu-cj-verification-checkpoint-" + process.pid + ".json");
const first = runVerificationBatch({
  identities,
  relationships: { A: "joined", B: "joined" },
  czByAdvertiser: { A: true, B: true },
  termsAccepted: true,
  limit: 2,
  maxPerPartner: 1,
  nowMs: 1_700_000_000_000,
  outPath,
  expectedGeneration: null,
});
expect("fair_two_partners", first.metrics.partnersInBatch === 2 && first.metrics.batchSize === 2);
expect("growth_stays_disarmed", first.growth.allowed === 0 && first.growth.reason === "OWNER_GATES_DISARMED");
const resumed = runVerificationBatch({
  identities,
  relationships: { A: "joined", B: "joined" },
  czByAdvertiser: { A: true, B: true },
  termsAccepted: true,
  limit: 4,
  maxPerPartner: 2,
  nowMs: 1_700_000_000_000,
  checkpoint: loadCheckpoint(outPath),
  outPath,
  expectedGeneration: first.checkpoint.generation,
});
expect("resume_continues", resumed.metrics.uniqueAttempts === 4 && resumed.metrics.verifiedEligible === 2);
let staleThrew = false;
try {
  runVerificationBatch({
    identities,
    relationships: { A: "joined", B: "joined" },
    czByAdvertiser: { A: true, B: true },
    termsAccepted: true,
    checkpoint: first.checkpoint,
    outPath,
    expectedGeneration: 0,
  });
} catch (err) {
  staleThrew = err && err.code === "STALE_CHECKPOINT";
}
expect("stale_checkpoint_refused", staleThrew);

const refused = runVerificationBatch({ identities, liveLookupEnabled: true });
expect("live_lookup_refused", refused.refused === true);

const growthArmedUnverified = planAdaptiveBatch({
  candidates: [{ key: "hist", verificationState: "DEFERRED_CANDIDATE_UNVERIFIED" }],
  health: { ok: true, stop: false, throttle: false },
  remainingCumulative: 10,
  uncappedGate: true,
  executeArmed: true,
});
expect("controller_rejects_unverified", growthArmedUnverified.allowed === 0 && growthArmedUnverified.reason === "NO_VERIFIED_ELIGIBLE");

const onbuy = executePartnerAutomaticStep({
  advertiserId: "7417963",
  name: "OnBuy EU",
  programUrl: "https://www.onbuy.com/sk/",
  primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
  automaticNextStep: "ASSIGN_PRIMARY_SECTION",
  relationshipStatus: "joined",
  czEligible: false,
});
expect("onbuy_section", onbuy.sectionId === "aff-inzerce-bazary" && onbuy.sectionUnresolved === false && onbuy.publicationReady === false && onbuy.source === "cj_category_exact_v2");

const specialist = buildAssortmentProfile({
  advertiser: {
    advertiserName: "Lekarna Test",
    programUrl: "https://lekarnatest.cz",
    primaryCategory: "<parent>Health and Wellness</parent><child>Pharmaceuticals</child>",
  },
});
expect("specialist_profile", specialist.merchantType === "SPECIALIST");

const marketplace = buildAssortmentProfile({
  advertiser: {
    advertiserName: "Example Mall",
    programUrl: "https://example-mall.example",
    primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
  },
});
expect("marketplace_type", marketplace.merchantType === "MARKETPLACE" && marketplace.primaryAssortment && marketplace.primaryAssortment.sectionId === "aff-inzerce-bazary");

const digital = executePartnerAutomaticStep({
  advertiserId: "1",
  automaticNextStep: "BOUNDED_API_REPROBE",
  relationshipStatus: "joined",
});
expect("reprobe_not_live", digital.executed === false && digital.liveCall === false && digital.mode === "DISARMED_NO_NETWORK");

const paid = executePartnerAutomaticStep({
  advertiserId: "2",
  automaticNextStep: "ASSIGN_PRIMARY_SECTION",
  management: "PAID_RESERVED",
  primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
});
expect("paid_protected", paid.reason === "PAID_POSITION_PROTECTED" && paid.publicationReady === false);

const endedPartner = executePartnerAutomaticStep({
  advertiserId: "3",
  automaticNextStep: "ASSIGN_PRIMARY_SECTION",
  relationshipStatus: "ended",
  primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
});
expect("ended_partner", endedPartner.reason === "PARTNER_ENDED" && endedPartner.publicationReady === false);

fs.rmSync(outPath, { force: true });

const summary = {
  IU_CJ_VERIFICATION_PIPELINE_SELFTEST: failures.length ? "FAIL" : "PASS",
  failures,
  uniqueIdentities: overlap.uniqueIdentities,
  inputRows: overlap.inputRows,
  onbuy,
  marketplaceMerchantType: marketplace.merchantType,
};
console.log(JSON.stringify(summary));
if (failures.length) process.exit(1);
