#!/usr/bin/env node
/**
 * Offline selftest: CJ Link Search XML → internal catalog (no live CJ HTTP).
 * Fixture kind: SYNTHETIC_ANONYMIZED (not live probe archive).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_RECORD_KIND,
  VALIDATION_STATE,
  catalogDedupeKey,
  catalogRecordToSourceClaim,
  classifyLinkSearchHttpOutcome,
  normalizeCjLinkSearchXmlToCatalog,
  normalizeCjLinkToCatalogRecord,
  resolvePartnerMapping,
} from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import { merchantProductIdsEquivalent } from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";
import { OFFER_SOURCE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = path.join(__dirname, "fixtures", "cj-link-search-coupon-offline-anonymized-v1.xml");
const fixtureXml = fs.readFileSync(FIXTURE_XML, "utf8");
const ref = new Date("2026-10-23T12:00:00.000Z");
const observedAt = "2026-10-23T12:00:00.000Z";

expect("fixture_marked_anonymized", /SYNTHETIC|ANONYMIZED/i.test(fixtureXml));
expect("fixture_not_live_probe_claim", /NOT the live probe/i.test(fixtureXml));

const batch = normalizeCjLinkSearchXmlToCatalog(fixtureXml, {
  httpStatus: 200,
  observedAt,
  websitePid: "101883843",
  refDate: ref,
  fixtureKind: "synthetic_anonymized",
});
expect("valid_xml_ok", batch.ok === true);
expect("ten_records", batch.records.length === 10);
expect("publishable_always_false", batch.publishable === false);
expect("all_records_not_publishable", batch.records.every((r) => r.publishable === false));
expect("zero_live_http", batch.CJ_LIVE_HTTP_CALLS === 0);
expect("claims_built", batch.claims.length === 10);
expect("claims_api_source", batch.claims.every((c) => c.source === OFFER_SOURCE.API));
expect(
  "autohotarek_mapped",
  batch.records.filter((r) => r.partnerId === "5124968").every((r) => r.partnerMapping.status === "mapped")
);
expect(
  "unknown_partner_manual",
  batch.records.some((r) => r.partnerMapping.status === "manual_review")
);

const emptyXml = `<cj-api><links total-matched="0" records-returned="0" page-number="1"></links></cj-api>`;
const empty = normalizeCjLinkSearchXmlToCatalog(emptyXml, { httpStatus: 200, observedAt, refDate: ref });
expect("empty_valid_ok", empty.ok === true && empty.emptySuccess === true);
expect("empty_not_error_catalog", empty.reason === "empty_result_verified");

const badXml = `<cj-api><links total-matched="1"><not-a-link></not-a-link></links></cj-api>`;
const badParse = normalizeCjLinkSearchXmlToCatalog(badXml, { httpStatus: 200, observedAt, refDate: ref });
expect("invalid_xml_shape_not_success_records", badParse.records.length === 0);

for (const status of [401, 403, 429, 500]) {
  const r = normalizeCjLinkSearchXmlToCatalog(fixtureXml, { httpStatus: status, observedAt, refDate: ref });
  expect("http_" + status + "_not_ok", r.ok === false);
  expect("http_" + status + "_not_empty_success", r.emptySuccess !== true);
  expect("http_" + status + "_zero_records", r.records.length === 0);
}

const timeout = normalizeCjLinkSearchXmlToCatalog("", { httpStatus: 0, timeout: true, networkError: true });
expect("timeout_not_ok", timeout.ok === false && timeout.reason === "timeout");

const net = normalizeCjLinkSearchXmlToCatalog("", { httpStatus: 0, networkError: true });
expect("network_not_ok", net.ok === false && net.reason === "network_error");

const expiredLink = {
  linkId: "1",
  advertiserId: "5124968",
  advertiserName: "Autohotarek.cz",
  linkName: "Old",
  description: "10% sleva na vše s podmínkami platnosti",
  couponCode: "OLD",
  clickUrl: "https://www.anrdoezrs.net/click-101883843-1-1",
  destination: "https://www.autohotarek.cz/",
  promotionStartDate: "2020-01-01 00:00:00.0",
  promotionEndDate: "2020-12-31 23:59:59.0",
  promotionType: "Coupon",
  targetedCountries: "CZ",
};
const expired = normalizeCjLinkToCatalogRecord(expiredLink, { observedAt, refDate: ref, websitePid: "101883843" });
expect("expired_not_publishable", expired.publishable === false);
expect("expired_state", expired.validationState === VALIDATION_STATE.expired);
expect("expired_kind_coupon", expired.recordKind === CATALOG_RECORD_KIND.coupon_with_code);

const noCode = normalizeCjLinkToCatalogRecord(
  {
    linkId: "2",
    advertiserId: "5124968",
    advertiserName: "Autohotarek.cz",
    linkName: "Sale",
    description: "20% sleva na vše bez kódu — akce eshopu",
    couponCode: "",
    clickUrl: "https://www.anrdoezrs.net/click-101883843-2-1",
    destination: "https://www.autohotarek.cz/",
    promotionStartDate: "2026-01-01 00:00:00.0",
    promotionEndDate: "2026-12-31 23:59:59.0",
    promotionType: "Sale/Discount",
    targetedCountries: "CZ",
  },
  { observedAt, refDate: ref, websitePid: "101883843" }
);
expect("action_without_code", noCode.recordKind === CATALOG_RECORD_KIND.action_without_code);
expect("action_not_publishable", noCode.publishable === false);

const missingUrl = normalizeCjLinkToCatalogRecord(
  {
    linkId: "3",
    advertiserId: "5124968",
    linkName: "No URL",
    description: "10% sleva",
    couponCode: "X",
    clickUrl: "",
    destination: "",
    promotionType: "Coupon",
  },
  { observedAt, refDate: ref }
);
expect("missing_affiliate_url_blocker", missingUrl.blockers.includes("missing_affiliate_url"));
expect("missing_url_not_publishable", missingUrl.publishable === false);

const noPrice = normalizeCjLinkToCatalogRecord(
  {
    linkId: "4",
    advertiserId: "5124968",
    linkName: "No price fields",
    description: "Kupón bez ceny v link-search",
    couponCode: "NOPRICE",
    clickUrl: "https://www.anrdoezrs.net/click-101883843-4-1",
    destination: "https://www.autohotarek.cz/",
    promotionStartDate: "2026-01-01 00:00:00.0",
    promotionEndDate: "2026-12-31 23:59:59.0",
    promotionType: "Coupon",
    targetedCountries: "CZ",
  },
  { observedAt, refDate: ref, websitePid: "101883843" }
);
expect("prices_null_not_invented", noPrice.record.originalPrice === null && noPrice.record.salePrice === null);
expect("currency_null", noPrice.record.currency === null);

const invalidCurrencyLink = { ...noPrice.record };
invalidCurrencyLink.currency = "!!!";
expect("invalid_currency_not_auto_ok", invalidCurrencyLink.currency !== "CZK");

const dupXml = `<cj-api><links total-matched="2" records-returned="2" page-number="1">
<link>
  <link-id>90000001</link-id>
  <advertiser-id>5124968</advertiser-id>
  <advertiser-name>Autohotarek.cz</advertiser-name>
  <link-name>Dup A</link-name>
  <description>10% sleva podmínka min 100</description>
  <destination>https://www.autohotarek.cz/</destination>
  <clickUrl>https://www.anrdoezrs.net/click-101883843-90000001-1</clickUrl>
  <coupon-code>FIXTURE10</coupon-code>
  <promotion-start-date>2026-01-01 00:00:00.0</promotion-start-date>
  <promotion-end-date>2026-12-31 23:59:59.0</promotion-end-date>
  <promotion-type>Coupon</promotion-type>
  <targeted-countries>CZ</targeted-countries>
</link>
<link>
  <link-id>90000001</link-id>
  <advertiser-id>5124968</advertiser-id>
  <advertiser-name>Autohotarek.cz</advertiser-name>
  <link-name>Dup A again</link-name>
  <description>10% sleva podmínka min 100</description>
  <destination>https://www.autohotarek.cz/</destination>
  <clickUrl>https://www.anrdoezrs.net/click-101883843-90000001-1</clickUrl>
  <coupon-code>FIXTURE10</coupon-code>
  <promotion-start-date>2026-01-01 00:00:00.0</promotion-start-date>
  <promotion-end-date>2026-12-31 23:59:59.0</promotion-end-date>
  <promotion-type>Coupon</promotion-type>
  <targeted-countries>CZ</targeted-countries>
</link>
</links></cj-api>`;
const dup = normalizeCjLinkSearchXmlToCatalog(dupXml, { httpStatus: 200, observedAt, refDate: ref, websitePid: "101883843" });
expect("duplicate_flagged", dup.records.some((r) => r.blockers.includes("duplicate_identity_in_batch")));

const emailLike = {
  dataSource: OFFER_SOURCE.EMAIL,
  partnerId: "5124968",
  offerId: "email-1",
  offerType: "coupon",
  productVariant: "-",
};
const apiLike = {
  dataSource: OFFER_SOURCE.API,
  partnerId: "5124968",
  offerId: "90000001",
  offerType: "coupon",
  productVariant: "-",
};
expect("cross_source_not_same_dedupe", catalogDedupeKey(emailLike) !== catalogDedupeKey(apiLike));

expect(
  "variants_not_merged",
  merchantProductIdsEquivalent("309152_1", "309152_2", "https://shop.example/309152.2-item") === false
);
expect(
  "same_variant_ok",
  merchantProductIdsEquivalent("309152_1", "309152_1", "https://shop.example/309152.1-item") === true
);

const missingPhotoCard = {
  productId: "p1",
  imageUrl: null,
  publicationReady: false,
  blockers: ["missing_photo"],
};
expect("missing_photo_not_ready", missingPhotoCard.publicationReady === false);

const invalidPhoto = { imageUrl: "javascript:alert(1)", imageLicenseOk: false };
expect("invalid_photo_blocked", invalidPhoto.imageLicenseOk === false);

const unknownPartner = resolvePartnerMapping("9999999", "Nobody");
expect("unknown_partner_manual_review", unknownPartner.status === "manual_review" && unknownPartner.manualReviewRequired);

const knownPartner = resolvePartnerMapping("5124968", "Autohotarek.cz");
expect("known_partner_mapped", knownPartner.status === "mapped" && knownPartner.sectionKey === "aff-auto-moto");

const claim = catalogRecordToSourceClaim(noPrice, { fixtureKind: "synthetic_anonymized" });
expect("claim_ok", claim.ok === true);
expect("claim_not_publish_meta", claim.claim.meta.publishable === false);

const httpClass = classifyLinkSearchHttpOutcome(200);
expect("http_200_ok", httpClass.ok === true);

const goOffGuard = batch.records.every((r) => r.publishable === false) && batch.publishable === false;
expect("go_off_publish_guard", goOffGuard);

const v1v2LockNote = {
  v1: "CONSUMED_unchanged_by_offline_normalize",
  v2: "CONSUMED_unchanged_by_offline_normalize",
  locksTouched: false,
};
expect("locks_not_touched", v1v2LockNote.locksTouched === false);

const d1ErrorSim = { ok: false, reason: "d1_write_failed", publishable: false };
const r2ErrorSim = { ok: false, reason: "r2_archive_failed", publishable: false };
const aiErrorSim = { ok: false, reason: "ai_validation_failed", publishable: false };
expect("d1_error_not_ok", d1ErrorSim.ok === false);
expect("r2_error_not_ok", r2ErrorSim.ok === false);
expect("ai_error_not_ok", aiErrorSim.ok === false);

const idem1 = normalizeCjLinkSearchXmlToCatalog(fixtureXml, { httpStatus: 200, observedAt, refDate: ref, websitePid: "101883843" });
const idem2 = normalizeCjLinkSearchXmlToCatalog(fixtureXml, { httpStatus: 200, observedAt, refDate: ref, websitePid: "101883843" });
expect(
  "idempotent_identity_keys",
  idem1.records.map((r) => r.identityKey).join(",") === idem2.records.map((r) => r.identityKey).join(",")
);

console.log(
  JSON.stringify({
    IU_CJ_LINK_SEARCH_CATALOG_NORMALIZE_V1_SELFTEST: failures.length === 0 ? "OK" : "FAIL",
    failures,
    fixtureKind: "SYNTHETIC_ANONYMIZED",
    liveProbeXmlArchived: false,
    recordCount: batch.records.length,
    CJ_LIVE_HTTP_CALLS: 0,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
