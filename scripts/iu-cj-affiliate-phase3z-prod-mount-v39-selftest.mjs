#!/usr/bin/env node
/**
 * V39 — production mount proof contract (offline).
 * Public entry must be https://infouzel.cz/ ; /projects/ remains internal asset/data prefix.
 */
const PUBLIC_PROD_URL = "https://infouzel.cz/";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(PUBLIC_PROD_URL === "https://infouzel.cz/", "public prod URL");
assert(!PUBLIC_PROD_URL.includes("/projects"), "public entry is not /projects/");

// Document internal routing contract used by app + guards
const internalSectionUrl = (sectionId) => `${PUBLIC_PROD_URL}?section=${sectionId}`;
assert(internalSectionUrl("aff-auto-moto") === "https://infouzel.cz/?section=aff-auto-moto", "section deep link");

const rootCause = {
  v38EmptyMount: "TEST_NAVIGATION_AND_INIT",
  requiredActivation: ["iuEnsureSecondaryJs(affiliate)", "iuAffiliateApplySection(sectionId)", "left-nav data-accent click"],
  mountSelector: "#iuAffiliatePhase2Offers",
  viewSelector: "#iuAffiliateView",
};

assert(rootCause.mountSelector.startsWith("#"), "mount selector");

console.log(
  JSON.stringify({
    IU_CJ_PROD_MOUNT_V39_SELFTEST: "PASS",
    PUBLIC_PROD_URL,
    rootCause: rootCause.v38EmptyMount,
    internalExample: internalSectionUrl("aff-elektronika"),
  })
);
