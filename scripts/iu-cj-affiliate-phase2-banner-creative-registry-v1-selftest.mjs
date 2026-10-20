#!/usr/bin/env node
import {
  BANNER_CREATIVE_SCHEMA,
  buildBannerCreativeRecord,
  isHttpsAffiliateUrl,
  parseBannerDimensions,
  validateBannerCreativeForLocalPreview,
} from "./iu-cj-affiliate-phase2-banner-creative-registry-v1.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

expect("dims_parse", parseBannerDimensions("Leaderboard 728x90").width === 728);
expect("https_ok", isHttpsAffiliateUrl("https://www.example.com/x"));
expect("private_blocked", !isHttpsAffiliateUrl("http://127.0.0.1/x"));

const ref = new Date("2026-10-17T12:00:00.000Z");
const sample = {
  linkId: "17365226",
  advertiserId: "5124968",
  advertiserName: "Yves Rocher",
  linkName: "Banner 120x600",
  linkType: "Banner",
  adContent: "https://cdn.example.com/banner.jpg",
  clickUrl: "https://track.example.com/click",
  promotionStartDate: "2026-10-12 22:00:00.0",
  promotionEndDate: "2026-10-18 21:59:00.0",
  relationshipStatus: "joined",
};

const rec = buildBannerCreativeRecord(sample, { refDate: ref, publisherPid: "101883843" });
expect("schema", rec.schemaVersion === BANNER_CREATIVE_SCHEMA);
expect("role_classified", rec.bannerRole !== "U_unknown_unclassified_banner");
const val = validateBannerCreativeForLocalPreview(rec);
expect("local_preview_structural_ok", val.ok === true);

const bad = buildBannerCreativeRecord(
  { ...sample, clickUrl: "http://127.0.0.1/evil", adContent: "http://127.0.0.1/img" },
  { refDate: ref }
);
expect("bad_urls_blocked", validateBannerCreativeForLocalPreview(bad).ok === false);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_BANNER_CREATIVE_REGISTRY_V1_SELFTEST: ok ? "OK" : "FAIL",
    fail: failures.length,
    failures,
  })
);
process.exit(ok ? 0 : 1);
