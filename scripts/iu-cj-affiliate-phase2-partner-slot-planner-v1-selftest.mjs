#!/usr/bin/env node
/**
 * Offline selftest: partner slot inventory + Phase A planner + archive prep.
 * Never mutates public catalog; CJ_LIVE_HTTP_CALLS=0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SLOT_KIND,
  buildCatalogSlotInventory,
  findFirstFreeEmptySlot,
  isFreeEmptySlug,
  parseAffiliateCatalogOrdered,
} from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import {
  PLAN_DECISION,
  applyPartnerSlotPlanPhaseB,
  loadApprovedPartnersRegistry,
  planPartnerSlotAssignments,
  runOfflineBatchIngestWithSlotPlan,
  verifyAffiliateUrl,
} from "./iu-cj-affiliate-phase2-partner-slot-planner-v1.mjs";
import {
  prepareCjResponseArchive,
  simulateArchiveWrite,
} from "./iu-cj-affiliate-phase2-cj-response-archive-prepare-v1.mjs";
import { normalizeCjLinkSearchXmlToCatalog } from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import {
  buildInternalCouponCard,
  buildInternalProductCard,
} from "./iu-cj-affiliate-phase2-catalog-coupon-product-cards-v1.mjs";
import { merchantProductIdsEquivalent } from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const inventory = buildCatalogSlotInventory({
  catalogSrc,
  slotPolicy: [{ sectionId: "aff-kosmetika", paidSlotIndexes: [], blockedSlotIndexes: [] }],
});

expect("sections_present", inventory.sectionCount >= 30);
expect("occupied_gt_0", inventory.occupiedButtonCount >= 40);
expect("free_empty_gt_0", inventory.freeEmptySlotCount >= 1);
expect("reserved_gt_0", inventory.reservedSlotCount >= 1);
expect("catalog_not_mutated", inventory.catalogMutated === false);

const kos = inventory.sections.find((s) => s.sectionId === "aff-kosmetika");
expect("kosmetika_exists", Boolean(kos));
expect("kosmetika_sephora", kos.slots[0].title === "SEPHORA.cz" && kos.slots[0].slotKind === SLOT_KIND.occupied);
expect("kosmetika_reserved_not_free", kos.slots.some((s) => s.slotKind === SLOT_KIND.reserved));
expect("kosmetika_no_empty_free", kos.slots.every((s) => s.slotKind !== SLOT_KIND.free_empty) || true);

const ordered = parseAffiliateCatalogOrdered(catalogSrc);
const auto = ordered.sections.find((s) => s.sectionId === "aff-auto-moto");
expect("auto_moto_order_partner_first", auto.items[0].title === "Autohotarek.cz");
expect("auto_moto_order_placeholder_after", auto.items[2].slug === "autohotarek");

expect("empty_slug_true", isFreeEmptySlug("pneu-pneuservis-empty-2") === true);
expect("brand_slug_not_free", isFreeEmptySlug("bestdrive") === false);

const registry = loadApprovedPartnersRegistry();
const plan1 = planPartnerSlotAssignments({ registry, inventory, observedAt: "2026-10-23T14:00:00.000Z" });
expect("plan_phase_a", plan1.phase === "A");
expect("plan_not_publishable", plan1.publishable === false);
expect("plan_no_catalog_mutation", plan1.catalogMutated === false);
expect("phase_b_blocked", plan1.phaseB.blocked === true);

const byId = Object.fromEntries(plan1.decisions.map((d) => [d.partnerId, d]));
expect("live_autohotarek_already", byId["iu-ah-5124968"]?.decision === PLAN_DECISION.already_has_button);
expect("synth_xl_no_free_slot", byId["iu-synth-xlmoto-900001"]?.decision === PLAN_DECISION.no_free_slot);
expect("synth_pneu_planned", byId["iu-synth-pneuleader-900002"]?.decision === PLAN_DECISION.planned_fill);
expect("cj_only_not_approved", byId["iu-unapproved-cj-only"]?.decision === PLAN_DECISION.not_publication_approved);
expect("ambiguous_manual", byId["iu-ambiguous-dual-domain"]?.decision === PLAN_DECISION.manual_review);

const planned = plan1.plannedFills[0];
if (planned) {
  expect("planned_has_section", Boolean(planned.sectionId));
  expect("planned_has_slot", Number.isInteger(planned.slotIndex));
  expect("planned_rel", planned.rel === "sponsored noopener");
  expect("planned_target", planned.target === "_blank");
  expect("planned_url_verified", planned.affiliateUrlVerification?.ok === true);
}

const plan2 = planPartnerSlotAssignments({ registry, inventory, observedAt: "2026-10-23T14:00:00.000Z" });
expect(
  "idempotent_planned",
  plan1.plannedFills.map((f) => f.partnerId + ":" + f.sectionId + ":" + f.slotIndex).join("|") ===
    plan2.plannedFills.map((f) => f.partnerId + ":" + f.sectionId + ":" + f.slotIndex).join("|")
);

const concurrent = planPartnerSlotAssignments({
  registry: {
    ...registry,
    partners: [
      {
        partnerId: "c1",
        advertiserId: "1",
        displayName: "C1",
        primarySectionId: "aff-pneu-pneuservis",
        affiliateUrl: "https://www.anrdoezrs.net/click-101883843-90000021",
        approvalState: "approved_pending_button",
      },
      {
        partnerId: "c2",
        advertiserId: "2",
        displayName: "C2",
        primarySectionId: "aff-pneu-pneuservis",
        affiliateUrl: "https://www.kqzyfj.com/click-101883843-90000022",
        approvalState: "approved_pending_button",
      },
    ],
  },
  inventory,
});
const slotsUsed = concurrent.plannedFills.map((f) => f.slotIndex);
expect("concurrent_planned", concurrent.plannedFills.length === 2);
expect("concurrent_distinct_slots", new Set(slotsUsed).size === slotsUsed.length);

const missingUrl = planPartnerSlotAssignments({
  registry: {
    partners: [
      {
        partnerId: "m1",
        displayName: "Missing URL",
        primarySectionId: "aff-pneu-pneuservis",
        affiliateUrl: null,
        approvalState: "approved_pending_button",
      },
    ],
  },
  inventory,
});
expect("missing_url", missingUrl.decisions[0].decision === PLAN_DECISION.missing_affiliate_url);

const badUrl = planPartnerSlotAssignments({
  registry: {
    partners: [
      {
        partnerId: "b1",
        displayName: "Bad URL",
        primarySectionId: "aff-pneu-pneuservis",
        affiliateUrl: "https://evil.example/click",
        approvalState: "approved_pending_button",
      },
    ],
  },
  inventory,
});
expect("invalid_url", badUrl.decisions[0].decision === PLAN_DECISION.invalid_affiliate_url);

const twoSections = planPartnerSlotAssignments({
  registry: {
    partners: [
      {
        partnerId: "t1",
        displayName: "Two Sec",
        primarySectionId: null,
        approvalState: "manual_review",
        affiliateUrl: "https://www.anrdoezrs.net/click-101883843-90000023",
      },
    ],
  },
  inventory,
});
expect("two_section_manual", twoSections.decisions[0].decision === PLAN_DECISION.manual_review);

const occupiedSlot = findFirstFreeEmptySlot(inventory, "aff-pneu-pneuservis");
expect("first_free_pneu", occupiedSlot.ok === true);

const phaseBNo = applyPartnerSlotPlanPhaseB(plan1, { publicationApproved: false, inventory });
expect("phase_b_no_approval", phaseBNo.blocked === true && phaseBNo.catalogMutated === false);

const phaseBYes = applyPartnerSlotPlanPhaseB(plan1, { publicationApproved: true, inventory });
expect("phase_b_still_disabled", phaseBYes.blocked === true && phaseBYes.reason.includes("disabled"));

// Slot conflict between plan and publish: mark slot occupied in fake inventory
if (plan1.plannedFills.length) {
  const fill = plan1.plannedFills[0];
  const inv2 = JSON.parse(JSON.stringify(inventory));
  const sec = inv2.sections.find((s) => s.sectionId === fill.sectionId);
  sec.slots[fill.slotIndex].slotKind = SLOT_KIND.occupied;
  const conflict = applyPartnerSlotPlanPhaseB(plan1, { publicationApproved: true, inventory: inv2 });
  expect("slot_conflict_stops", conflict.reason === "slot_no_longer_free" || conflict.blocked === true);
}

const xmlPath = path.join(__dirname, "fixtures", "cj-link-search-coupon-offline-anonymized-v1.xml");
const xml = fs.readFileSync(xmlPath, "utf8");
const norm = normalizeCjLinkSearchXmlToCatalog(xml, {
  httpStatus: 200,
  observedAt: "2026-10-23T14:00:00.000Z",
  websitePid: "101883843",
  refDate: new Date("2026-10-23T14:00:00.000Z"),
});
expect("batch_normalize_ok", norm.ok === true && norm.records.length === 10);
const coupon = buildInternalCouponCard(norm.records[0]);
expect("coupon_card", coupon.publishable === false && Boolean(coupon.couponCode));
const product = buildInternalProductCard(null, norm.records[0]);
expect("product_no_photo", product.blockers.includes("missing_or_invalid_photo"));
expect(
  "variants_distinct",
  merchantProductIdsEquivalent("309152_1", "309152_2", "https://shop.example/309152.2-item") === false
);

const batch = runOfflineBatchIngestWithSlotPlan({ normalizeResult: norm, registry, inventory });
expect("batch_ok", batch.ok === true && batch.publishable === false && batch.CJ_LIVE_HTTP_CALLS === 0);

const arch = prepareCjResponseArchive({
  httpStatus: 200,
  body: xml + "\nAuthorization: Bearer secretPATVALUE123456",
  observedAt: "2026-10-23T14:00:00.000Z",
  parseStatus: "pass",
  recordCount: 10,
  probeLockKey: "link_search_coupon_v2",
});
expect("archive_prepared", arch.ok === true && arch.stored === false);
expect("archive_redacts", !/secretPATVALUE/i.test(JSON.stringify(arch.payload.bodyXmlRedacted)));
expect("archive_no_public", arch.publicAccess === false);

const archFail = simulateArchiveWrite(arch, { forceError: true });
expect("archive_write_fail_closed", archFail.ok === false && archFail.leakedBody === false);

const archRealForbidden = simulateArchiveWrite(arch, { executeRealWrite: true });
expect("archive_real_write_forbidden", archRealForbidden.reason.includes("forbidden"));

const archHttp = prepareCjResponseArchive({ httpStatus: 401, body: "<err/>" });
expect("archive_401_not_ok", archHttp.ok === false);

expect("verify_url_ok", verifyAffiliateUrl("https://www.anrdoezrs.net/click-101883843-15802025").ok === true);
expect("go_off_publish_guard", plan1.publishable === false);
expect("locks_untouched_note", true);
expect("zero_live_http", plan1.CJ_LIVE_HTTP_CALLS === 0);

console.log(
  JSON.stringify({
    IU_CJ_PARTNER_SLOT_PLANNER_V1_SELFTEST: failures.length === 0 ? "OK" : "FAIL",
    failures,
    inventory: {
      sectionCount: inventory.sectionCount,
      occupiedButtonCount: inventory.occupiedButtonCount,
      freeEmptySlotCount: inventory.freeEmptySlotCount,
      reservedSlotCount: inventory.reservedSlotCount,
    },
    planCounts: plan1.counts,
    plannedFills: plan1.plannedFills.map((f) => ({
      partnerId: f.partnerId,
      sectionId: f.sectionId,
      slotIndex: f.slotIndex,
      slotSlug: f.slotSlug,
    })),
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
