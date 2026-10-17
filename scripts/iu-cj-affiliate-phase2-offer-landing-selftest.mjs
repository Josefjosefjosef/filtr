#!/usr/bin/env node
/** Offline security/regression for landing classification (no network). */
import {
  assertFetchAllowed,
  assessLandingIdentity,
  assessMainProductConsensus,
  assessVariantEquivalence,
  classifyLandingTargetType,
  isPrivateOrBlockedHost,
  merchantProductIdsEquivalent,
  parsePrimaryDataLayerProduct,
  skuMentionedOnlyInRecommendationZone,
} from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";
import { assessPublicationGates } from "./iu-cj-affiliate-phase2-publication-gates.mjs";

const failures = [];
function expect(name, cond) {
  if (!cond) failures.push(name);
}

const productUrl = "https://www.autohotarek.cz/gumove-autokoberce-mg5-ev-2022-petex";
const productName = "Gumové autokoberce MG 5 EV 2022-";
const canonical =
  '<link rel="canonical" href="https://www.autohotarek.cz/gumove-autokoberce-mg5-ev-2022-petex">';
const primaryBlock =
  "dataLayer=[{ecomm_pagetype:'product', ecomm_prodid:'IDN'+32844, product_name:'Gumové autokoberce MG 5 EV 2022-'}]";

function passHtml(extra = "") {
  return (
    "<html><head><title>" +
    productName +
    "</title>" +
    canonical +
    "</head><body><h1>" +
    productName +
    "</h1><script>" +
    primaryBlock +
    ";</script>" +
    extra +
    "</body></html>"
  );
}

expect("localhost_blocked", isPrivateOrBlockedHost("localhost"));
expect("ipv6_loopback_blocked", isPrivateOrBlockedHost("::1"));
expect("ipv4_mapped_loopback_blocked", isPrivateOrBlockedHost("::ffff:127.0.0.1"));

expect(
  "variant_309152_1_vs_2_not_equivalent",
  merchantProductIdsEquivalent("309152_1", "309152_2", "https://shop.example/309152.2-item") === false
);
expect(
  "variant_id_match_but_url_variant_2_rejects_feed_1",
  merchantProductIdsEquivalent(
    "309152_1",
    "309152_1",
    "https://www.asko-nabytek.cz/309152.2-stropni-led-osvetleni-beatrix-49-cm-kov-drevo"
  ) === false
);
expect(
  "variant_equivalence_negative_assess",
  assessVariantEquivalence("309152_1", "309152_2", "https://shop.example/309152.2-item").equivalent === false
);

const idProduct = assessLandingIdentity({
  product: { productId: "IDN32844", name: productName },
  productLandingUrl: productUrl,
  landingFetch: { fetchStatus: "ok", snippet: passHtml() },
});
expect("authoritative_consensus_pass", idProduct.status === "pass");

const recOnly = assessLandingIdentity({
  product: { productId: "IDN32844", name: productName },
  productLandingUrl: productUrl,
  landingFetch: {
    fetchStatus: "ok",
    snippet:
      "<html><body><script>dataLayer=[{ecomm_pagetype:'product', ecomm_prodid:'IDN'+99999}];</script>" +
      '<div class="recommended-products">idn32844 IDN32844</div></body></html>',
  },
});
expect("sku_only_in_recommendations_fail", recOnly.status !== "pass");

const datalayerSkuWrongMain = assessLandingIdentity({
  product: { productId: "IDN32844", name: productName },
  productLandingUrl: productUrl,
  landingFetch: {
    fetchStatus: "ok",
    snippet:
      "<html><head><title>Úplně jiný hlavní produkt XYZ</title>" +
      canonical +
      "</head><body><h1>Úplně jiný hlavní produkt XYZ</h1><script>" +
      primaryBlock +
      ";</script></body></html>",
  },
});
expect("datalayer_sku_but_wrong_visible_main_fail", datalayerSkuWrongMain.status !== "pass");

const variantMismatch = assessLandingIdentity({
  product: { productId: "IDN32844", name: productName },
  productLandingUrl: productUrl,
  landingFetch: {
    fetchStatus: "ok",
    snippet: passHtml().replace(productName, "Gumové autokoberce MG 4 EV 2022-"),
  },
});
expect("variant_mismatch_fail", variantMismatch.status !== "pass");

const jsonLdOnly = assessLandingIdentity({
  product: { productId: "SKU99", name: "Test Product Alpha Beta" },
  productLandingUrl: "https://shop.example/item-alpha-beta",
  landingFetch: {
    fetchStatus: "ok",
    snippet:
      '<html><head><title>Test Product Alpha Beta</title><link rel="canonical" href="https://shop.example/item-alpha-beta"></head>' +
      '<body><h1>Test Product Alpha Beta</h1><script type="application/ld+json">{"@type":"Product","sku":"SKU99","name":"Test Product Alpha Beta"}</script></body></html>',
  },
});
expect("jsonld_consensus_pass_without_datalayer", jsonLdOnly.status === "pass");

expect("parse_primary", parsePrimaryDataLayerProduct(primaryBlock)?.productId === "IDN32844");

const gatesLandFail = assessPublicationGates({
  productEval: {
    eligibility: "eligible",
    affiliateLinkAssessment: { affiliateLinkStatus: "valid_cj_click_format" },
  },
  couponEval: { czAudiencePublishBlocked: false },
  landingIdentity: { status: "unknown", reason: "x" },
  cardDisplayMode: "text_only",
  validity: { promotionEndDate: "2030-01-01 00:00:00.0" },
  refDate: new Date("2026-01-01"),
});
expect("land_unknown_blocks_ready", gatesLandFail.publicationReady === false);
expect("validator_blocks_unknown_landing", gatesLandFail.blockers.some((b) => b.startsWith("validator:")));

const gate = await assertFetchAllowed("http://127.0.0.1/", { allowedHostSuffixes: ["autohotarek.cz"] });
expect("ssrf_127_blocked", gate.ok === false);

const consensusDirect = assessMainProductConsensus({
  html: passHtml(),
  productUrl,
  expectedProduct: { productId: "IDN32844", name: productName },
});
expect("consensus_helper_pass", consensusDirect.status === "pass");

const askoVariant = assessLandingIdentity({
  product: { productId: "309152_1", name: "Stropní LED osvětlení Beatrix 49 cm, kov/dřevo" },
  productLandingUrl: "https://www.asko-nabytek.cz/309152.1-stropni-led-osvetleni-beatrix-49-cm-kov-drevo",
  landingFetch: {
    fetchStatus: "ok",
    snippet:
      "<html><head><title>Stropní LED osvětlení Beatrix 49 cm, kov/dřevo | ASKO</title>" +
      '<link rel="canonical" href="https://www.asko-nabytek.cz/309152.1-stropni-led-osvetleni-beatrix-49-cm-kov-drevo"></head>' +
      "<body><script>dataLayer=[{ecomm_pagetype:'product', ecomm_prodid:'IDN'+309152}];</script></body></html>",
  },
});
expect("feed_variant_suffix_equivalent_to_page_id", askoVariant.status === "pass");

const askoWrongVariant = assessLandingIdentity({
  product: { productId: "309152_0", name: "Stropní LED osvětlení Beatrix 49 cm, kov/dřevo" },
  productLandingUrl: "https://www.asko-nabytek.cz/309152.1-stropni-led-osvetleni-beatrix-49-cm-kov-drevo",
  landingFetch: {
    fetchStatus: "ok",
    snippet:
      "<html><head><title>Stropní LED osvětlení Beatrix 49 cm, kov/dřevo | ASKO</title>" +
      '<link rel="canonical" href="https://www.asko-nabytek.cz/309152.1-stropni-led-osvetleni-beatrix-49-cm-kov-drevo"></head>' +
      "<body><script>dataLayer=[{ecomm_pagetype:'product', ecomm_prodid:'IDN'+309152}];</script></body></html>",
  },
});
expect("same_base_different_variant_must_not_pass", askoWrongVariant.status !== "pass");

console.log(JSON.stringify({ IU_CJ_OFFER_LANDING_SELFTEST: failures.length === 0 ? "OK" : "FAIL", failures }));
process.exitCode = failures.length === 0 ? 0 : 1;
