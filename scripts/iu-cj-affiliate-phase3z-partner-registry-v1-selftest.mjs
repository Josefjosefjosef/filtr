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
  PHASE3Z_RULES_VERSION,
} from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { normalizePartnerBrand } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

expect(
  "cz_name_strips_region",
  proposeCzechDisplayName("Dermacol CZ/SK/PL/RO", "https://www.dermacol.cz/") === "Dermacol" ||
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
      advertiserId: "2624620",
      advertiserName: "ABBYY Europe Affiliate Program",
      programUrl: "https://www.abbyy.com/",
      relationshipStatus: "joined",
      accountStatus: "Active",
      primaryCategory: "<parent>Computers &amp; Software</parent><child>Software</child>",
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
  sectionMap: { "6065245": "aff-zvirata" },
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
expect("doppler_preview", buttonCatalog.buttons.some((b) => b.advertiserId === "6065245"));
expect(
  "abbyy_quarantine_or_unmapped",
  buttonCatalog.quarantined.some((q) => q.advertiserId === "2624620") ||
    !buttonCatalog.buttons.some((b) => b.advertiserId === "2624620")
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

const gates = buildPhase3zSafetyGates(registry, buttonCatalog);
expect("gates_ok", gates.ok === true, gates);

// Dedup suspicion without auto-merge
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
  sectionMap: { "100": "aff-kosmetika", "101": "aff-kosmetika" },
  slotPolicy: { partners: [] },
});
expect(
  "no_auto_merge",
  (dup.registry.deduplicationDecisions || []).every((d) => d.action !== "AUTO_MERGE")
);
expect(
  "dup_flagged",
  (dup.registry.deduplicationDecisions || []).some((d) => d.brandKey === "yvesrocher")
);

if (failures.length) {
  console.error("IU_PHASE3Z_PARTNER_REGISTRY_SELFTEST_FAIL");
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    previewButtons: buttonCatalog.counts.buttons,
    quarantined: buttonCatalog.counts.quarantined,
  })
);
