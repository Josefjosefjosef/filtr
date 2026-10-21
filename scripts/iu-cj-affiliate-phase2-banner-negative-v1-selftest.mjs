#!/usr/bin/env node
/** Offline negative + regression guards for CJ banner creatives (coupons/products untouched). */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AFFILIATE_CONTENT_KIND,
  classifyCjAffiliateContentKind,
  detectProductImageMislabeledAsBanner,
} from "./iu-cj-affiliate-phase2-affiliate-content-kind.mjs";
import {
  BANNER_ASSET_LIMITS,
  rejectActiveScriptOrHtmlCreative,
  sniffImageFormat,
  validateBannerImageBuffer,
  validateBannerImageSourceUrl,
} from "./iu-cj-affiliate-phase2-banner-asset-security-lib.mjs";
import {
  BANNER_WITHDRAWAL_REASON,
  assessBannerWithdrawalDecision,
} from "./iu-cj-affiliate-phase2-banner-lifecycle-lib.mjs";
import {
  buildBannerCreativeRecord,
  validateBannerCreativeForLocalPreview,
} from "./iu-cj-affiliate-phase2-banner-creative-registry-v1.mjs";
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const ref = new Date("2026-10-17T12:00:00.000Z");
const pid = "101883843";
const goodClick =
  "https://www.dpbolvw.net/click-101883843-17365226?url=https%3A%2F%2Fwww.yves-rocher.cz%2F";

function baseLink(over = {}) {
  return {
    linkId: "17365226",
    advertiserId: "5124968",
    advertiserName: "Yves Rocher",
    linkName: "Banner 120x600",
    linkType: "Banner",
    adContent: "https://cdn.example.com/banner.jpg",
    clickUrl: goodClick,
    promotionStartDate: "2026-10-12 22:00:00.0",
    promotionEndDate: "2026-10-18 21:59:00.0",
    relationshipStatus: "joined",
    ...over,
  };
}

const approved = buildBannerCreativeRecord(baseLink(), { refDate: ref, publisherPid: pid, partnerKnown: true });
expect("valid_banner_structural", validateBannerCreativeForLocalPreview(approved).ok === true);
expect("valid_banner_publishable_false", approved.publishable === false);

expect("unknown_partner_withdraw", assessBannerWithdrawalDecision(approved, { partnerKnown: false }).withdraw === true);
expect("coupon_kind", classifyCjAffiliateContentKind({ couponCode: "SAVE10", linkType: "Coupon" }) === "coupon");
expect("product_kind", classifyCjAffiliateContentKind({ shoppingProductRow: true, productId: "SKU1" }) === "product");
expect("banner_kind", classifyCjAffiliateContentKind(baseLink()) === "banner");

expect(
  "product_image_mislabel",
  detectProductImageMislabeledAsBanner({
    linkName: "SKU product image",
    description: "cjsku=123",
    adContent: "https://cdn.example/x.jpg",
  }).mislabeled === true
);

const noPerm = buildBannerCreativeRecord(baseLink(), { refDate: ref, publisherPid: pid });
expect("missing_permission_blocks_publish", noPerm.publicationReady === false);

const foreign = buildBannerCreativeRecord(baseLink({ clickUrl: goodClick.replace(pid, "99999999") }), {
  refDate: ref,
  publisherPid: pid,
});
expect("foreign_pid_click", foreign.affiliateClickVerified === false);

const scriptCreative = buildBannerCreativeRecord(
  baseLink({ adContent: "<script>alert(1)</script>" }),
  { refDate: ref, publisherPid: pid }
);
expect("js_creative_blocked", scriptCreative.imageSourceVerified === false);

const htmlUrl = buildBannerCreativeRecord(
  baseLink({ adContent: "https://cdn.example/evil.html" }),
  { refDate: ref, publisherPid: pid }
);
expect("html_url_blocked", htmlUrl.blockers.some((b) => String(b).includes("html")));

const expired = buildBannerCreativeRecord(
  baseLink({ promotionEndDate: "2020-01-01 00:00:00.0" }),
  { refDate: ref, publisherPid: pid }
);
expect("expired_withdraw", expired.withdrawal.reasons.includes(BANNER_WITHDRAWAL_REASON.campaign_expired));

const future = buildBannerCreativeRecord(
  baseLink({ promotionStartDate: "2030-01-01 00:00:00.0", promotionEndDate: "2030-12-31 23:59:59.0" }),
  { refDate: ref, publisherPid: pid }
);
expect("future_campaign", future.validityState === "documented_not_yet_active");

const dupA = buildBannerCreativeRecord(baseLink(), { refDate: ref, publisherPid: pid });
const dupB = buildBannerCreativeRecord(baseLink(), { refDate: ref, publisherPid: pid });
expect("duplicate_fingerprint", dupA.creativeFingerprint === dupB.creativeFingerprint);

const big = Buffer.alloc(BANNER_ASSET_LIMITS.maxBytes + 1, 0xff);
expect("oversize_image", validateBannerImageBuffer(big).ok === false);

const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
expect("png_magic_ok", validateBannerImageBuffer(pngHeader).ok === true);
expect("sniff_png", sniffImageFormat(pngHeader) === "png");

const ssrf = await validateBannerImageSourceUrl("http://127.0.0.1/b.jpg", { allowedHostSuffixes: ["example.com"] });
expect("ssrf_private_image", ssrf.ok === false);

expect("script_gate", rejectActiveScriptOrHtmlCreative("javascript:alert(1)").ok === false);

const revoked = assessBannerWithdrawalDecision(approved, { permissionRevoked: true });
expect("permission_revoked", revoked.reasons.includes(BANNER_WITHDRAWAL_REASON.permission_revoked));

const denial = assessBannerWithdrawalDecision(approved, { supersedingDenial: true });
expect("denial_supersedes", denial.reasons.includes(BANNER_WITHDRAWAL_REASON.contract_denial_supersedes));

const reg = spawnSync(process.execPath, [path.join(scriptsDir, "iu-cj-affiliate-phase2-offers-dataflow-offline-selftest.mjs")], {
  encoding: "utf8",
  env: { ...process.env, PRODUCTION_SIGNING_ENABLED: "false" },
});
expect("coupons_products_dataflow_regression", reg.status === 0);

console.log(
  JSON.stringify({
    IU_CJ_BANNER_NEGATIVE_V1_SELFTEST: failures.length ? "FAIL" : "OK",
    fail: failures.length,
    failures,
  })
);
process.exit(failures.length ? 1 : 0);
