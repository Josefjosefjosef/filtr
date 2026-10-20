#!/usr/bin/env node
import {
  CZ_VERTICAL_SECTIONS,
  evaluateCzVerticalFeedContentGate,
  evaluateCzVerticalRoutingGate,
} from "./iu-prod-hard-proof-cz-vertical-deep-link-readiness.mjs";

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(
  evaluateCzVerticalRoutingGate({
    expectedSection: "hry",
    dataSection: "hry",
    dataIuFc: "1",
    coldSectionAttr: null,
    centerView: "media",
    articlesRequired: false,
    hasActiveNav: false,
  }).ok === true,
  "routing_pass_without_nav_when_no_articles"
);

must(
  evaluateCzVerticalRoutingGate({
    expectedSection: "hry",
    dataSection: "hry",
    dataIuFc: "1",
    coldSectionAttr: "1",
    centerView: "media",
    articlesRequired: false,
    hasActiveNav: true,
  }).ok === false,
  "cold_section_fail"
);

must(
  evaluateCzVerticalFeedContentGate({
    expectedSection: "hry",
    articlesRequired: false,
    dataSection: "hry",
    dataIuFc: "1",
    coldSectionAttr: null,
    centerView: "media",
    hasActiveNav: false,
    feedExists: true,
    feedReady: "true",
    feedVisible: false,
  }).ok === true,
  "feed_skipped_when_no_published_articles"
);

must(
  evaluateCzVerticalFeedContentGate({
    expectedSection: "hry",
    articlesRequired: true,
    dataSection: "hry",
    dataIuFc: "1",
    coldSectionAttr: null,
    centerView: "media",
    hasActiveNav: true,
    feedExists: true,
    feedReady: "true",
    feedVisible: true,
    titleLinkCount: 2,
    titleLinksBlank: 2,
    sampleHref: "https://example.com/a",
  }).ok === true,
  "feed_content_pass"
);

must(
  evaluateCzVerticalFeedContentGate({
    expectedSection: "hry",
    articlesRequired: true,
    dataSection: "kultura",
    dataIuFc: "1",
    coldSectionAttr: null,
    centerView: "media",
    hasActiveNav: true,
    feedVisible: true,
    titleLinkCount: 2,
    titleLinksBlank: 2,
    sampleHref: "https://example.com/a",
  }).ok === false,
  "wrong_section_fail"
);

must(CZ_VERTICAL_SECTIONS.length === 4, "four_cz_verticals");

console.log("IU_PROD_HARD_PROOF_CZ_VERTICAL_DEEP_LINK_READINESS_SELFTEST_PASS=" + (fails.length === 0));
if (fails.length) {
  console.log("IU_PROD_HARD_PROOF_CZ_VERTICAL_DEEP_LINK_READINESS_SELFTEST_FAILS=" + fails.join(","));
  process.exitCode = 1;
}
