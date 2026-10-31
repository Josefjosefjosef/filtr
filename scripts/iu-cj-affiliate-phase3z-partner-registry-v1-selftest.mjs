#!/usr/bin/env node
/**
 * Offline Phase 3Z partner-registry selftest (no live CJ HTTP).
 */
import {
  proposeCzechDisplayName,
  scoreAffiliateLink,
  selectPrimaryAffiliateLink,
  marketAllowsCzechRepublic,
  buildPhase3zPartnerRegistry,
  buildPhase3zSafetyGates,
  classifyPartnerSection,
  applyUrlVerificationToPartner,
  PUBLISHABILITY,
  PHASE3Z_RULES_VERSION,
  classifyFromCjEvidence,
  sectionSemanticConflict,
  resolveChipOwnership,
  buildBrandComparisonMatrix,
  loadAuthoritativeTaxonomy,
  SECTION_TITLES,
  detectPageLanguage,
  selectLanguagePreference,
  buildEvidenceMatrix,
  assertEvidenceConsistency,
  assertJoinedEqualsButtonRecords,
  BUTTON_RECORD_STATUS,
  decodeHtmlEntitiesInUrl,
  classifyDestinationRole,
  evaluateLinkEligibility,
  DESTINATION_ROLE,
  LINK_ELIGIBILITY,
  buildAssortmentProfile,
  selectPrimarySectionWithAssortment,
  auditLinkCandidateBuckets,
  explainTaxonomy36vs38,
  MERCHANT_TYPE,
  classifyDestinationType,
  applyMerchantEvidenceOverride,
  isUnsuitableMainDestination,
  GOLDEN_DATASET_V9,
  DESTINATION_TYPE,
} from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { normalizePartnerBrand } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

expect(
  "cz_name_strips_region",
  proposeCzechDisplayName("Dermacol CZ/SK/PL/RO", "https://www.dermacol.cz/").includes("Dermacol")
);
expect("norm_dermacol", normalizePartnerBrand("Dermacol CZ/SK/PL/RO") === "dermacol");
expect("market_cz", marketAllowsCzechRepublic("CZ") === true);
expect("market_it", marketAllowsCzechRepublic("IT, CH") === false);
expect("market_empty_null", marketAllowsCzechRepublic("") === null);
expect(
  "tracking_kqzyfj",
  isCjTrackingUrl("https://www.kqzyfj.com/click-101883843-15319224-1707865993000")
);

expect("lang_cz_host", detectPageLanguage({ url: "https://shop.cz/" }) === "CZ");
expect("lang_sk_path", detectPageLanguage({ url: "https://example.com/sk/home" }) === "SK");
expect("lang_en_path", detectPageLanguage({ url: "https://example.com/en/home" }) === "EN");
const langPref = selectLanguagePreference([
  { language: "EN", linkId: "1" },
  { language: "SK", linkId: "2" },
  { language: "CZ", linkId: "3" },
]);
expect("lang_priority_cz", langPref.selectedLanguage === "CZ" && langPref.languagePrioritySatisfied);
const langEnOnly = selectLanguagePreference([{ language: "EN", linkId: "9" }]);
expect("lang_en_ok", langEnOnly.selectedLanguage === "EN" && langEnOnly.languagePrioritySatisfied);

const byrokko = classifyPartnerSection({
  advertiserId: "7133039",
  advertiser: {
    advertiserName: "Byrokko World",
    programUrl: "https://www.byrokko.com/",
    primaryCategory: "<parent>Beauty</parent><child>Bath &amp; Body</child>",
  },
  sectionMap: {},
});
expect("byrokko_kosmetika", byrokko.sectionId === "aff-kosmetika", byrokko);

const ecomodi = classifyPartnerSection({
  advertiserId: "6065327",
  advertiser: {
    advertiserName: "Ecomodi CZ/SK",
    programUrl: "https://www.ecomodi.cz/",
    primaryCategory: "<parent>Clothing/Apparel</parent><child>Womens</child>",
  },
  sectionMap: { "6065327": "aff-drogerie" },
});
expect("ecomodi_override_moda", ecomodi.sectionId === "aff-moda", ecomodi);
expect(
  "ecomodi_override_source",
  String(ecomodi.source || "").includes("overridden"),
  ecomodi
);

const leo = classifyFromCjEvidence({
  advertiserName: "Leo Express Europe",
  programUrl: "https://www.leoexpress.com/cs",
  primaryCategory: "<parent>Business</parent><child>Travel</child>",
});
expect("leo_doprava", leo.sectionId === "aff-letenky", leo);
expect("leo_title_doprava", SECTION_TITLES["aff-letenky"] === "Doprava a cestování");
expect(
  "leo_air_conflict_only",
  sectionSemanticConflict(
    "aff-letenky-letecka-doprava",
    { advertiserName: "Leo Express Europe" },
    "business|travel"
  )?.ok === false
);
expect(
  "leo_doprava_ok",
  sectionSemanticConflict("aff-letenky", { advertiserName: "Leo Express Europe" }, "business|travel")
    ?.ok === true
);

const axa = classifyFromCjEvidence({
  advertiserName: "AXA Assistance",
  programUrl: "https://www.axa-assistance.cz/",
  primaryCategory: "<parent>Insurance</parent><child>Travel Insurance</child>",
});
expect("axa_cestovni_pojisteni", axa.sectionId === "aff-cestovni-pojisteni", axa);

const klik = classifyPartnerSection({
  advertiserId: "9999001",
  advertiser: {
    advertiserName: "Klik.cz",
    programUrl: "https://www.klik.cz/",
    primaryCategory: "<parent>Insurance</parent><child>Travel Insurance</child>",
  },
  sectionMap: {},
});
expect("klik_cestovni_pojisteni", klik.sectionId === "aff-cestovni-pojisteni", klik);
const klikMappedWrong = classifyPartnerSection({
  advertiserId: "9999001",
  advertiser: {
    advertiserName: "Klik.cz",
    programUrl: "https://www.klik.cz/",
    primaryCategory: "<parent>Insurance</parent><child>Personal Insurance</child>",
  },
  sectionMap: { "9999001": "aff-pojisteni" },
});
expect(
  "klik_override_from_general",
  klikMappedWrong.sectionId === "aff-cestovni-pojisteni",
  klikMappedWrong
);

const bestDrive = classifyPartnerSection({
  advertiserId: "7449050",
  advertiser: {
    advertiserName: "BestDrive",
    programUrl: "https://www.bestdrive.cz/",
    primaryCategory: "<parent>Automotive</parent><child>Parts &amp; Accessories</child>",
  },
  sectionMap: { "7449050": "aff-pneu-pneuservis" },
});
expect("bestdrive_pneu", bestDrive.sectionId === "aff-pneu-pneuservis", bestDrive);

const catalogPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "assets",
  "iu-affiliate-catalog.js"
);
const tax = loadAuthoritativeTaxonomy(fs.readFileSync(catalogPath, "utf8"));
expect("taxonomy_36", tax.taxonomyCount === 36, tax.taxonomyCount);
expect(
  "taxonomy_letenky_title",
  tax.titleById["aff-letenky"] === "Doprava a cestování",
  tax.titleById["aff-letenky"]
);

const ownUa = resolveChipOwnership({
  management: "UNASSIGNED",
  relationshipStatus: "joined",
  publishability: PUBLISHABILITY.READY_FOR_REVIEW,
});
expect("ownership_unassigned", ownUa.ownership === "UNASSIGNED_ROBOT_ELIGIBLE");
expect("ownership_unified_target", ownUa.unifiedManagementTarget === "CJ_MANAGED_AFTER_GO");
expect(
  "gates_have_13",
  buildPhase3zSafetyGates(
    {
      counts: { joined: 1, partners: 1 },
      partners: [],
      deduplicationDecisions: [],
      taxonomy: { taxonomyCount: 36 },
      liveEnabled: false,
      publicButtonSwapArmed: false,
      joinedButtonParity: { ok: true, joined: 1, buttonRecords: 1 },
    },
    { counts: { buttons: 1, quarantined: 0 }, buttons: [], publicButtonSwapArmed: false }
  ).gates?.length === 13
);
expect(
  "ownership_paid_out",
  resolveChipOwnership({
    management: "PAID_RESERVED",
    relationshipStatus: "joined",
    publishability: PUBLISHABILITY.READY_FOR_REVIEW,
  }).takeoverEligible === false
);

const wear = classifyPartnerSection({
  advertiserId: "7726276",
  advertiser: {
    advertiserName: "WearMedicine CZ",
    programUrl: "https://wearmedicine.cz/",
    primaryCategory: "<parent>Clothing/Apparel</parent><child>Womens</child>",
  },
  sectionMap: {},
});
expect("wear_moda", wear.sectionId === "aff-moda", wear);

const doppler = classifyPartnerSection({
  advertiserId: "6065245",
  advertiser: {
    advertiserName: "Dopplershop cz/sk",
    programUrl: "https://www.dopplershop.cz/",
    primaryCategory: "<parent>Home &amp; Garden</parent><child>Garden</child>",
  },
  sectionMap: {},
});
expect("doppler_dum_zahrada", doppler.sectionId === "aff-dum-zahrada", doppler);

const butlers = classifyPartnerSection({
  advertiserId: "4432968",
  advertiser: {
    advertiserName: "Butlers.cz",
    programUrl: "http://www.butlers.cz",
    primaryCategory: "<parent>Home &amp; Garden</parent><child>Home Appliances</child>",
  },
  sectionMap: {},
});
expect("butlers_dum_zahrada", butlers.sectionId === "aff-dum-zahrada", butlers);

const adv = {
  advertiserId: "6065245",
  advertiserName: "Dopplershop cz/sk",
  programUrl: "https://www.dopplershop.cz/",
  relationshipStatus: "joined",
  accountStatus: "Active",
  primaryCategory: "<parent>Home &amp; Garden</parent><child>Garden</child>",
};
const links = [
  {
    linkId: "1",
    advertiserId: "6065245",
    linkName: "DopplershopCZ_deeplink",
    linkType: "Text Link",
    destination: "https://www.dopplershop.cz/",
    clickUrl: "https://www.dpbolvw.net/click-101883843-15319222-1707865993000",
    targetedCountries: "CZ",
  },
  {
    linkId: "2",
    advertiserId: "6065245",
    linkName: "DopplershopSK_deeplink",
    linkType: "Text Link",
    destination: "https://www.dopplershop.sk/",
    clickUrl: "https://www.tkqlhce.com/click-101883843-15319231-1707865993000",
    targetedCountries: "SK",
  },
  {
    linkId: "3",
    advertiserId: "6065245",
    linkName: "Summer SALE coupon 50%",
    linkType: "Banner",
    destination: "https://www.dopplershop.cz/sale",
    clickUrl: "https://www.kqzyfj.com/click-101883843-999-1707865993000",
    targetedCountries: "CZ",
  },
];
const pick = selectPrimaryAffiliateLink(links, adv);
expect("pick_cz_home", pick.selected?.linkId === "1", { got: pick.selected?.linkId, score: pick.score });
expect("sk_lower", scoreAffiliateLink(links[1], adv).score < scoreAffiliateLink(links[0], adv).score);

const staging = {
  generatedAt: "2026-10-29T20:54:39.275Z",
  websitePid: "101883843",
  advertisers: [
    adv,
    {
      advertiserId: "7133039",
      advertiserName: "Byrokko World",
      programUrl: "https://www.byrokko.com/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Beauty</parent><child>Bath &amp; Body</child>",
    },
    {
      advertiserId: "2624620",
      advertiserName: "ABBYY Europe Affiliate Program",
      programUrl: "https://www.abbyy.com/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Computer &amp; Electronics</parent><child>Computer SW</child>",
    },
    {
      advertiserId: "9990001",
      advertiserName: "Paid Slot Dummy",
      programUrl: "https://www.example.cz/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Beauty</parent><child>Cosmetics</child>",
    },
  ],
  links: [
    ...links,
    {
      linkId: "20",
      advertiserId: "7133039",
      linkName: "home",
      linkType: "Text Link",
      destination: "https://www.byrokko.com/cz",
      clickUrl: "https://www.dpbolvw.net/click-101883843-20-20",
      targetedCountries: "CZ",
    },
    {
      linkId: "10",
      advertiserId: "2624620",
      linkName: "IT coupon",
      linkType: "Text Link",
      destination: "https://digital.abbyy.com/it",
      clickUrl: "https://www.dpbolvw.net/click-101883843-17372043-1793080800000",
      targetedCountries: "IT, CH",
    },
    {
      linkId: "11",
      advertiserId: "9990001",
      linkName: "Home",
      linkType: "Text Link",
      destination: "https://www.example.cz/",
      clickUrl: "https://www.dpbolvw.net/click-101883843-1-1",
      targetedCountries: "CZ",
    },
  ],
};

const { registry, buttonCatalog } = buildPhase3zPartnerRegistry({
  staging,
  sectionMap: {},
  slotPolicy: {
    partners: [
      {
        advertiserId: "9990001",
        management: "PAID_RESERVED",
        sectionId: "aff-kosmetika",
      },
    ],
  },
  catalogSrc: "",
});

expect("disarmed_registry", registry.liveEnabled === false && registry.publicButtonSwapArmed === false);
expect("disarmed_buttons", buttonCatalog.publicButtonSwapArmed === false);
expect(
  "doppler_candidate_home",
  buttonCatalog.buttons.some((b) => b.advertiserId === "6065245" && b.sectionId === "aff-dum-zahrada")
);
expect(
  "byrokko_candidate",
  buttonCatalog.buttons.some((b) => b.advertiserId === "7133039")
);
expect(
  "no_preview_ready_legacy",
  !buttonCatalog.buttons.some((b) => b.publishability === "PREVIEW_READY")
);
expect(
  "abbyy_button_record",
  buttonCatalog.buttons.some((b) => b.advertiserId === "2624620")
);
expect(
  "abbyy_not_ready",
  buttonCatalog.buttons.some(
    (b) =>
      b.advertiserId === "2624620" &&
      b.publishability !== PUBLISHABILITY.READY_FOR_REVIEW &&
      (b.holdReason === "CZ_ELIGIBILITY_UNKNOWN" ||
        b.holdReason === "CZ_RESTRICTED_CONFIRMED" ||
        b.holdReason === "market_not_targeting_cz" ||
        b.buttonRecordStatus === BUTTON_RECORD_STATUS.CZ_ELIGIBILITY_UNKNOWN ||
        b.buttonRecordStatus === BUTTON_RECORD_STATUS.CZ_RESTRICTED_CONFIRMED)
  )
);
expect(
  "paid_button_record",
  buttonCatalog.buttons.some(
    (b) => b.advertiserId === "9990001" && b.holdReason === "protected_slot_out_of_scope"
  )
);
expect(
  "paid_not_ready",
  !buttonCatalog.buttons.some(
    (b) => b.advertiserId === "9990001" && b.publishability === PUBLISHABILITY.READY_FOR_REVIEW
  )
);
expect(
  "paid_quarantined",
  buttonCatalog.quarantined.some(
    (q) => q.advertiserId === "9990001" && q.holdReason === "protected_slot_out_of_scope"
  )
);
expect("rules_version", registry.rulesVersion === PHASE3Z_RULES_VERSION);
expect("dedupe_not_empty", (registry.deduplicationDecisions || []).length >= registry.partners.length);
const parity0 = assertJoinedEqualsButtonRecords(registry, buttonCatalog);
expect("joined_eq_buttons", parity0.ok === true, parity0);
expect(
  "joined_count_eq",
  registry.counts.joined === buttonCatalog.counts.buttons,
  { joined: registry.counts.joined, buttons: buttonCatalog.counts.buttons }
);

// JOINED with no category still gets a button record
const noCat = buildPhase3zPartnerRegistry({
  staging: {
    generatedAt: "2026-10-30T00:00:00.000Z",
    websitePid: "101883843",
    advertisers: [
      {
        advertiserId: "7770001",
        advertiserName: "Obscure Widget Co",
        programUrl: "https://obscure-widgets.example/",
        relationshipStatus: "joined",
        accountStatus: "Active",
        primaryCategory: "<parent>Art/Photo/Music</parent><child>Photography</child>",
      },
    ],
    links: [
      {
        linkId: "x1",
        advertiserId: "7770001",
        linkName: "home",
        linkType: "Text Link",
        destination: "https://obscure-widgets.example/en/",
        clickUrl: "https://www.dpbolvw.net/click-101883843-777-777",
        targetedCountries: "CZ",
      },
    ],
  },
  sectionMap: {},
  slotPolicy: { partners: [] },
  catalogSrc: fs.readFileSync(catalogPath, "utf8"),
});
expect("nocat_button_exists", noCat.buttonCatalog.buttons.length === 1, noCat.buttonCatalog.counts);
expect(
  "nocat_category_review",
  noCat.buttonCatalog.buttons[0].holdReason === "CATEGORY_REVIEW_REQUIRED" ||
    noCat.buttonCatalog.buttons[0].buttonRecordStatus ===
      BUTTON_RECORD_STATUS.CATEGORY_REVIEW_REQUIRED,
  noCat.buttonCatalog.buttons[0]
);
expect("nocat_parity", assertJoinedEqualsButtonRecords(noCat.registry, noCat.buttonCatalog).ok);

// LINK_MISSING still creates a button record
const noLink = buildPhase3zPartnerRegistry({
  staging: {
    generatedAt: "2026-10-30T00:00:00.000Z",
    websitePid: "101883843",
    advertisers: [
      {
        advertiserId: "6660001",
        advertiserName: "Linkless Merchant",
        programUrl: "https://linkless.example/",
        relationshipStatus: "joined",
        accountStatus: "Active",
        primaryCategory: "<parent>Beauty</parent><child>Cosmetics</child>",
      },
    ],
    links: [],
  },
  sectionMap: {},
  slotPolicy: { partners: [] },
  catalogSrc: fs.readFileSync(catalogPath, "utf8"),
});
expect("nolink_button", noLink.buttonCatalog.buttons.length === 1);
expect(
  "nolink_status",
  noLink.buttonCatalog.buttons[0].holdReason === "LINK_MISSING" ||
    noLink.buttonCatalog.buttons[0].buttonRecordStatus === BUTTON_RECORD_STATUS.LINK_MISSING,
  noLink.buttonCatalog.buttons[0]
);
expect("nolink_parity", assertJoinedEqualsButtonRecords(noLink.registry, noLink.buttonCatalog).ok);

// SK preferred when CZ missing
const skOnly = selectLanguagePreference([
  { language: "EN", linkId: "e" },
  { language: "SK", linkId: "s" },
]);
expect("sk_over_en", skOnly.selectedLanguage === "SK" && skOnly.languagePrioritySatisfied);

// CID override: Booking.com → ubytování
const bookingCls = classifyPartnerSection({
  advertiserId: "5096493",
  advertiser: {
    advertiserId: "5096493",
    advertiserName: "Booking.com",
    programUrl: "https://www.booking.com/",
    primaryCategory: "<parent>Travel</parent><child>Lodging</child>",
  },
  sectionMap: {},
});
expect("booking_hotels", bookingCls.sectionId === "aff-ubytovani-hotely", bookingCls);

const byrokkoBtn = buttonCatalog.buttons.find((b) => b.advertiserId === "7133039");
const byrokkoPartner = registry.partners.find((p) => p.advertiserId === "7133039");
expect("byrokko_cz_suitability", byrokkoPartner.publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED);
applyUrlVerificationToPartner(byrokkoPartner, byrokkoBtn, {
  status: "VERIFIED_HTTP_OK",
  httpStatus: 200,
  finalHost: "www.byrokko.com",
});
expect(
  "byrokko_ready_after_url",
  byrokkoPartner.publishability === PUBLISHABILITY.READY_FOR_REVIEW,
  byrokkoPartner.publishability
);
// Rebuild matrix after URL verify — must match READY and URL flags
registry.evidenceMatrix = buildEvidenceMatrix(registry.partners);
registry.counts.readyForReview = registry.partners.filter(
  (p) => p.publishability === PUBLISHABILITY.READY_FOR_REVIEW
).length;
buttonCatalog.counts.readyForReview = buttonCatalog.buttons.filter(
  (b) => b.publishability === PUBLISHABILITY.READY_FOR_REVIEW
).length;
const consOk = assertEvidenceConsistency(registry, buttonCatalog);
expect("evidence_consistent_after_url", consOk.ok === true, consOk);
const byrokkoRow = registry.evidenceMatrix.find((r) => r.advertiserId === "7133039");
expect("matrix_url_true", byrokkoRow?.affiliateUrlVerified === true, byrokkoRow);
expect("matrix_ready_true", byrokkoRow?.readyForReview === true, byrokkoRow);

applyUrlVerificationToPartner(byrokkoPartner, byrokkoBtn, {
  status: "HTTP_FORBIDDEN",
  httpStatus: 403,
  clientBlockedPossible: true,
});
// WAF/bot 403 with prior CZ+category+suitable destination → READY via IDENTITY_VERIFIED_WAF
// (not content verification; not treated as a broken destination).
expect(
  "byrokko_403_identity_ready",
  byrokkoPartner.publishability === PUBLISHABILITY.READY_FOR_REVIEW &&
    byrokkoPartner.merchantReviewStatus === "IDENTITY_VERIFIED_WAF" &&
    byrokkoPartner.holdReason == null,
  byrokkoPartner
);
const noCz403 = {
  ...byrokkoPartner,
  partnerId: "cj-test-403",
  advertiserId: "9999403",
  publishability: PUBLISHABILITY.NOT_VERIFIED,
  czMarketEligibilityVerified: null,
  sectionId: null,
  holdReason: "CZ_ELIGIBILITY_UNKNOWN",
  merchantReviewStatus: null,
};
applyUrlVerificationToPartner(noCz403, null, {
  status: "HTTP_FORBIDDEN",
  httpStatus: 403,
  clientBlockedPossible: true,
});
expect(
  "byrokko_403_without_cz_still_pending",
  noCz403.publishability === PUBLISHABILITY.NOT_VERIFIED &&
    noCz403.holdReason === "url_http_403_bot_block_possible",
  noCz403
);

// EN merchant with CZ targeting must not quarantine for language
const enAdv = {
  advertiserId: "8880001",
  advertiserName: "Global Gadgets EN",
  programUrl: "https://www.globalgadgets.example/en/",
  relationshipStatus: "joined",
  accountStatus: "Active",
  primaryCategory: "<parent>Computer &amp; Electronics</parent><child>Consumer Electronics</child>",
};
const enStaging = {
  generatedAt: "2026-10-30T00:00:00.000Z",
  websitePid: "101883843",
  advertisers: [enAdv],
  links: [
    {
      linkId: "en1",
      advertiserId: "8880001",
      linkName: "English home",
      linkType: "Text Link",
      destination: "https://www.globalgadgets.example/en/",
      clickUrl: "https://www.dpbolvw.net/click-101883843-888-888",
      targetedCountries: "CZ",
    },
  ],
};
const enReg = buildPhase3zPartnerRegistry({
  staging: enStaging,
  sectionMap: {},
  slotPolicy: { partners: [] },
  catalogSrc: fs.readFileSync(catalogPath, "utf8"),
});
const enPartner = enReg.registry.partners[0];
expect("en_not_quarantine_lang", enPartner.publishability !== PUBLISHABILITY.QUARANTINED || enPartner.holdReason !== "language_english", enPartner);
expect(
  "en_cz_market_ok",
  enPartner.publishability === PUBLISHABILITY.CZ_SUITABILITY_VERIFIED ||
    enPartner.czMarketEligibilityVerified === true,
  enPartner
);
expect("en_selected_lang", enPartner.selectedLanguage === "EN", enPartner);
applyUrlVerificationToPartner(enPartner, enReg.buttonCatalog.buttons[0], {
  status: "VERIFIED_HTTP_OK",
  httpStatus: 200,
  finalHost: "www.globalgadgets.example",
  finalUrl: "https://www.globalgadgets.example/en/",
});
expect("en_ready_allowed", enPartner.publishability === PUBLISHABILITY.READY_FOR_REVIEW, enPartner);

const gates = buildPhase3zSafetyGates(registry, buttonCatalog);
expect("gates_ok", gates.ok === true, gates);

const stagingDup = {
  ...staging,
  advertisers: [
    {
      advertiserId: "100",
      advertiserName: "Yves Rocher",
      programUrl: "https://www.yves-rocher.cz/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Beauty</parent><child>Cosmetics</child>",
    },
    {
      advertiserId: "101",
      advertiserName: "Yves-rocher.cz",
      programUrl: "https://www.yves-rocher.cz/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Beauty</parent><child>Cosmetics</child>",
    },
  ],
  links: [
    {
      linkId: "a",
      advertiserId: "100",
      linkName: "home",
      linkType: "Text Link",
      destination: "https://www.yves-rocher.cz/",
      clickUrl: "https://www.dpbolvw.net/click-101883843-10-10",
      targetedCountries: "CZ",
    },
    {
      linkId: "b",
      advertiserId: "101",
      linkName: "home",
      linkType: "Text Link",
      destination: "https://www.yves-rocher.cz/",
      clickUrl: "https://www.kqzyfj.com/click-101883843-11-11",
      targetedCountries: "CZ",
    },
  ],
};
const dup = buildPhase3zPartnerRegistry({
  staging: stagingDup,
  sectionMap: {},
  slotPolicy: { partners: [] },
});
expect(
  "no_auto_merge",
  (dup.registry.deduplicationDecisions || []).every((d) => d.action !== "AUTO_MERGE")
);
expect(
  "dup_not_merged_flagged",
  (dup.registry.deduplicationDecisions || []).filter((d) => d.brandKey === "yvesrocher").length === 2
);
expect(
  "yves_auto_category",
  dup.buttonCatalog.buttons.every((b) => b.sectionId === "aff-kosmetika")
);

// --- V7 link intelligence ---
const amp = decodeHtmlEntitiesInUrl(
  "https://arangrant.com/en-us/?cid=ARANCJ&amp;utm_source=cj&amp;utm_medium=Affiliate"
);
expect("amp_decoded", amp.changed && amp.decoded.includes("&utm_source=cj") && !amp.decoded.includes("&amp;"));
expect("amp_no_double", decodeHtmlEntitiesInUrl(amp.decoded).changed === false);

expect(
  "role_newsletter",
  classifyDestinationRole("https://answear.cz/newsletter", "Newsletter") === DESTINATION_ROLE.NEWSLETTER
);
expect(
  "role_checkout",
  classifyDestinationRole(
    "https://checkout.abbyy.com/order/product.php?x=1",
    "Order"
  ) === DESTINATION_ROLE.CHECKOUT
);
expect("role_home", classifyDestinationRole("https://www.dopplershop.cz/", "Home") === DESTINATION_ROLE.HOMEPAGE);

const answearAdv = {
  advertiserId: "5550001",
  advertiserName: "Answear.cz",
  programUrl: "https://answear.cz/",
};
const answearLinks = [
  {
    linkId: "nl",
    advertiserId: "5550001",
    linkName: "Newsletter",
    linkType: "Text Link",
    destination: "https://answear.cz/newsletter",
    clickUrl: "https://www.dpbolvw.net/click-101883843-1-1",
    targetedCountries: "CZ",
  },
  {
    linkId: "home",
    advertiserId: "5550001",
    linkName: "Homepage",
    linkType: "Text Link",
    destination: "https://answear.cz/",
    clickUrl: "https://www.dpbolvw.net/click-101883843-2-2",
    targetedCountries: "CZ",
  },
];
const ansPick = selectPrimaryAffiliateLink(answearLinks, answearAdv);
expect("answear_prefers_home", ansPick.selected?.linkId === "home", ansPick);
expect(
  "answear_rejects_newsletter",
  (ansPick.rejectedAlternatives || []).some((r) => r.linkId === "nl"),
  ansPick.rejectedAlternatives
);
expect(
  "answear_narrative",
  String(ansPick.selectionReasonNarrative || "").length > 40
);

const inelig = evaluateLinkEligibility(
  { clickUrl: "https://evil.example/not-cj", destination: "https://x.cz/", advertiserId: "1" },
  { advertiserId: "1" }
);
expect("hard_fail_non_cj", inelig.status === LINK_ELIGIBILITY.INELIGIBLE);

const hyst = selectPrimaryAffiliateLink(answearLinks, answearAdv, {
  previousLinkId: "home",
  hysteresis: 1000,
});
expect("hysteresis_keeps_home", hyst.selected?.linkId === "home" && hyst.hysteresisKept === true, hyst);

expect("rules_v9_final", PHASE3Z_RULES_VERSION === "phase3z-partner-robot-v9-final");
const tax36 = explainTaxonomy36vs38(36);
expect("tax_36_ok", tax36.ok === true && tax36.productionMainCategoryTiles === 36);
const taxBad = explainTaxonomy36vs38(38);
expect("tax_38_filename_not_sot", taxBad.ok === false);

const allegroProfile = buildAssortmentProfile({
  advertiser: {
    advertiserName: "Allegro.cz Marketplace",
    programUrl: "https://allegro.cz/",
    primaryCategory: "<parent>Clothing/Apparel</parent><child>Malls</child>",
  },
  links: [
    { linkId: "1", linkName: "Electronics deals", destination: "https://allegro.cz/elektronika" },
    { linkId: "2", linkName: "Fashion", destination: "https://allegro.cz/moda" },
    { linkId: "3", linkName: "Toys", destination: "https://allegro.cz/hracky" },
    { linkId: "4", linkName: "Home", destination: "https://allegro.cz/dum" },
  ],
});
expect(
  "allegro_marketplace_or_multi",
  allegroProfile.merchantType === MERCHANT_TYPE.MARKETPLACE ||
    allegroProfile.merchantType === MERCHANT_TYPE.UNIVERSAL_ESHOP ||
    allegroProfile.merchantType === MERCHANT_TYPE.MULTI_ASSORTMENT,
  allegroProfile.merchantType
);
expect(
  "allegro_multi_groups",
  (allegroProfile.significantGroups || []).length >= 2,
  allegroProfile.significantGroups
);

const secKeep = selectPrimarySectionWithAssortment({
  baseSection: { sectionId: "aff-moda", confidence: "high", rule: "map" },
  assortment: allegroProfile,
  previousSectionId: "aff-moda",
  knownSections: new Set(["aff-moda", "aff-elektro", "aff-deti-hracky", "aff-inzerce-bazary"]),
  hysteresis: 100,
});
expect("category_hysteresis", secKeep.sectionId === "aff-moda", secKeep);
expect("category_hysteresis_flag", secKeep.hysteresisKept === true, secKeep);

const bucket = auditLinkCandidateBuckets(
  [
    {
      advertiserId: "1",
      selectedLinkId: "a",
      linkInventory: [
        { linkId: "a", eligibility: "ELIGIBLE" },
        { linkId: "b", eligibility: "ELIGIBLE" },
        { linkId: "c", eligibility: "INELIGIBLE" },
        { linkId: "d", eligibility: "PENDING_EVIDENCE" },
      ],
    },
  ],
  4
);
expect(
  "candidate_invariant",
  bucket.selected === 1 &&
    bucket.eligibleNotSelected === 1 &&
    bucket.ineligible === 1 &&
    bucket.pendingEvidence === 1 &&
    bucket.accounted === 4,
  bucket
);

// One weak product signal must not flip specialist primary section.
const specialist = buildAssortmentProfile({
  advertiser: {
    advertiserName: "Dermacol CZ",
    programUrl: "https://www.dermacol.cz/",
    primaryCategory: "<parent>Beauty</parent><child>Skin Care</child>",
  },
  links: [
    { linkId: "1", linkName: "Home", destination: "https://www.dermacol.cz/" },
    { linkId: "2", linkName: "One toy promo", destination: "https://www.dermacol.cz/hracka-akce" },
  ],
});
expect(
  "specialist_not_flipped_by_one_toy",
  specialist.merchantType === MERCHANT_TYPE.SPECIALIST ||
    (specialist.primaryAssortment && specialist.primaryAssortment.sectionId === "aff-kosmetika"),
  specialist
);

// --- V9 destination + merchant evidence regressions ---
expect(
  "v9_paragon_scope_checkout",
  classifyDestinationType(
    "https://shop.paragon-software.com/order/?scope=checkout&cart=1",
    "Buy"
  ) === DESTINATION_TYPE.CHECKOUT
);
expect(
  "v9_paragon_legacy_role",
  classifyDestinationRole(
    "https://shop.paragon-software.com/order/?scope=checkout&cart=1",
    "Buy"
  ) === DESTINATION_ROLE.CHECKOUT
);
expect(
  "v9_cheapvuelos_affiliate",
  classifyDestinationType(
    "https://www.cheapvuelos.com/cheapflights-affiliates/",
    "Affiliate"
  ) === DESTINATION_TYPE.AFFILIATE_SIGNUP
);
expect(
  "v9_allegro_redirect_home",
  classifyDestinationType(
    "https://allegro.cz/affiliate?redirect_url=" +
      encodeURIComponent("https://allegro.cz/?utm_source=ctr"),
    "Allegro home"
  ) === DESTINATION_TYPE.MERCHANT_HOMEPAGE
);
expect(
  "v9_allegro_redirect_category",
  classifyDestinationType(
    "https://allegro.cz/affiliate?redirect_url=" +
      encodeURIComponent("https://allegro.cz/doporucujeme/elektronika"),
    "Electronics"
  ) === DESTINATION_TYPE.UNKNOWN ||
    classifyDestinationType(
      "https://allegro.cz/affiliate?redirect_url=" +
        encodeURIComponent("https://allegro.cz/doporucujeme/elektronika"),
      "Electronics"
    ) === DESTINATION_TYPE.RELEVANT_CATEGORY
);
expect(
  "v9_abbyy_checkout_host",
  classifyDestinationType("https://checkout.abbyy.com/order/product", "ABBYY") ===
    DESTINATION_TYPE.CHECKOUT
);
expect(
  "v9_unsuitable_checkout",
  isUnsuitableMainDestination(DESTINATION_TYPE.CHECKOUT, "2624620").unsuitable === true
);
expect(
  "v9_unsuitable_affiliate",
  isUnsuitableMainDestination(DESTINATION_TYPE.AFFILIATE_SIGNUP, "7947783").unsuitable === true
);

const tipaOv = applyMerchantEvidenceOverride({
  advertiserId: "4921612",
  assortment: { merchantType: MERCHANT_TYPE.SPECIALIST, primaryAssortment: { sectionId: "aff-moda" } },
  baseSectionId: "aff-moda",
});
expect("v9_tipa_not_moda", tipaOv.applied && tipaOv.sectionId === "aff-elektro", tipaOv);
expect("v9_tipa_forbidden_moda", (tipaOv.evidence?.forbiddenSections || []).includes("aff-moda"));

const allegroOv = applyMerchantEvidenceOverride({
  advertiserId: "6464420",
  assortment: { merchantType: MERCHANT_TYPE.MARKETPLACE },
  baseSectionId: "aff-inzerce-bazary",
});
expect(
  "v9_allegro_not_bazar",
  allegroOv.applied &&
    allegroOv.categoryReviewRequired === true &&
    allegroOv.sectionId == null,
  allegroOv
);

const paragonPick = selectPrimaryAffiliateLink(
  [
    {
      linkId: "chk",
      linkName: "Checkout",
      linkType: "Text Link",
      advertiserId: "4686326",
      clickUrl: "https://www.dpbolvw.net/click-101883843-111",
      destination: "https://shop.paragon-software.com/?scope=checkout&cart=x",
      targetedCountries: "CZ",
    },
    {
      linkId: "home",
      linkName: "Home",
      linkType: "Text Link",
      advertiserId: "4686326",
      clickUrl: "https://www.dpbolvw.net/click-101883843-222",
      destination: "https://www.paragon-software.com/",
      targetedCountries: "CZ",
    },
  ],
  { advertiserId: "4686326", programUrl: "https://www.paragon-software.com/" }
);
expect("v9_paragon_prefers_home", paragonPick.selected?.linkId === "home", paragonPick);
expect("v9_paragon_not_checkout", paragonPick.destinationType !== DESTINATION_TYPE.CHECKOUT, paragonPick);

const cheapPick = selectPrimaryAffiliateLink(
  [
    {
      linkId: "aff",
      linkName: "Affiliates",
      linkType: "Text Link",
      advertiserId: "7947783",
      clickUrl: "https://www.dpbolvw.net/click-101883843-333",
      destination: "https://www.cheapvuelos.com/cheapflights-affiliates/",
      targetedCountries: "CZ",
    },
    {
      linkId: "home",
      linkName: "Home",
      linkType: "Text Link",
      advertiserId: "7947783",
      clickUrl: "https://www.dpbolvw.net/click-101883843-444",
      destination: "https://www.cheapvuelos.com/",
      targetedCountries: "CZ",
    },
  ],
  { advertiserId: "7947783", programUrl: "https://www.cheapvuelos.com/" }
);
expect("v9_cheapvuelos_not_signup", cheapPick.selected?.linkId === "home", cheapPick);

expect("v9_golden_coverage", GOLDEN_DATASET_V9.length >= 6);
expect(
  "v9_golden_tipa",
  GOLDEN_DATASET_V9.some(
    (g) => g.advertiserCid === "4921612" && g.expectedPrimarySectionId === "aff-elektro"
  )
);

if (failures.length) {
  console.error("IU_PHASE3Z_PARTNER_REGISTRY_SELFTEST_FAIL");
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    rulesVersion: PHASE3Z_RULES_VERSION,
    previewButtons: buttonCatalog.counts.buttons,
    quarantined: buttonCatalog.counts.quarantined,
  })
);
