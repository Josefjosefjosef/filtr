/**
 * Automatic next step for a joined partner with no public offer.
 * Category assignment uses the general classifier. Network reprobe stays DISARMED
 * unless credentials are passed to the existing empty-feed reprobe by a later armed runner.
 */
import { classifyFromCjEvidence } from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";

export const PARTNER_ACTION = Object.freeze({
  REVIEW_PRESENTATION_BUDGET_NOT_A_GROWTH_CAP: "REVIEW_PRESENTATION_BUDGET_NOT_A_GROWTH_CAP",
  COMPLETE_CZ_ELIGIBILITY_FROM_REGISTRY_FIELDS: "COMPLETE_CZ_ELIGIBILITY_FROM_REGISTRY_FIELDS",
  BOUNDED_API_REPROBE: "BOUNDED_API_REPROBE",
  REPROBE_NON_PRODUCT_OFFER_TYPES_COUPON_ACTION_BUTTON: "REPROBE_NON_PRODUCT_OFFER_TYPES_COUPON_ACTION_BUTTON",
  VERIFY_BEFORE_GROWTH_QUEUE: "VERIFY_BEFORE_GROWTH_QUEUE",
  SEPARATE_BOT_WALL_FROM_AFFILIATE_URL: "SEPARATE_BOT_WALL_FROM_AFFILIATE_URL",
  BOUNDED_HTTP_RETRY: "BOUNDED_HTTP_RETRY",
  ASSIGN_PRIMARY_SECTION: "ASSIGN_PRIMARY_SECTION",
});

function paidProtected(row) {
  const management = String(row && (row.management || row.slotManagement) || "").toUpperCase();
  return management === "PAID_RESERVED" || management === "MANUAL_PROTECTED";
}

export function executePartnerAutomaticStep(row, opts = {}) {
  const step = String(row && row.automaticNextStep ? row.automaticNextStep : "");
  const advertiserId = String(row && row.advertiserId ? row.advertiserId : "");
  if (paidProtected(row)) {
    return {
      advertiserId,
      step,
      executed: false,
      publicationReady: false,
      reason: "PAID_POSITION_PROTECTED",
    };
  }
  const relationship = String(row && row.relationshipStatus ? row.relationshipStatus : "joined").toLowerCase();
  if (relationship === "ended") {
    return {
      advertiserId,
      step,
      executed: true,
      publicationReady: false,
      reason: "PARTNER_ENDED",
      sectionId: null,
    };
  }
  if (step === PARTNER_ACTION.ASSIGN_PRIMARY_SECTION) {
    const classified = classifyFromCjEvidence({
      advertiserId,
      advertiserName: row.name || row.advertiserName,
      programUrl: row.programUrl,
      primaryCategory: row.primaryCategory,
    });
    const czOk = row.czEligible === true;
    return {
      advertiserId,
      step,
      executed: true,
      sectionId: classified.sectionId,
      rule: classified.rule,
      source: classified.source,
      sectionUnresolved: classified.sectionId == null,
      publicationReady: classified.sectionId != null && czOk && relationship === "joined",
      reason: classified.sectionId
        ? czOk
          ? "SECTION_ASSIGNED_CZ_ATTESTED"
          : "SECTION_ASSIGNED_PUBLICATION_STILL_BLOCKED"
        : "SECTION_STILL_UNRESOLVED",
    };
  }
  return {
    advertiserId,
    step,
    executed: false,
    scheduled: true,
    mode: "DISARMED_NO_NETWORK",
    publicationReady: false,
    reason: "SCHEDULED_EXISTING_PIPELINE",
    existingRunner: opts.runnerName || "iu-cj-affiliate-phase3z-empty-feed-reprobe-v51-8",
    liveCall: false,
  };
}
