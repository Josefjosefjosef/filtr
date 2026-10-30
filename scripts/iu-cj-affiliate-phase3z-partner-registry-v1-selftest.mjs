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
expect("gates_have_12", buildPhase3zSafetyGates({ counts: { joined: 1, partners: 1 }, partners: [], deduplicationDecisions: [], taxonomy: { taxonomyCount: 36 }, liveEnabled: false, publicButtonSwapArmed: false }, { counts: { buttons: 1, quarantined: 0 }, buttons: [], publicButtonSwapArmed: false }).gates?.length === 12);
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
  "abbyy_quarantine",
  buttonCatalog.quarantined.some((q) => q.advertiserId === "2624620")
);
expect(
  "paid_not_preview",
  !buttonCatalog.buttons.some((b) => b.advertiserId === "9990001")
);
expect(
  "paid_quarantined",
  buttonCatalog.quarantined.some(
    (q) => q.advertiserId === "9990001" && q.holdReason === "protected_slot_out_of_scope"
  )
);
expect("rules_version", registry.rulesVersion === PHASE3Z_RULES_VERSION);
expect("dedupe_not_empty", (registry.deduplicationDecisions || []).length >= registry.partners.length);

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
applyUrlVerificationToPartner(byrokkoPartner, byrokkoBtn, {
  status: "HTTP_FORBIDDEN",
  httpStatus: 403,
  clientBlockedPossible: true,
});
expect(
  "byrokko_403_not_ready",
  byrokkoPartner.publishability === PUBLISHABILITY.NOT_VERIFIED &&
    byrokkoPartner.holdReason === "url_http_403_bot_block_possible"
);

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
