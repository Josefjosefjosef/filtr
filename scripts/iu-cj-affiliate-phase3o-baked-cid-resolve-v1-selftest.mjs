#!/usr/bin/env node
/**
 * Phase 3O baked CID resolve selftest (offline fixtures; DISARMED).
 */
import {
  classifyBakedWithoutCid,
  resolveAdvertiserTrustedUrl,
  planBakedMigrationFromLiveStaging,
  isCjTrackingUrl,
} from "./iu-cj-affiliate-phase3o-baked-cid-resolve-v1.mjs";

const WEBSITE_PID = "101883843";
const u2 = (linkId) => "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + linkId;
const u3 = (adv, linkId) =>
  "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + adv + "-" + linkId;

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const inventory = {
  baked: [
    {
      title: "Alpha Shop",
      sectionId: "aff-moda",
      url: u2("111"),
      advertiserId: null,
      inManaged: false,
    },
    {
      title: "Beta Shop",
      sectionId: "aff-moda",
      url: u3("222", "999"),
      advertiserId: null,
      inManaged: false,
    },
    {
      title: "Ambiguous Twin",
      sectionId: "aff-moda",
      url: u2("333"),
      advertiserId: null,
      inManaged: false,
    },
    {
      title: "Ghost Partner",
      sectionId: "aff-moda",
      url: u2("444"),
      advertiserId: null,
      inManaged: false,
    },
    {
      title: "Paid Stay",
      sectionId: "aff-moda",
      url: "https://example.com/paid",
      advertiserId: null,
      inManaged: false,
      management: "PAID_RESERVED",
    },
  ],
};

const advertisers = [
  { advertiserId: "1001", advertiserName: "Alpha Shop", relationshipStatus: "joined" },
  { advertiserId: "2002", advertiserName: "Beta Shop", relationshipStatus: "joined" },
  { advertiserId: "3003", advertiserName: "Ambiguous Twin", relationshipStatus: "joined" },
  { advertiserId: "3004", advertiserName: "Ambiguous Twin", relationshipStatus: "joined" },
  { advertiserId: "6466592", advertiserName: "Mojelekarna.cz", relationshipStatus: "joined", accountStatus: "Active", programUrl: "https://www.mojelekarna.cz/" },
];

const links = [
  {
    linkId: "555",
    advertiserId: "2002",
    clickUrl: u3("2002", "555"),
  },
];

const classified = classifyBakedWithoutCid({
  inventory,
  advertisers,
  links,
  managedPublic: { partners: [] },
});

const byTitle = Object.fromEntries(classified.classifications.map((c) => [c.title, c]));
expect("alpha_name", byTitle["Alpha Shop"]?.status === "RESOLVED_ACTIVE_JOINED");
expect("alpha_cid", byTitle["Alpha Shop"]?.advertiserId === "1001");
expect("beta_name", byTitle["Beta Shop"]?.status === "RESOLVED_ACTIVE_JOINED");
expect("ambiguous_mr", byTitle["Ambiguous Twin"]?.status === "MANUAL_REVIEW");
expect("ghost_mr", byTitle["Ghost Partner"]?.status === "MANUAL_REVIEW");
expect("paid_mr", byTitle["Paid Stay"]?.status === "MANUAL_REVIEW");
expect("paid_not_trusted", byTitle["Paid Stay"]?.urlTrusted === false);

const mojeMissing = resolveAdvertiserTrustedUrl({
  advertiserId: "6466592",
  advertisers,
  links,
  suggestedSection: "aff-lekarny",
});
expect("moje_missing_url", mojeMissing.status === "MANUAL_REVIEW_MISSING_URL");
expect("moje_no_storefront_sub", mojeMissing.hasTrustedCjUrl === false);
expect("moje_not_ready", mojeMissing.readyForManagedAdd === false);

const mojeReady = resolveAdvertiserTrustedUrl({
  advertiserId: "6466592",
  advertisers,
  links: [
    {
      linkId: "777",
      advertiserId: "6466592",
      clickUrl: u3("6466592", "777"),
    },
  ],
  suggestedSection: "aff-lekarny",
});
expect("moje_ready", mojeReady.status === "READY_FOR_MANAGED_ADD");
expect("moje_url_trusted", isCjTrackingUrl(mojeReady.affiliateUrl));

const planWrap = planBakedMigrationFromLiveStaging({
  inventory,
  managedPublic: { partners: [], liveEnabled: false },
  advertisers,
  links,
});
expect("plan_disarmed", planWrap.liveEnabled === false && planWrap.publishArmed === false);
expect("plan_not_prod_migrated", planWrap.productionMigrated === false);
expect("plan_has_migrate", (planWrap.migrateSlice || []).length >= 1);
expect(
  "plan_skips_ambiguous",
  (planWrap.plan?.decisions || []).some(
    (d) => d.title === "Ambiguous Twin" && d.action === "MANUAL_REVIEW"
  )
);

const out = {
  OK: failures.length === 0,
  schema: "iu-cj-affiliate-phase3o-baked-cid-resolve-v1-selftest",
  liveEnabled: false,
  publishArmed: false,
  failures,
  classifiedCounts: classified.counts,
  mojeMissing: mojeMissing.status,
  mojeReady: mojeReady.status,
};
console.log(JSON.stringify(out, null, 2));
if (failures.length) process.exit(1);
