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
  runOffersLiveSync,
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

console.log(
  JSON.stringify({
    IU_CJ_OFFERS_LIVE_SYNC_V1_SELFTEST: "PASS",
    websitePid: PID,
  })
);
