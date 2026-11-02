#!/usr/bin/env node
/**
 * Phase 3V offers live-sync selftest (offline fixtures; no live CJ HTTP).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOffersPublicFromStaging,
  buildSectionByAdvertiser,
  sectionIdsFromMainButtons,
  resolveOfferSectionKeys,
  runOffersLiveSync,
  sampleProductsForManagedPartners,
} from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const PID = "101883843";
const goodUrl = `https://www.jdoqocy.com/click-${PID}-15735649`;

function expect(name, cond) {
  assert.equal(cond, true, name);
}

{
  const sectionByAdv = buildSectionByAdvertiser({
    managedPublic: {
      partners: [{ advertiserId: "100", sectionId: "aff-moda", active: true }],
    },
    policy: { partners: [{ advertiserId: "200", sectionId: "aff-boty" }] },
    sectionMap: { "300": "aff-jidlo", _note: "ignore" },
  });
  expect("map_managed", sectionByAdv["100"] === "aff-moda");
  expect("map_policy", sectionByAdv["200"] === "aff-boty");
  expect("map_section", sectionByAdv["300"] === "aff-jidlo");
}

// V28: main-button partners missing from managed-public must still map for offers.
{
  const fromMain = sectionIdsFromMainButtons({
    buttons: [
      { advertiserId: "6892836", sectionId: "aff-boty", title: "Skinners Europe" },
      { advertiserId: "7917498", sectionId: "aff-sport-outdoor", title: "E-armyshop.cz" },
    ],
  });
  expect("main_buttons_skinners", fromMain["6892836"] === "aff-boty");
  expect("main_buttons_armyshop", fromMain["7917498"] === "aff-sport-outdoor");

  const withoutMain = buildSectionByAdvertiser({
    managedPublic: { partners: [{ advertiserId: "100", sectionId: "aff-moda" }] },
    policy: { partners: [] },
    sectionMap: {},
  });
  expect("without_main_no_skinners", withoutMain["6892836"] == null);

  const withMain = buildSectionByAdvertiser({
    managedPublic: { partners: [{ advertiserId: "100", sectionId: "aff-moda" }] },
    policy: { partners: [] },
    sectionMap: {},
    mainButtons: {
      buttons: [{ advertiserId: "6892836", sectionId: "aff-boty", title: "Skinners Europe" }],
    },
  });
  expect("with_main_skinners_mapped", withMain["6892836"] === "aff-boty");
  expect("with_main_keeps_managed", withMain["100"] === "aff-moda");

  // Main buttons must not override an existing managed mapping.
  const noOverride = buildSectionByAdvertiser({
    managedPublic: { partners: [{ advertiserId: "6892836", sectionId: "aff-sport-outdoor" }] },
    policy: { partners: [] },
    sectionMap: {},
    mainButtons: {
      buttons: [{ advertiserId: "6892836", sectionId: "aff-boty" }],
    },
  });
  expect("main_does_not_override_managed", noOverride["6892836"] === "aff-sport-outdoor");

  const stagingSkinners = {
    apiOutage: false,
    advertisers: [{ advertiserId: "6892836", relationshipStatus: "joined" }],
    links: [
      {
        linkId: "16991292",
        advertiserId: "6892836",
        advertiserName: "Skinners Europe",
        linkName: "CZ: 15% SLEVA NA VŠE!",
        couponCode: "CJ15",
        clickUrl: goodUrl,
        description: "15% sleva",
        promotionType: "Coupon",
        targetedCountries: "CZ",
        promotionStartDate: "2026-01-01 00:00:00.0",
        promotionEndDate: "2027-12-31 23:59:00.0",
      },
    ],
  };
  const lost = buildOffersPublicFromStaging({
    staging: stagingSkinners,
    sectionByAdv: withoutMain,
    products: [],
    refDate: new Date("2026-11-02T12:00:00Z"),
  });
  expect("skinners_lost_without_main_map", (lost.doc?.stats?.coupons || 0) === 0);

  const recovered = buildOffersPublicFromStaging({
    staging: stagingSkinners,
    sectionByAdv: withMain,
    products: [],
    refDate: new Date("2026-11-02T12:00:00Z"),
  });
  expect("skinners_recovered_with_main_map", (recovered.doc?.stats?.coupons || 0) >= 1);
}

{
  const staging = {
    apiOutage: false,
    advertisers: [{ advertiserId: "100", relationshipStatus: "joined" }],
    links: [
      {
        linkId: "9001",
        advertiserId: "100",
        advertiserName: "TestCo",
        linkName: "Save 10%",
        couponCode: "SAVE10",
        clickUrl: goodUrl,
        description: "Od 500 Kč",
        promotionType: "coupon",
        promotionStartDate: "2026-01-01 00:00:00.0",
        promotionEndDate: "2027-12-31 23:59:00.0",
      },
      {
        linkId: "9002",
        advertiserId: "100",
        advertiserName: "TestCo",
        linkName: "Sale no code",
        clickUrl: goodUrl,
        description: "Akce bez kódu",
        promotionType: "sale/discount",
        promotionStartDate: "2026-01-01 00:00:00.0",
        promotionEndDate: "2027-12-31 23:59:00.0",
      },
      {
        linkId: "9003",
        advertiserId: "999",
        advertiserName: "Unmapped",
        couponCode: "X",
        clickUrl: goodUrl,
        promotionType: "coupon",
        promotionEndDate: "2027-12-31 23:59:00.0",
      },
    ],
  };
  const built = buildOffersPublicFromStaging({
    staging,
    sectionByAdv: { "100": "aff-moda" },
    products: [
      {
        advertiserId: "100",
        productId: "p1",
        title: "Prod",
        imageUrl: "https://cdn.example.com/p.jpg",
        currentPrice: 199,
        currency: "CZK",
        affiliateUrl: goodUrl,
        publicationReady: true,
      },
    ],
    refDate: new Date("2026-10-28T12:00:00Z"),
  });
  expect("build_ok", built.ok === true);
  expect("coupon_ready", built.counts.coupons >= 1);
  expect("action_ready", built.counts.actions >= 1);
  expect("product_ready", built.counts.products === 1);
  expect("live_false", built.doc.liveEnabled === false);
  const coupon = built.doc.sections[0].coupons[0];
  expect("coupon_code", coupon.couponCode === "SAVE10");
  expect("coupon_ready_flag", coupon.publicationReady === true);
  expect("fixture_false", coupon.fixtureOnly === false);
}

{
  const outage = buildOffersPublicFromStaging({
    staging: { apiOutage: true, links: [{ linkId: "1" }] },
    sectionByAdv: {},
  });
  expect("outage_blocks", outage.ok === false && outage.reason === "API_OUTAGE_KEEP_LKG");
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-offers-live-"));
  const dataDir = path.join(tmp, "projects", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
    JSON.stringify({
      apiOutage: false,
      advertisers: [],
      links: [
        {
          linkId: "9100",
          advertiserId: "100",
          advertiserName: "Keep",
          couponCode: "KEEP",
          clickUrl: goodUrl,
          promotionType: "coupon",
          promotionEndDate: "2027-12-31 23:59:00.0",
        },
      ],
    })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"),
    JSON.stringify({
      partners: [{ advertiserId: "100", sectionId: "aff-moda", active: true, title: "Keep" }],
    })
  );
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-slot-policy-v1.json"),
    JSON.stringify({ partners: [] })
  );
  fs.writeFileSync(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), JSON.stringify({}));
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json"),
    JSON.stringify({
      schema: "iu-affiliate-cj-offers-public-v1",
      liveEnabled: false,
      sections: [
        {
          sectionKey: "aff-moda",
          coupons: [{ offerId: "old", couponCode: "OLD", publicationReady: true }],
          actions: [],
          products: [],
        },
      ],
    })
  );

  const dry = await runOffersLiveSync({
    dataDir,
    env: {},
    sampleProducts: false,
  });
  expect("dry_ok", dry.ok === true && dry.wrote === false);
  expect("dry_counts", dry.counts.coupons >= 1);

  const armedLive = await runOffersLiveSync({
    dataDir,
    env: { IU_CJ_OFFERS_PROMOTE_ARMED: "1", IU_CJ_OFFERS_LIVE_ENABLED: "1" },
    sampleProducts: false,
  });
  expect("armed_write", armedLive.ok === true && armedLive.wrote === true);
  expect("armed_live", armedLive.liveEnabled === true);
  const written = JSON.parse(
    fs.readFileSync(path.join(dataDir, "iu-affiliate-cj-offers-public-v1.json"), "utf8")
  );
  expect("written_live", written.liveEnabled === true);
  expect("written_ready", (written.sections[0].coupons || [])[0].publicationReady === true);
  expect(
    "lkg_exists",
    fs.existsSync(path.join(dataDir, "iu-affiliate-cj-offers-public-lkg-v1.json"))
  );

  // Empty regression: wipe staging links but keep prior public → refuse
  fs.writeFileSync(
    path.join(dataDir, "iu-affiliate-cj-staging-v1.json"),
    JSON.stringify({ apiOutage: false, advertisers: [], links: [] })
  );
  const refused = await runOffersLiveSync({
    dataDir,
    env: { IU_CJ_OFFERS_PROMOTE_ARMED: "1", IU_CJ_OFFERS_LIVE_ENABLED: "1" },
    sampleProducts: false,
  });
  expect(
    "empty_refused",
    refused.ok === false &&
      (refused.reason === "STAGING_EMPTY" ||
        refused.reason === "EMPTY_OFFERS_REGRESSION_KEEP_LKG" ||
        refused.reason === "ZERO_PUBLICATION_READY_REFUSED")
  );
}

{
  const keys = resolveOfferSectionKeys({
    primarySection: "aff-sport-outdoor",
    text: "Sleva na běžecké boty a tenisky",
  });
  expect("cross_primary", keys[0] === "aff-sport-outdoor");
  expect("cross_boty", keys.includes("aff-boty"));
}

{
  /* "Skin Food" must not falsely map to aff-jidlo. */
  const keys = resolveOfferSectionKeys({
    primarySection: "aff-kosmetika",
    text: "Weleda Skin Food s 20% slevou",
  });
  expect("no_false_jidlo_from_skin_food", !keys.includes("aff-jidlo"));
  expect("kosmetika_primary", keys.includes("aff-kosmetika"));
}

{
  /* Partner button stays in A; coupon evidence maps also to B; product to C. */
  const staging = {
    apiOutage: false,
    advertisers: [{ advertiserId: "555", relationshipStatus: "joined" }],
    links: [
      {
        linkId: "cross-c1",
        advertiserId: "555",
        advertiserName: "Decathlon",
        linkName: "Kupón pouze na boty a tenisky",
        couponCode: "BOTY15",
        clickUrl: goodUrl,
        description: "Platí na obuv",
        promotionType: "coupon",
        promotionEndDate: "2027-12-31 23:59:00.0",
      },
    ],
  };
  const built = buildOffersPublicFromStaging({
    staging,
    sectionByAdv: { "555": "aff-sport-outdoor" },
    products: [
      {
        advertiserId: "555",
        productId: "jacket-1",
        title: "Sportovní oblečení bunda running jacket",
        imageUrl: "https://cdn.example.com/j.jpg",
        currentPrice: 1299,
        currency: "CZK",
        affiliateUrl: goodUrl,
        publicationReady: true,
      },
    ],
    refDate: new Date("2026-10-28T12:00:00Z"),
  });
  expect("cross_build_ok", built.ok === true);
  const byKey = Object.fromEntries((built.doc.sections || []).map((s) => [s.sectionKey, s]));
  expect("partner_primary_section_present", Boolean(byKey["aff-sport-outdoor"]));
  expect("coupon_in_boty", (byKey["aff-boty"]?.coupons || []).some((c) => c.couponCode === "BOTY15"));
  expect(
    "coupon_also_primary",
    (byKey["aff-sport-outdoor"]?.coupons || []).some((c) => c.couponCode === "BOTY15")
  );
  expect(
    "product_in_sport_wear",
    (byKey["aff-sportovni-obleceni"]?.products || []).some((p) => p.productId === "jacket-1")
  );
  expect("no_dup_in_boty", (byKey["aff-boty"]?.coupons || []).filter((c) => c.couponCode === "BOTY15").length === 1);
  expect("cross_stat", (built.doc.stats?.crossCategoryOfferPlacements || 0) >= 1);
}

{
  /* ENDED partner: no offers kept when advertiser absent from section map and staging. */
  const ended = buildOffersPublicFromStaging({
    staging: {
      apiOutage: false,
      advertisers: [],
      links: [
        {
          linkId: "ended-1",
          advertiserId: "777",
          advertiserName: "Gone",
          couponCode: "GONE",
          clickUrl: goodUrl,
          promotionType: "coupon",
          promotionEndDate: "2027-12-31 23:59:00.0",
        },
      ],
    },
    sectionByAdv: {},
    refDate: new Date("2026-10-28T12:00:00Z"),
  });
  expect("ended_unmapped_rejected", ended.ok === true);
  expect("ended_no_sections", (ended.doc.sections || []).length === 0);
}

{
  /* Phase 3Y: reject zero-price products; reject future / non-CZ market offers. */
  const gated = buildOffersPublicFromStaging({
    staging: {
      apiOutage: false,
      advertisers: [{ advertiserId: "100", relationshipStatus: "joined" }],
      links: [
        {
          linkId: "fut-1",
          advertiserId: "100",
          advertiserName: "TestCo",
          couponCode: "SOON",
          clickUrl: goodUrl,
          description: "Od 500 Kč",
          promotionType: "coupon",
          promotionStartDate: "2026-11-05 23:00:00.0",
          promotionEndDate: "2026-11-06 23:00:00.0",
          targetedCountries: "CZ",
        },
        {
          linkId: "hu-1",
          advertiserId: "100",
          advertiserName: "TestCo",
          couponCode: "HU15",
          clickUrl: goodUrl,
          description: "Od 500 Kč",
          promotionType: "coupon",
          promotionStartDate: "2026-01-01 00:00:00.0",
          promotionEndDate: "2027-12-31 23:59:00.0",
          targetedCountries: "HU",
        },
        {
          linkId: "cz-1",
          advertiserId: "100",
          advertiserName: "TestCo",
          couponCode: "CZ15",
          clickUrl: goodUrl,
          description: "Od 500 Kč",
          promotionType: "coupon",
          promotionStartDate: "2026-01-01 00:00:00.0",
          promotionEndDate: "2027-12-31 23:59:00.0",
          targetedCountries: "CZ",
        },
      ],
    },
    sectionByAdv: { "100": "aff-moda" },
    products: [
      {
        advertiserId: "100",
        productId: "166769",
        title: "Zero price",
        imageUrl: "https://cdn.example.com/z.jpg",
        currentPrice: "0.00",
        currency: "CZK",
        affiliateUrl: goodUrl,
        publicationReady: true,
      },
      {
        advertiserId: "100",
        productId: "ok-1",
        title: "Ok price",
        imageUrl: "https://cdn.example.com/ok.jpg",
        currentPrice: "199.00",
        currency: "CZK",
        affiliateUrl: goodUrl,
        publicationReady: true,
      },
    ],
    refDate: new Date("2026-10-29T08:00:00Z"),
  });
  expect("gate_build_ok", gated.ok === true);
  expect("future_rejected", (gated.rejectReasons?.time_window || 0) + (gated.rejectReasons?.future_start || 0) >= 1);
  expect("foreign_rejected", (gated.rejectReasons?.market_not_targeting_cz || 0) >= 1);
  expect("cz_coupon_kept", gated.counts.coupons === 1);
  expect("zero_price_rejected", gated.counts.products === 1);
  const prod = (gated.doc.sections || []).flatMap((s) => s.products || []);
  expect("zero_not_present", !prod.some((p) => String(p.productId) === "166769"));
  expect("ok_price_present", prod.some((p) => String(p.productId) === "ok-1"));
}

{
  // V29: partnerLimit 0 = all active partners; perPartner defaults toward API max 10.
  const partners = [];
  for (let i = 1; i <= 90; i++) partners.push({ advertiserId: String(1000 + i), active: true, title: "P" + i });
  const noCred = await sampleProductsForManagedPartners({
    partners,
    partnerLimit: 0,
    perPartner: 10,
    env: {},
  });
  expect("product_fetch_no_cred_skip", noCred.meta.skippedNoCredentials === true);
  expect("product_fetch_no_artificial_80", noCred.meta.partnerCapApplied === false);
  expect("product_fetch_per_partner_api_max", noCred.meta.perPartner === 10);
  expect("product_fetch_active_all", noCred.meta.activePartners === 90);

  const capped = await sampleProductsForManagedPartners({
    partners,
    partnerLimit: 80,
    perPartner: 3,
    env: {},
  });
  expect("product_fetch_cap_flag", capped.meta.partnerCapApplied === true);
  expect("product_fetch_cap_value", capped.meta.partnerLimit === 80);
}

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_LIVE_SYNC_V1_SELFTEST: "PASS",
    websitePid: PID,
  })
);
