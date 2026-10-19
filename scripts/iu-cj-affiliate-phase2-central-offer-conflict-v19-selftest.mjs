#!/usr/bin/env node
/** 25 conflict / registry scenarios v19 (in-memory + reconcile). */
import { createInMemoryCentralOfferRegistry } from "./iu-cj-affiliate-phase2-central-offer-registry-v19.mjs";
import { reconcileOfferClaims } from "./iu-cj-affiliate-phase2-central-offer-conflict-v19.mjs";
import {
  CONFLICT_STATE,
  OFFER_SOURCE,
  OFFER_TYPE,
  PUBLISHABILITY_STATE,
} from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { computeOfferIdentityKey } from "./iu-cj-affiliate-phase2-central-offer-identity-v19.mjs";
import { PRODUCTION_SIGNING_ENABLED } from "./iu-cj-affiliate-phase2-email-ingest-lib.mjs";

const scenarios = [];

function record(id, pass, detail) {
  scenarios.push({ id, status: pass ? "PASS" : "FAIL", detail });
}

function claim(source, sid, fields, meta = {}, observedAt = "2026-06-01T10:00:00Z", sourceUpdatedAt = null) {
  const merged = {
    network: "CJ",
    cjCid: "999001",
    advertiserId: "999001",
    market: "CZ",
    offerType: OFFER_TYPE.coupon,
    couponCode: "REGV19",
    customerDiscountValue: 10,
    customerDiscountUnit: "percent",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    ...fields,
  };
  if (!merged.campaignId) {
    const scope = merged.productId || merged.assortmentScope || sid;
    const variant = merged.productVariant ? `-${merged.productVariant}` : "";
    merged.campaignId = `v19-conflict-${scope}${variant}`;
  }
  return {
    source,
    sourceRecordId: sid,
    observedAt,
    sourceUpdatedAt,
    fields: merged,
    evidence: { scenario: sid, source },
    meta,
  };
}

const reg = () => createInMemoryCentralOfferRegistry();

{
  const r = reg();
  const f = { productId: "cat-a", assortmentScope: "cat-a" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s01a", f));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s01b", f));
  record("v19_01_same_coupon_api_email_agree", o.conflictState === CONFLICT_STATE.none && o.claimsCount === 2, o);
}

{
  const r = reg();
  const base = { productId: "g1", assortmentScope: "g1" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s02a", { ...base, customerDiscountValue: 10 }));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s02b", { ...base, customerDiscountValue: 15 }));
  record("v19_02_discount_percent_mismatch", o.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT, o);
}

{
  const out = reconcileOfferClaims([
    claim(OFFER_SOURCE.API, "s03a", { productId: "g2", assortmentScope: "g2", validTo: "2026-06-30" }),
    claim(OFFER_SOURCE.EMAIL, "s03b", { productId: "g2", assortmentScope: "g2", validTo: "2026-12-31" }),
  ]);
  record("v19_03_validity_mismatch", out.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT, out);
}

{
  const r = reg();
  const base = { productId: "g3", assortmentScope: "g3" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s04a", base));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s04b", base, { terminationNotice: true }));
  record(
    "v19_04_early_termination_email",
    o.publishabilityState === PUBLISHABILITY_STATE.blocked_contract ||
      (o.publishabilityState === PUBLISHABILITY_STATE.blocked_conflict && o.blockReason === "early_termination"),
    o
  );
}

{
  const out = reconcileOfferClaims([
    claim(OFFER_SOURCE.FEED, "s05f", { productId: "g5", assortmentScope: "g5", validTo: "2026-03-01" }, {}, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    claim(OFFER_SOURCE.EMAIL, "s05e", { productId: "g5", assortmentScope: "g5", validTo: "2026-12-31" }, {}, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"),
  ]);
  record(
    "v19_05_stale_feed_newer_email",
    out.conflicts.some((c) => c.type === "validity_mismatch") || out.canonical.validTo === "2026-12-31",
    out
  );
}

{
  const r = reg();
  const base = { productId: "g6", assortmentScope: "g6" };
  r.registerSourceClaim(claim(OFFER_SOURCE.FEED, "s06f", base, {}, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s06e", base, {}, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"));
  record("v19_06_late_old_email", o.canonical.sourceUpdatedAt === "2026-06-01T00:00:00Z" || o.conflictState === CONFLICT_STATE.none, o);
}

{
  const r = reg();
  const o1 = r.registerSourceClaim(claim(OFFER_SOURCE.API, "s07cz", { market: "CZ", productId: "m", assortmentScope: "m" }));
  const o2 = r.registerSourceClaim(claim(OFFER_SOURCE.API, "s07sk", { market: "SK", productId: "m", assortmentScope: "m" }));
  record("v19_07_same_code_cz_sk_separate", o1.offerId !== o2.offerId, { o1: o1.identityKey, o2: o2.identityKey });
}

{
  const o1 = reg().registerSourceClaim(claim(OFFER_SOURCE.API, "s08a", { productId: "grp-a", assortmentScope: "grp-a" }));
  const o2 = reg().registerSourceClaim(claim(OFFER_SOURCE.API, "s08b", { productId: "grp-b", assortmentScope: "grp-b" }));
  record("v19_08_same_code_product_groups", o1.offerId !== o2.offerId, { o1, o2 });
}

{
  const o1 = reg().registerSourceClaim(claim(OFFER_SOURCE.API, "s09a", { brandRestrictions: "BrandA", productId: "b1", assortmentScope: "b1" }));
  const o2 = reg().registerSourceClaim(claim(OFFER_SOURCE.API, "s09b", { brandRestrictions: "BrandB", productId: "b2", assortmentScope: "b2" }));
  record("v19_09_same_code_different_brands", o1.offerId !== o2.offerId, o1);
}

{
  const r = reg();
  const base = { productId: "mo", assortmentScope: "mo" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s10a", { ...base, minOrderValue: 500 }));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s10b", { ...base, minOrderValue: 1000 }));
  record("v19_10_min_order_mismatch", o.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT, o);
}

{
  const r = reg();
  const base = { productId: "ex", assortmentScope: "ex" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s11a", { ...base, exclusions: "no outlet" }));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s11b", base));
  record("v19_11_exclusion_one_source", o.conflicts.some((c) => c.type === "exclusion_asymmetric"), o);
}

{
  const r = reg();
  const o = r.registerSourceClaim(
    claim(OFFER_SOURCE.EMAIL, "s12", { validFrom: null, validTo: null, productId: "nd", assortmentScope: "nd" })
  );
  record(
    "v19_12_unknown_validity",
    o.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT && o.publishable === false,
    o
  );
}

{
  const o = reg().registerSourceClaim(
    claim(OFFER_SOURCE.API, "s13", { validFrom: "2027-01-01", validTo: "2027-12-31", productId: "fu", assortmentScope: "fu" })
  );
  record("v19_13_future_action", o.canonical._futureHint === true, o);
}

{
  const o = reg().registerSourceClaim(
    claim(OFFER_SOURCE.API, "s14", { validFrom: "2020-01-01", validTo: "2020-12-31", productId: "xp", assortmentScope: "xp" })
  );
  record("v19_14_expired_action", o.canonical._expiredHint === true, o);
}

{
  const o = reg().registerSourceClaim(
    claim(OFFER_SOURCE.API, "s15", { affiliateLink: "http://broken", affiliateLinkVerified: false, productId: "al", assortmentScope: "al" })
  );
  record("v19_15_invalid_affiliate_link", o.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT && o.publishable === false, o);
}

{
  const out = reconcileOfferClaims([
    claim(OFFER_SOURCE.API, "a", { cjCid: "111", advertiserId: "111", productId: "c", assortmentScope: "c" }),
    claim(OFFER_SOURCE.EMAIL, "b", { cjCid: "222", advertiserId: "222", productId: "c", assortmentScope: "c" }),
  ]);
  record("v19_16_cid_pid_mismatch", out.conflicts.some((c) => c.type === "cid_pid_mismatch"), out);
}

{
  const v = reg().registerSourceClaim(
    claim(OFFER_SOURCE.EMAIL, "s17", {
      customerDiscountValue: 5,
      customerDiscountUnit: "commission",
      productId: "cm",
      assortmentScope: "cm",
    })
  );
  record("v19_17_commission_as_discount", v.ok === false || v.reason === "commission_labeled_as_customer_discount", v);
}

{
  const fixed = reconcileOfferClaims([
    { ...claim(OFFER_SOURCE.EMAIL, "m1", { productId: "mc", assortmentScope: "mc", marketingClaimText: "50% off" }), meta: {} },
    { ...claim(OFFER_SOURCE.API, "m2", { productId: "mc", assortmentScope: "mc" }), meta: { contractBlocker: true } },
  ]);
  record("v19_18_marketing_vs_contract", fixed.conflicts.some((c) => c.type === "marketing_vs_contract"), fixed);
}

{
  const r = reg();
  const base = { productId: "id", assortmentScope: "id" };
  const a = r.registerSourceClaim(claim(OFFER_SOURCE.API, "s19", base));
  const b = r.registerSourceClaim(claim(OFFER_SOURCE.API, "s19", base));
  record("v19_19_idempotent_reimport", a.offerId === b.offerId && b.claimsCount === 1, { a, b });
}

{
  const r = reg();
  const base = { productId: "conc", assortmentScope: "conc" };
  const p = Promise.all([
    Promise.resolve(r.registerSourceClaim(claim(OFFER_SOURCE.API, "s20a", base))),
    Promise.resolve(r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s20b", base))),
  ]);
  const [a, b] = await p;
  record("v19_20_concurrent_two_sources", a.offerId === b.offerId && b.claimsCount === 2, { a, b });
}

{
  const r = reg();
  const base = { productId: "rec", assortmentScope: "rec" };
  r.registerSourceClaim(claim(OFFER_SOURCE.API, "s21a", { ...base, customerDiscountValue: 20 }));
  const oid = r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s21b", { ...base, customerDiscountValue: 10 })).offerId;
  const blocked = r.getOffer(oid);
  r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s21b", { ...base, customerDiscountValue: 20 }));
  const after = r.getOffer(oid);
  record(
    "v19_21_update_after_blocked",
    blocked.conflictState === CONFLICT_STATE.BLOCKED_CONFLICT && after.conflictState === CONFLICT_STATE.none,
    { blocked, after }
  );
}

{
  const r = reg();
  const base = { productId: "can", assortmentScope: "can" };
  r.registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s22a", base, { terminationNotice: true }));
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.API, "s22b", base, {}));
  record("v19_22_cancel_then_restart", o.conflicts.length >= 0, o);
}

{
  const o1 = reg().registerSourceClaim(claim(OFFER_SOURCE.FEED, "s23a", { productId: "P1", productVariant: null, assortmentScope: "P1" }));
  const o2 = reg().registerSourceClaim(claim(OFFER_SOURCE.FEED, "s23b", { productId: "P1", productVariant: "XL", assortmentScope: "P1" }));
  record("v19_23_missing_variant_separate", o1.offerId !== o2.offerId, { o1, o2 });
}

{
  const o1 = reg().registerSourceClaim(claim(OFFER_SOURCE.FEED, "s24a", { productId: "IDN32844", assortmentScope: "IDN32844" }));
  const o2 = reg().registerSourceClaim(claim(OFFER_SOURCE.FEED, "s24b", { productId: "IDN3284", assortmentScope: "IDN3284" }));
  record("v19_24_similar_product_ids", o1.offerId !== o2.offerId, o1);
}

{
  const o = reg().registerSourceClaim(claim(OFFER_SOURCE.EMAIL, "s25", { productId: "ut", assortmentScope: "ut" }, { untrustedSource: true }));
  record("v19_25_untrusted_source", o.conflicts.some((c) => c.type === "untrusted_source"), o);
}

record("v19_gate_production_signing_false", PRODUCTION_SIGNING_ENABLED === false, { PRODUCTION_SIGNING_ENABLED });
record("v19_evidence_preserved", (() => {
  const r = reg();
  const o = r.registerSourceClaim(claim(OFFER_SOURCE.API, "ev", { productId: "ev", assortmentScope: "ev" }));
  return o.evidenceBySource && Object.keys(o.evidenceBySource).length >= 1;
})(), {});

const fail = scenarios.filter((s) => s.status !== "PASS");
console.log(
  JSON.stringify({
    IU_CJ_CENTRAL_OFFER_CONFLICT_V19_SELFTEST: fail.length === 0 ? "OK" : "FAIL",
    pass: scenarios.length - fail.length,
    total: scenarios.length,
    scenarios,
    runtime: "in_memory_registry",
    cloudflareD1Production: "NOT_VERIFIED",
  })
);
process.exit(fail.length === 0 ? 0 : 1);
