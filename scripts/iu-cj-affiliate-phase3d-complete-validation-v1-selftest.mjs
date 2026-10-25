#!/usr/bin/env node
/**
 * Offline Phase 3D validation selftest (no live CJ HTTP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUB_STATE,
  classifyOfferPublicationState,
  reconcilePartners,
  buildReadinessFromLiveBundles,
  emptyPublicationReadinessDoc,
  runAutomation24x7Matrix,
  runPhase3dCompleteValidation,
} from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { buildCatalogSlotInventory } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const inventory = buildCatalogSlotInventory({ catalogSrc });
const managed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
);
const policy = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), "utf8")
);

const joined = [
  { advertiserId: "6179554", advertiserName: "Cedok.cz", relationshipStatus: "joined" },
  { advertiserId: "999999001", advertiserName: "Unknown Partner CZ", relationshipStatus: "joined" },
  { advertiserId: "5124968", advertiserName: "Autohotarek.cz", relationshipStatus: "joined" },
];
const recon = reconcilePartners({
  joined,
  managedPartners: managed.partners,
  slotPolicyPartners: policy.partners,
  inventory,
});
expect("assigned_includes_managed", recon.assigned.some((a) => a.advertiserId === "6179554"));
expect("manual_review_unknown", recon.manualReview.some((a) => a.advertiserId === "999999001"));
expect("manual_protected_count_43", recon.manualProtectedCount === 43, { n: recon.manualProtectedCount });
expect("never_invent_section", recon.manualReview.every((a) => !a.sectionId));

const goodCoupon = {
  linkId: "1001",
  advertiserId: "6179554",
  advertiserName: "Cedok.cz",
  linkName: "Sleva 10%",
  couponCode: "TEST10",
  // Live Link Search uses websitePid-advertiserId-linkId (3 segments).
  clickUrl: "https://www.kqzyfj.com/click-101883843-6179554-1001",
  description: "Podmínky: pouze online. Od 1000 Kč.",
  promotionStartDate: "2026-01-01 00:00:00.0",
  promotionEndDate: "2026-12-31 23:59:00.0",
  promotionType: "coupon",
};
const expired = {
  ...goodCoupon,
  linkId: "1002",
  couponCode: "OLD",
  clickUrl: "https://www.kqzyfj.com/click-101883843-6179554-1002",
  promotionEndDate: "2020-01-01 00:00:00.0",
};
const badUrl = {
  ...goodCoupon,
  linkId: "1003",
  clickUrl: "https://www.cedok.cz/",
  couponCode: "X",
};
const sectionByAdv = recon.sectionByAdv;
const seen = new Set();
const c1 = classifyOfferPublicationState(goodCoupon, {
  sectionByAdv,
  seenOfferIds: seen,
  refDate: new Date("2026-10-25T12:00:00Z"),
});
const c2 = classifyOfferPublicationState(expired, {
  sectionByAdv,
  seenOfferIds: seen,
  refDate: new Date("2026-10-25T12:00:00Z"),
});
const c3 = classifyOfferPublicationState(badUrl, {
  sectionByAdv,
  seenOfferIds: seen,
  refDate: new Date("2026-10-25T12:00:00Z"),
});
const c4 = classifyOfferPublicationState(goodCoupon, {
  sectionByAdv,
  seenOfferIds: seen,
  refDate: new Date("2026-10-25T12:00:00Z"),
});
expect("coupon_ready_3seg", c1.state === PUB_STATE.PUBLICATION_READY, { state: c1.state, reasons: c1.reasons });
expect("expired", c2.state === PUB_STATE.EXPIRED);
expect("invalid_url", c3.state === PUB_STATE.INVALID);
expect("duplicate", c4.state === PUB_STATE.DUPLICATE);

const { doc } = buildReadinessFromLiveBundles(
  {
    sourceKind: "fixture_offline",
    joined,
    couponLinks: [goodCoupon, expired, badUrl],
    actionLinks: [
      {
        linkId: "2001",
        advertiserId: "6179554",
        advertiserName: "Cedok.cz",
        linkName: "Akce bez kódu",
        couponCode: "",
        clickUrl: "https://www.anrdoezrs.net/click-101883843-6179554-2001",
        description: "Sleva automaticky",
        promotionType: "sale/discount",
        promotionEndDate: "2026-12-31 23:59:00.0",
      },
    ],
    products: [
      {
        advertiserId: "6179554",
        productId: "P1",
        title: "Test",
        imageUrl: "https://cdn.example/p1.jpg",
        currentPrice: 100,
        currency: "CZK",
        affiliateUrl: "https://www.kqzyfj.com/click-101883843-6179554-9",
        publicationReady: true,
      },
    ],
    productMeta: { sampledPartners: 1, partnersWithFeed: 1, partnersEmptyFeed: 0, partnersError: 0 },
  },
  { refDate: new Date("2026-10-25T12:00:00Z") }
);
expect("doc_live_false", doc.liveEnabled === false);
expect("doc_publish_false", doc.publishArmed === false);
expect("stats_loaded_coupons", doc.stats.couponsLoaded === 3);

const missing = await runPhase3dCompleteValidation({ env: {}, outDir: path.join(osTmp(), "iu-p3d-miss") });
expect("missing_creds", missing.ok === false && missing.report.reason === "credentials_missing");

const r2 = auditCjManagedPublicR2Readiness({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "MISSING",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "MISSING",
  },
});
expect("r2_code_ready", r2.codeReady === true && r2.ok === true);
expect("r2_infra_pending", r2.infraPending === true);
expect("r2_no_prod_publish", r2.productionPublishAllowed === false);

const stub = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-publication-readiness-v1.json"), "utf8")
);
expect("stub_disarmed", stub.liveEnabled === false && stub.publishArmed === false);
expect("stub_schema", stub.schema === "iu-affiliate-cj-publication-readiness-v1");

const empty = emptyPublicationReadinessDoc({});
expect("empty_zero_ready", empty.stats.couponsPublicationReady === 0);

const ops = runAutomation24x7Matrix({
  sectionByAdv,
  inventory,
  forceAuthScenario: true,
});
expect("ops_matrix_ok", ops.ok === true, { failed: ops.failed });
expect("ops_matrix_count", ops.scenarioCount >= 12, { n: ops.scenarioCount });

function osTmp() {
  return process.env.TEMP || process.env.TMPDIR || "/tmp";
}

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3D_COMPLETE_VALIDATION_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    couponStates: { c1: c1.state, c2: c2.state, c3: c3.state, c4: c4.state },
    recon: {
      assigned: recon.assignedToSections,
      manualReview: recon.manualReviewCount,
      manualProtected: recon.manualProtectedCount,
    },
    automation24x7: { ok: ops.ok, passed: ops.passed, scenarioCount: ops.scenarioCount },
  })
);
process.exit(ok ? 0 : 1);
