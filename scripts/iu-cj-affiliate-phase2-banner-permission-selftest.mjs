#!/usr/bin/env node
import {
  accountLevelBannerBasis,
  basisFromDocumentEvidence,
  buildPermissionContextForAdvertiser,
  buildSyntheticTraceableDocument,
  documentEffectiveAtReference,
  documentHasProvenPartnerLinkage,
  documentMatchesAdvertiserScope,
  evaluateIntendedUsePermission,
  evaluatePublicationGates,
  INTENDED_USE,
  renderYvesLocalPreviewHtml,
  resolveDocumentProvisionsForIntendedUse,
} from "./iu-cj-affiliate-phase2-banner-permission-lib.mjs";
import { assessActionValidity } from "./iu-cj-affiliate-phase2-media-inventory-lib.mjs";

const OUR_PUBLISHER_CID = "7991692";
const failures = [];
let checksRun = 0;
function expect(name, cond) {
  checksRun += 1;
  if (!cond) failures.push(name);
}

const ref = new Date("2026-10-17T12:00:00.000Z");

function licenseWithPublisher(evidence) {
  return { publisherCid: OUR_PUBLISHER_CID, bannerPermissionEvidence: evidence };
}

const invalidDateDoc = buildSyntheticTraceableDocument({
  documentId: "BAD-DATES",
  source: "synthetic_test_fixture",
  effectiveFrom: "not-a-date",
  effectiveTo: "not-a-date",
  provisions: [{ provisionId: "P1", intendedUses: [INTENDED_USE.publicDisplay], summary: "should not apply" }],
});
expect(
  "invalid_document_dates_unknown",
  documentEffectiveAtReference(invalidDateDoc, ref).effective === false &&
    basisFromDocumentEvidence("account", invalidDateDoc, ref).state === "unknown"
);

const openEndedDoc = buildSyntheticTraceableDocument({
  documentId: "OPEN-END",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
  provisions: [
    {
      provisionId: "P1",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "open end ok",
      appliesToAllJoinedAdvertisers: true,
    },
  ],
  publisherCid: OUR_PUBLISHER_CID,
});
expect("open_ended_document_effective", documentEffectiveAtReference(openEndedDoc, ref).effective === true);

const mismatchDoc = buildSyntheticTraceableDocument({
  documentId: "PT-MISMATCH",
  source: "synthetic_test_fixture",
  advertiserCid: "9999999",
  effectiveFrom: "2026-01-01T00:00:00Z",
  provisions: [{ provisionId: "A1", intendedUses: [INTENDED_USE.publicDisplay], summary: "wrong cid" }],
});
expect(
  "storage_key_cid_mismatch_blocks",
  documentMatchesAdvertiserScope(mismatchDoc, "5124968").match === false
);
expect(
  "mismatch_doc_not_allowed_for_5124968",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": mismatchDoc } } }, null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const storageKeyOnlyDoc = buildSyntheticTraceableDocument({
  documentId: "PT-STORAGE-KEY-ONLY",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  provisions: [{ provisionId: "K1", intendedUses: [INTENDED_USE.publicDisplay], summary: "no partner linkage fields" }],
});
expect(
  "missing_partner_linkage_unknown",
  documentHasProvenPartnerLinkage(storageKeyOnlyDoc, "5124968").proven === false
);
expect(
  "storage_key_without_linkage_not_allowed",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": storageKeyOnlyDoc } } }, null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const scopedListDoc = buildSyntheticTraceableDocument({
  documentId: "PT-SCOPED-LIST",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  appliesToAdvertiserCids: ["5124968"],
  provisions: [{ provisionId: "L1", intendedUses: [INTENDED_USE.publicDisplay], summary: "scoped list binding" }],
});
expect(
  "applies_to_advertiser_cids_proves_linkage",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": scopedListDoc } } }, null, ref),
    INTENDED_USE.publicDisplay
  ).state === "allowed"
);

const accountMulti = buildSyntheticTraceableDocument({
  documentId: "PSA-MULTI",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  publisherCid: OUR_PUBLISHER_CID,
  provisions: [
    {
      provisionId: "P-multi-display",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "Display for joined advertiser programs",
      appliesToAllJoinedAdvertisers: true,
    },
  ],
});
const licenseAccountOnly = licenseWithPublisher({ account: accountMulti });
const ctx777 = buildPermissionContextForAdvertiser("7777777", licenseAccountOnly, null, ref);
expect(
  "account_multi_provision_allows_without_advertiser_doc",
  evaluateIntendedUsePermission(ctx777, INTENDED_USE.publicDisplay).state === "allowed"
);

const wrongPublisherAccount = buildSyntheticTraceableDocument({
  documentId: "PSA-WRONG-PUB",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  publisherCid: "0000001",
  provisions: [
    {
      provisionId: "P-wrong-pub",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "wrong publisher",
      appliesToAllJoinedAdvertisers: true,
    },
  ],
});
expect(
  "account_publisher_cid_mismatch_blocks",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("7777777", licenseWithPublisher({ account: wrongPublisherAccount }), null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const accountWrongAdvDoc = buildSyntheticTraceableDocument({
  documentId: "PSA-OTHER-ADV",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  publisherCid: OUR_PUBLISHER_CID,
  advertiserCid: "9999999",
  provisions: [
    {
      provisionId: "P-other-adv",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "account doc tied to another advertiser",
      appliesToAllJoinedAdvertisers: true,
    },
  ],
});
expect(
  "account_document_advertiser_cid_blocks_unrelated_partner",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", licenseWithPublisher({ account: accountWrongAdvDoc }), null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const accountExcludeProvision = buildSyntheticTraceableDocument({
  documentId: "PSA-EXCLUDE",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  publisherCid: OUR_PUBLISHER_CID,
  provisions: [
    {
      provisionId: "P-exclude",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "multi with explicit exclusion",
      appliesToAllJoinedAdvertisers: true,
      excludesAdvertiserCids: ["5124968"],
    },
  ],
});
expect(
  "provision_exclusion_overrides_broad_account_grant",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", licenseWithPublisher({ account: accountExcludeProvision }), null, ref),
    INTENDED_USE.publicDisplay
  ).state === "denied"
);

const advertiserYves = buildSyntheticTraceableDocument({
  documentId: "PT-5124968",
  source: "synthetic_test_fixture",
  advertiserCid: "5124968",
  effectiveFrom: "2026-01-01T00:00:00Z",
  provisions: [
    { provisionId: "A1", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.officialSourceFetch], summary: "Yves banner" },
    { provisionId: "A2", intendedUses: [INTENDED_USE.localStorage], summary: "Yves archive" },
  ],
});
const licenseSynth = licenseWithPublisher({
  account: accountMulti,
  byAdvertiserCid: { "5124968": advertiserYves },
});
const ctxSynth = buildPermissionContextForAdvertiser("5124968", licenseSynth, null, ref);
expect(
  "yves_public_display_advertiser_provision",
  evaluateIntendedUsePermission(ctxSynth, INTENDED_USE.publicDisplay).state === "allowed"
);
expect(
  "fetch_separate_from_display",
  evaluateIntendedUsePermission(ctxSynth, INTENDED_USE.officialSourceFetch).state === "allowed"
);

const advertiserDenial = buildSyntheticTraceableDocument({
  documentId: "PT-DENY-5124968",
  source: "synthetic_test_fixture",
  advertiserCid: "5124968",
  effectiveFrom: "2026-01-01T00:00:00Z",
  denial: true,
  provisions: [{ provisionId: "D0", intendedUses: [INTENDED_USE.publicDisplay], summary: "explicit denial" }],
});
expect(
  "advertiser_denial_overrides_account_multi_allow",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser(
      "5124968",
      licenseWithPublisher({ account: accountMulti, byAdvertiserCid: { "5124968": advertiserDenial } }),
      null,
      ref
    ),
    INTENDED_USE.publicDisplay
  ).state === "denied"
);

const advertiserOnlyLicense = { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": advertiserYves } } };
expect(
  "other_advertiser_unknown_without_applicable_provision",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("8888888", advertiserOnlyLicense, null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const flagOnlyAccountDoc = buildSyntheticTraceableDocument({
  documentId: "PSA-FLAG-ONLY",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  coversJoinedAdvertiserCreatives: true,
  provisions: [
    {
      provisionId: "P-no-scope-flag",
      intendedUses: [INTENDED_USE.publicDisplay],
      summary: "doc flag without provision scope",
    },
  ],
});
expect(
  "coversJoinedAdvertiserCreatives_without_provision_scope_not_allowed",
  evaluateIntendedUsePermission(
    buildPermissionContextForAdvertiser("5124968", licenseWithPublisher({ account: flagOnlyAccountDoc }), null, ref),
    INTENDED_USE.publicDisplay
  ).state === "unknown"
);

const readyRow = {
  bannerRole: "C_coupon_campaign_banner",
  linkName: "Campaign",
  affiliateClickUrlPresent: true,
  relationshipStatus: "joined",
  storeHost: "shop.cz",
  marketTargeting: "CZ",
  languageHint: "CZ",
  partnerLinkVerified: true,
  czDeliveryDocumented: true,
  actionValidity: { state: "documented_active_in_window" },
  technicalAvailability: { localImageFile: "banner-assets/1.png" },
  publicationReadiness: { competitorDestinationBlocked: false },
  scopeSummary: { scopeType: "full_sortiment" },
};
function pubGate(row, ctx, couponGate) {
  return evaluatePublicationGates(row, ctx, couponGate);
}

const readyBatch = pubGate(readyRow, ctxSynth, { czCouponPublishEligibility: "eligible" });
expect("full_ready_decision", readyBatch.state === "ready_pending_manual_confirmation");
expect(
  "full_ready_display_allowed_with_reason",
  readyBatch.permissionPublicDisplay.state === "allowed" && readyBatch.permissionPublicDisplay.citation?.includes("PT-5124968")
);
expect("full_ready_no_fetch_blocker_when_local_asset", !readyBatch.blockers.some((b) => b.id.startsWith("fetch_permission")));

const accountListBypassPublisher = buildSyntheticTraceableDocument({
  documentId: "PSA-LIST-BYPASS-PUB",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  publisherCid: "0000001",
  provisions: [
    {
      provisionId: "P-list-target",
      intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
      summary: "explicit list must not skip publisher party check",
      appliesToAdvertiserCids: ["5124968"],
    },
  ],
});
const ctxListBypass = buildPermissionContextForAdvertiser(
  "5124968",
  licenseWithPublisher({ account: accountListBypassPublisher }),
  null,
  ref
);
const reproAccountPartyList = pubGate(readyRow, ctxListBypass, { czCouponPublishEligibility: "eligible" });
expect(
  "repro_account_foreign_publisher_plus_partner_list_blocked",
  reproAccountPartyList.state === "not_ready" &&
    reproAccountPartyList.permissionPublicDisplay.state !== "allowed" &&
    reproAccountPartyList.blockers.some((b) => b.id === "display_permission_unknown")
);

const partnerDocExclude = buildSyntheticTraceableDocument({
  documentId: "PT-DOC-EXCLUDE",
  source: "synthetic_test_fixture",
  advertiserCid: "5124968",
  effectiveFrom: "2026-01-01T00:00:00Z",
  excludesAdvertiserCids: ["5124968"],
  provisions: [{ provisionId: "X1", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage], summary: "doc exclude" }],
});
const reproDocExCtx = buildPermissionContextForAdvertiser(
  "5124968",
  { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": partnerDocExclude } } },
  null,
  ref
);
const reproDocExGate = pubGate(readyRow, reproDocExCtx, { czCouponPublishEligibility: "eligible" });
expect(
  "repro_partner_document_excludes_advertiser_blocked",
  reproDocExGate.state === "not_ready" &&
    reproDocExGate.permissionPublicDisplay.state === "denied" &&
    reproDocExGate.blockers.some((b) => b.id === "display_permission_denied")
);

const partnerProvExclude = buildSyntheticTraceableDocument({
  documentId: "PT-PROV-EXCLUDE",
  source: "synthetic_test_fixture",
  advertiserCid: "5124968",
  effectiveFrom: "2026-01-01T00:00:00Z",
  provisions: [
    {
      provisionId: "X2",
      intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
      summary: "provision exclude",
      excludesAdvertiserCids: ["5124968"],
    },
  ],
});
const reproProvExGate = pubGate(
  readyRow,
  buildPermissionContextForAdvertiser("5124968", { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": partnerProvExclude } } }, null, ref),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_partner_provision_excludes_advertiser_blocked",
  reproProvExGate.state === "not_ready" &&
    reproProvExGate.permissionPublicDisplay.state === "denied" &&
    reproProvExGate.blockers.some((b) => b.id === "display_permission_denied")
);

const partnerListConflict = buildSyntheticTraceableDocument({
  documentId: "PT-LIST-CONFLICT",
  source: "synthetic_test_fixture",
  advertiserCid: "5124968",
  effectiveFrom: "2026-01-01T00:00:00Z",
  appliesToAdvertiserCids: ["7777777"],
  provisions: [{ provisionId: "X3", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage], summary: "list conflict" }],
});
const reproListConflictGate = pubGate(
  readyRow,
  buildPermissionContextForAdvertiser("5124968", { bannerPermissionEvidence: { byAdvertiserCid: { "5124968": partnerListConflict } } }, null, ref),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_partner_advertiser_cid_vs_applies_list_unknown_blocks",
  reproListConflictGate.state === "not_ready" &&
    reproListConflictGate.permissionPublicDisplay.state === "unknown" &&
    reproListConflictGate.blockers.some((b) => b.id === "display_permission_unknown")
);

const displayOnlyCtx = buildPermissionContextForAdvertiser(
  "5124968",
  {
    bannerPermissionEvidence: {
      byAdvertiserCid: {
        "5124968": buildSyntheticTraceableDocument({
          documentId: "PT-DISPLAY-ONLY",
          source: "synthetic_test_fixture",
          advertiserCid: "5124968",
          effectiveFrom: "2026-01-01T00:00:00Z",
          provisions: [
            { provisionId: "D1", intendedUses: [INTENDED_USE.publicDisplay], summary: "display only" },
            { provisionId: "D2", intendedUses: [INTENDED_USE.localStorage], summary: "storage" },
          ],
        }),
      },
    },
  },
  null,
  ref
);
expect(
  "display_allowed_without_fetch_rights",
  evaluateIntendedUsePermission(displayOnlyCtx, INTENDED_USE.publicDisplay).state === "allowed" &&
    evaluateIntendedUsePermission(displayOnlyCtx, INTENDED_USE.officialSourceFetch).state === "unknown"
);
const localOnlyGates = evaluatePublicationGates(readyRow, displayOnlyCtx, { czCouponPublishEligibility: "eligible" });
expect(
  "local_asset_publication_without_fetch_permission",
  !localOnlyGates.blockers.some((b) => b.id.startsWith("fetch_permission")) &&
    !localOnlyGates.blockers.some((b) => b.id.startsWith("display_permission"))
);

const couponNa = {
  ...readyRow,
  actionValidity: { state: "not_applicable", category: "general_partner_creative" },
};
expect(
  "coupon_not_applicable_rejected",
  evaluatePublicationGates(couponNa, ctxSynth, { czCouponPublishEligibility: "eligible" }).blockers.some(
    (b) => b.id === "coupon_action_validity_not_applicable_rejected"
  )
);

const couponGateCtx = ctxSynth;
function gateBlockers(row, couponGate) {
  return evaluatePublicationGates(row, couponGateCtx, couponGate).blockers.map((b) => b.id);
}
const couponBase = { ...readyRow, actionValidity: { state: "documented_active_in_window" } };
expect("coupon_gate_missing_blocked", gateBlockers(couponBase, null).includes("coupon_gate_assessment_missing"));
expect("coupon_gate_unknown_blocked", gateBlockers(couponBase, { czCouponPublishEligibility: "unknown" }).includes("coupon_gate_unknown"));
expect(
  "coupon_gate_ineligible_blocked",
  gateBlockers(couponBase, { czCouponPublishEligibility: "ineligible" }).includes("coupon_gate_ineligible")
);
expect(
  "coupon_gate_unrecognized_state_blocked",
  gateBlockers(couponBase, { czCouponPublishEligibility: "pending_review" }).includes("coupon_gate_not_approved")
);

const discountRow = {
  bannerRole: "B_specific_discount_action_banner",
  linkName: "Sale",
  affiliateClickUrlPresent: true,
  relationshipStatus: "joined",
  storeHost: "shop.cz",
  partnerLinkVerified: true,
  technicalAvailability: { localImageFile: "x.png" },
  publicationReadiness: { competitorDestinationBlocked: false },
  scopeSummary: { scopeType: "full_sortiment" },
};
expect(
  "action_expired_blocked",
  evaluatePublicationGates({ ...discountRow, actionValidity: { state: "documented_inactive", reason: "past_end" } }, ctxSynth, null).blockers.some(
    (b) => b.id === "action_expired"
  )
);
expect(
  "action_future_blocked",
  evaluatePublicationGates(
    { ...discountRow, actionValidity: { state: "documented_not_yet_active", reason: "before_start" } },
    ctxSynth,
    null
  ).blockers.some((b) => b.id === "action_future")
);
expect(
  "action_validity_unverified_blocked",
  evaluatePublicationGates(
    { ...discountRow, actionValidity: { state: "partially_documented_period", partialEndKind: "missing_end" } },
    ctxSynth,
    null
  ).blockers.some((b) => b.id === "action_validity_unverified")
);

const generalCreativeRow = {
  bannerRole: "A_partner_general_banner",
  linkName: "Brand",
  affiliateClickUrlPresent: true,
  relationshipStatus: "joined",
  storeHost: "shop.cz",
  partnerLinkVerified: true,
  technicalAvailability: {},
  publicationReadiness: { competitorDestinationBlocked: false },
  actionValidity: { state: "not_applicable", category: "general_partner_creative" },
};
const generalGates = evaluatePublicationGates(generalCreativeRow, ctxSynth, null);
expect(
  "general_creative_skips_coupon_gates",
  !generalGates.blockers.some((b) => b.id.startsWith("coupon_gate"))
);

const flagsOnly = {
  imageUsageAllowedState: "allowed",
  documents: { publisherServiceAgreement: { read: true } },
};
expect("flags_alone_not_allowed", accountLevelBannerBasis(flagsOnly, ref).state === "unknown");

const partialAction = assessActionValidity(
  "B_specific_discount_action_banner",
  { promotionStartDate: "2026-01-01 00:00:00.0", promotionEndDate: "" },
  ref
);
expect("partial_validity_not_closed_active", partialAction.state === "partially_documented_period");

function partnerDocWithProvisions(documentId, provisions) {
  return buildSyntheticTraceableDocument({
    documentId,
    source: "synthetic_test_fixture",
    advertiserCid: "5124968",
    effectiveFrom: "2026-01-01T00:00:00Z",
    provisions,
  });
}

const provisionExcludePair = {
  provisionId: "ORD-EX",
  intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
  excludesAdvertiserCids: ["5124968"],
  summary: "explicit partner exclusion provision",
};
const provisionGeneralGrant = {
  provisionId: "ORD-GR",
  intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
  summary: "general partner grant provision",
};

function licenseForPartnerDoc(doc, supersRegistry = {}) {
  return {
    publisherCid: OUR_PUBLISHER_CID,
    bannerPermissionEvidence: {
      byAdvertiserCid: { "5124968": doc },
      supersedesByBasisDocumentId: supersRegistry,
    },
  };
}

function ctxForPartnerDoc(doc, supersRegistry = {}) {
  return buildPermissionContextForAdvertiser("5124968", licenseForPartnerDoc(doc, supersRegistry), null, ref);
}

const supersessionBasisOnRecord = {
  read: true,
  documentId: "SUP-BASIS-DOC-1",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
  confirmsSupersedes: [
    {
      replacesProvisionId: "ORD-EX",
      intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
      advertiserCids: ["5124968"],
      confirmsReplacement: true,
      citation: "AMEND-READ-1§AMEND-P1",
      summary: "Read amendment confirms lifting ORD-EX exclusion for partner",
      readTraceableDocument: {
        read: true,
        documentId: "AMEND-READ-1",
        source: "synthetic_test_fixture_archived_amendment",
        effectiveFrom: "2026-01-01T00:00:00Z",
        parentDocumentId: "PT-SUP-VALID",
        parentProvisionId: "ORD-EX",
        citesProvisionId: "AMEND-P1",
        provisions: [
          {
            provisionId: "AMEND-P1",
            intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
            summary: "Amendment clause lifts prior ORD-EX exclusion",
          },
        ],
      },
    },
  ],
};

const gateExcludeThenGrant = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-ORDER-EX-GR", [provisionExcludePair, provisionGeneralGrant])),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "provision_order_exclude_then_general_grant_blocked",
  gateExcludeThenGrant.state === "not_ready" &&
    gateExcludeThenGrant.permissionPublicDisplay.state === "denied" &&
    gateExcludeThenGrant.blockers.some((b) => b.id === "display_permission_denied")
);

const gateGrantThenExclude = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-ORDER-GR-EX", [provisionGeneralGrant, provisionExcludePair])),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "provision_order_general_grant_then_exclude_blocked",
  gateGrantThenExclude.state === "not_ready" &&
    gateGrantThenExclude.permissionPublicDisplay.state === "denied" &&
    gateGrantThenExclude.blockers.some((b) => b.id === "display_permission_denied")
);

const compatibleDualDoc = partnerDocWithProvisions("PT-COMPAT-DUAL", [
  { provisionId: "CMP-1", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage], summary: "compatible grant clause one" },
  { provisionId: "CMP-2", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage], summary: "compatible grant clause two" },
]);
const gateCompatible = pubGate(readyRow, ctxForPartnerDoc(compatibleDualDoc), { czCouponPublishEligibility: "eligible" });
expect(
  "two_compatible_provisions_allowed",
  gateCompatible.state === "ready_pending_manual_confirmation" &&
    gateCompatible.permissionPublicDisplay.state === "allowed" &&
    (gateCompatible.permissionPublicDisplay.citation || "").includes("CMP-1") &&
    (gateCompatible.permissionPublicDisplay.citation || "").includes("CMP-2")
);

const splitUsesDoc = partnerDocWithProvisions("PT-SPLIT-USES", [
  { provisionId: "USE-D", intendedUses: [INTENDED_USE.publicDisplay], summary: "display path" },
  { provisionId: "USE-S", intendedUses: [INTENDED_USE.localStorage], summary: "storage path" },
]);
const ctxSplitUses = ctxForPartnerDoc(splitUsesDoc);
expect(
  "distinct_intended_uses_resolved_separately_display",
  evaluateIntendedUsePermission(ctxSplitUses, INTENDED_USE.publicDisplay).state === "allowed"
);
expect(
  "distinct_intended_uses_resolved_separately_storage",
  evaluateIntendedUsePermission(ctxSplitUses, INTENDED_USE.localStorage).state === "allowed"
);
const gateSplitUses = pubGate(readyRow, ctxSplitUses, { czCouponPublishEligibility: "eligible" });
expect(
  "distinct_intended_uses_publication_ready",
  gateSplitUses.state === "ready_pending_manual_confirmation" &&
    !gateSplitUses.blockers.some((b) => b.id.startsWith("display_permission")) &&
    !gateSplitUses.blockers.some((b) => b.id.startsWith("storage_permission"))
);

const unrestrictedPositiveDoc = partnerDocWithProvisions("PT-UNRESTRICTED", [
  { provisionId: "POS-1", intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage], summary: "unrestricted display and storage" },
]);
const gateUnrestricted = pubGate(readyRow, ctxForPartnerDoc(unrestrictedPositiveDoc), { czCouponPublishEligibility: "eligible" });
expect(
  "full_positive_unrestricted_provisions_ready",
  gateUnrestricted.state === "ready_pending_manual_confirmation" &&
    gateUnrestricted.permissionPublicDisplay.state === "allowed" &&
    !gateUnrestricted.blockers.some((b) => b.id.startsWith("display_permission"))
);

const validSupersedesEvidence = {
  read: true,
  basisDocumentId: "SUP-BASIS-DOC-1",
  basisSource: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
};
const grantWithDocumentedSupersedes = {
  provisionId: "ORD-GR-SUP-OK",
  intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
  summary: "grant with verifiable supersession basis",
  supersedesProvisionIds: ["ORD-EX"],
  supersedesIntendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
  supersedesForAdvertiserCids: ["5124968"],
  supersedesEvidence: validSupersedesEvidence,
};
const gateValidSupersedes = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-VALID", [provisionExcludePair, grantWithDocumentedSupersedes]), {
    "SUP-BASIS-DOC-1": supersessionBasisOnRecord,
  }),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_documented_supersedes_allows_publication",
  gateValidSupersedes.state === "ready_pending_manual_confirmation" &&
    gateValidSupersedes.permissionPublicDisplay.state === "allowed"
);

const grantUndocumentedSupersedes = {
  ...provisionGeneralGrant,
  provisionId: "ORD-GR-SUP-UNDOC",
  supersedesProvisionIds: ["ORD-EX"],
};
const gateUndocSup = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-UNDOC", [provisionExcludePair, grantUndocumentedSupersedes]), {}),
  { czCouponPublishEligibility: "eligible" }
);

const gateGhostSupersedesMetadata = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-GHOST-META", [provisionExcludePair, grantWithDocumentedSupersedes]), {}),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_supersedes_metadata_without_on_record_basis_not_allowed",
  gateGhostSupersedesMetadata.state === "not_ready" &&
    gateGhostSupersedesMetadata.permissionPublicDisplay.state !== "allowed" &&
    gateGhostSupersedesMetadata.blockers.some((b) => b.id.startsWith("display_permission"))
);

const hollowConfirmRecord = {
  read: true,
  documentId: "SUP-BASIS-HOLLOW",
  source: "synthetic_test_fixture",
  effectiveFrom: "2026-01-01T00:00:00Z",
  confirmsSupersedes: [
    {
      replacesProvisionId: "ORD-EX",
      intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
      advertiserCids: ["5124968"],
      confirmsReplacement: true,
      summary: "registry flag only without read traceable amendment",
    },
  ],
};
const grantHollowRegistry = {
  ...grantWithDocumentedSupersedes,
  provisionId: "ORD-GR-SUP-HOLLOW",
  supersedesEvidence: { ...validSupersedesEvidence, basisDocumentId: "SUP-BASIS-HOLLOW" },
};
const gateHollowRegistry = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-HOLLOW", [provisionExcludePair, grantHollowRegistry]), {
    "SUP-BASIS-HOLLOW": hollowConfirmRecord,
  }),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_registry_confirm_without_read_traceable_basis_not_allowed",
  gateHollowRegistry.state === "not_ready" &&
    gateHollowRegistry.permissionPublicDisplay.state !== "allowed" &&
    gateHollowRegistry.blockers.some((b) => b.id.startsWith("display_permission"))
);

expect(
  "repro_undocumented_supersedes_not_allowed",
  gateUndocSup.state === "not_ready" &&
    gateUndocSup.permissionPublicDisplay.state !== "allowed" &&
    (gateUndocSup.permissionPublicDisplay.state === "unknown" || gateUndocSup.permissionPublicDisplay.state === "denied")
);

const grantWrongSupersedesScope = {
  ...grantWithDocumentedSupersedes,
  provisionId: "ORD-GR-SUP-BAD-SCOPE",
  supersedesForAdvertiserCids: ["7777777"],
};
const gateBadSupScope = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-BAD-SCOPE", [provisionExcludePair, grantWrongSupersedesScope])),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_supersedes_wrong_partner_scope_keeps_exclusion",
  gateBadSupScope.state === "not_ready" && gateBadSupScope.permissionPublicDisplay.state === "denied"
);

const grantExpiredSupersedesBasis = {
  ...grantWithDocumentedSupersedes,
  provisionId: "ORD-GR-SUP-BAD-TIME",
  supersedesEvidence: {
    ...validSupersedesEvidence,
    basisDocumentId: "SUP-BASIS-FUTURE",
    effectiveFrom: "2030-06-01T00:00:00Z",
  },
};
const gateBadSupTime = pubGate(
  readyRow,
  ctxForPartnerDoc(partnerDocWithProvisions("PT-SUP-BAD-TIME", [provisionExcludePair, grantExpiredSupersedesBasis])),
  { czCouponPublishEligibility: "eligible" }
);
expect(
  "repro_supersedes_invalid_reference_period_blocked",
  gateBadSupTime.state === "not_ready" &&
    gateBadSupTime.permissionPublicDisplay.state !== "allowed" &&
    gateBadSupTime.blockers.some((b) => b.id.startsWith("display_permission"))
);

const limitationPlusGrantDoc = partnerDocWithProvisions("PT-OTHER-LIM-GRANT", [
  {
    provisionId: "LIM-OTHER-CID",
    intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
    appliesToAdvertiserCids: ["7777777"],
    summary: "limitation scoped to another partner",
  },
  {
    provisionId: "GEN-LINKED",
    intendedUses: [INTENDED_USE.publicDisplay, INTENDED_USE.localStorage],
    summary: "general grant on linked partner doc",
  },
]);
const gateLimitationGrant = pubGate(readyRow, ctxForPartnerDoc(limitationPlusGrantDoc), { czCouponPublishEligibility: "eligible" });
expect(
  "repro_other_denied_plus_allowed_unresolved_unknown",
  gateLimitationGrant.state === "not_ready" &&
    gateLimitationGrant.permissionPublicDisplay.state === "unknown" &&
    gateLimitationGrant.blockers.some((b) => b.id === "display_permission_unknown")
);

const ctxPartnerConflictAccountFallback = buildPermissionContextForAdvertiser(
  "5124968",
  licenseWithPublisher({
    account: accountMulti,
    byAdvertiserCid: { "5124968": limitationPlusGrantDoc },
  }),
  null,
  ref
);
const gateNoAccountFallback = pubGate(readyRow, ctxPartnerConflictAccountFallback, { czCouponPublishEligibility: "eligible" });
expect(
  "repro_unresolved_partner_doc_blocks_account_fallback",
  gateNoAccountFallback.permissionPublicDisplay.state !== "allowed" &&
    gateNoAccountFallback.state === "not_ready" &&
    !gateNoAccountFallback.blockers.every((b) => b.id.startsWith("coupon_"))
);

const syntheticPreviewHtml = renderYvesLocalPreviewHtml(
  {
    creativeImage: {
      localRelativePath: null,
      fetchBlockedReason: "synthetic_fixture_no_fetch",
    },
    actionMeaning: { documented: {}, notInferred: {} },
    batchAssessment: { publicationReadiness: { state: "not_ready" } },
    userDocumentStep: { oneStep: "synthetic selftest fixture" },
  },
  (s) => String(s ?? "")
);
expect("synthetic_preview_no_external_img", !/<img[^>]+src=["']https?:/i.test(syntheticPreviewHtml));
expect("synthetic_preview_no_kqzyfj", !/kqzyfj\.com/i.test(syntheticPreviewHtml));

const orderTestCid = "8877665";
const provExclude = {
  provisionId: "EX-A",
  intendedUses: [INTENDED_USE.publicDisplay],
  summary: "explicit partner exclusion",
  excludesAdvertiserCids: [orderTestCid],
};
const provGeneral = {
  provisionId: "GR-B",
  intendedUses: [INTENDED_USE.publicDisplay],
  summary: "general joined advertiser grant",
  appliesToAllJoinedAdvertisers: true,
};
const docOrderAB = buildSyntheticTraceableDocument({
  documentId: "DOC-ORDER-AB",
  source: "selftest",
  provisions: [provExclude, provGeneral],
  advertiserCid: orderTestCid,
});
const docOrderBA = buildSyntheticTraceableDocument({
  documentId: "DOC-ORDER-BA",
  source: "selftest",
  provisions: [provGeneral, provExclude],
  advertiserCid: orderTestCid,
});
const ctxOrder = { publisherCid: OUR_PUBLISHER_CID, referenceAssessmentAt: ref };
const resAB = resolveDocumentProvisionsForIntendedUse("advertiser", docOrderAB, INTENDED_USE.publicDisplay, orderTestCid, ctxOrder);
const resBA = resolveDocumentProvisionsForIntendedUse("advertiser", docOrderBA, INTENDED_USE.publicDisplay, orderTestCid, ctxOrder);
expect(
  "grants_order_AB_exclusion_wins_denied",
  resAB.state === "denied" && resAB.reason === "documented_advertiser_exclusion"
);
expect(
  "grants_order_BA_exclusion_wins_denied",
  resBA.state === "denied" && resBA.reason === "documented_advertiser_exclusion"
);
expect("grants_order_AB_BA_same_state", resAB.state === resBA.state && resAB.reason === resBA.reason);

if (failures.length) {
  console.log(JSON.stringify({ IU_CJ_BANNER_PERMISSION_SELFTEST: "FAIL", failures, checksRun }));
  process.exit(1);
}
console.log(JSON.stringify({ IU_CJ_BANNER_PERMISSION_SELFTEST: "OK", checksRun }));
