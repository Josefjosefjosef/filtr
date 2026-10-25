#!/usr/bin/env node
/**
 * Offline Phase 3E partner reconciliation selftest (no live CJ HTTP).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePartnerBrand,
  parseCjPrimaryCategory,
  proposeSectionAssignments,
  buildSectionMapFile,
  CJ_CATEGORY_SECTION_EVIDENCE,
} from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { buildCjR2ProductionGoPlan } from "./iu-cj-affiliate-phase3e-r2-production-go-plan-v1.mjs";
import { auditAffiliateSectionCapacity } from "./iu-cj-affiliate-phase3e-capacity-audit-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogSrc = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
const managed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
);
const policy = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-slot-policy-v1.json"), "utf8")
);

expect("norm_autohotarek", normalizePartnerBrand("Autohotarek.cz") === "autohotarek");
expect("norm_dermacol", normalizePartnerBrand("Dermacol CZ/SK/PL/RO") === "dermacol");
expect("norm_booking", normalizePartnerBrand("Booking.com Central and Eastern Europe") === "booking");
expect(
  "cat_parse",
  parseCjPrimaryCategory("<parent>Beauty</parent><child>Cosmetics</child>").key === "beauty|cosmetics"
);
expect("cat_evidence_groceries", Boolean(CJ_CATEGORY_SECTION_EVIDENCE["food & drinks|groceries"]));

const joined = [
  {
    advertiserId: "7084105",
    advertiserName: "Autohotarek.cz",
    relationshipStatus: "joined",
    primaryCategory: "<parent>Automotive</parent><child>Tools and Supplies</child>",
  },
  {
    advertiserId: "5954793",
    advertiserName: "lidl-shop.cz",
    relationshipStatus: "joined",
    primaryCategory: "<parent>Food &amp; Drinks</parent><child>Groceries</child>",
  },
  {
    advertiserId: "5578976",
    advertiserName: "Novakid INT",
    relationshipStatus: "joined",
    primaryCategory: "<parent>Education</parent><child>Children</child>",
  },
  {
    advertiserId: "5819507",
    advertiserName: "Royalfashion.cz",
    relationshipStatus: "joined",
    primaryCategory: "<parent>Accessories</parent><child>Jewelry</child>",
  },
  // already managed — must stay assigned via managed, not invent
  {
    advertiserId: "6179554",
    advertiserName: "Cedok.cz",
    relationshipStatus: "joined",
    primaryCategory: "<parent>Travel</parent><child>Vacation</child>",
  },
];

const proposal = proposeSectionAssignments({
  joined,
  managedPartners: managed.partners,
  slotPolicyPartners: policy.partners,
  catalogSrc,
  existingSectionMap: {},
});

expect(
  "autohotarek_catalog_assign",
  proposal.autoAssigned.some(
    (a) => a.advertiserId === "7084105" && a.sectionId === "aff-auto-moto" && a.evidence.includes("catalog")
  )
);
expect(
  "lidl_category_assign",
  proposal.autoAssigned.some((a) => a.advertiserId === "5954793" && a.sectionId === "aff-jidlo")
);
expect(
  "novakid_manual",
  proposal.stillManualReview.some((a) => a.advertiserId === "5578976")
);
expect(
  "royalfashion_manual",
  proposal.stillManualReview.some((a) => a.advertiserId === "5819507")
);
expect("no_catalog_mutation", proposal.catalogMutated === false);
expect("disarmed", proposal.liveEnabled === false && proposal.publishArmed === false);
expect("cedok_still_assigned", proposal.reconciliation.assigned.some((a) => a.advertiserId === "6179554"));

const mapFile = buildSectionMapFile(proposal.sectionMap, { source: "selftest" });
expect("map_disarmed_meta", mapFile._liveEnabled === false && mapFile._publishArmed === false);
expect("map_has_autohotarek", mapFile["7084105"] === "aff-auto-moto");

const cap = auditAffiliateSectionCapacity({ catalogSrc });
expect("capacity_free_empty_zero_or_number", typeof cap.freeEmptySlotCount === "number");
expect(
  "capacity_unlimited_overlay",
  cap.dynamicModel === "unlimited_overlay" &&
    cap.businessProposal.overflowCatalogOutsidePaidSlots.retired === true
);

const r2 = auditCjManagedPublicR2Readiness({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "MISSING",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "MISSING",
  },
});
expect("r2_infra_pending", r2.infraPending === true && r2.productionPublishAllowed === false);

const go = buildCjR2ProductionGoPlan();
expect("go_plan_disarmed", go.productionActionsArmed === false);
expect("go_plan_has_steps", (go.steps || []).length >= 6);
expect("go_plan_no_auto_bucket", go.steps.every((s) => s.executeWithoutGo !== true));

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3E_PARTNER_RECON_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    autoAssigned: proposal.autoAssignedCount,
    stillManual: proposal.stillManualReviewCount,
    freeEmpty: cap.freeEmptySlotCount,
  })
);
process.exit(ok ? 0 : 1);
