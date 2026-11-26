#!/usr/bin/env node
/**
 * V51.8 — four previously SECTION_UNRESOLVED JOINED partners.
 * 4786110 4camping.cz → aff-sport-outdoor (publishable)
 * 6298382 Picasee Europe → aff-mobily (publishable)
 * 6748811 Impresi CZ/SK → aff-kvetiny-darky (publishable)
 * 7417963 OnBuy EU → aff-inzerce-bazary via the general department-store rule.
 * Publication stays blocked: no onbuy.com/cz destination and no CID override.
 */
import {
  classifyFromCjEvidence,
  PHASE3Z_CID_SECTION_OVERRIDES_V6,
} from "./iu-cj-affiliate-phase3z-partner-registry-v1.mjs";

function assert(cond, msg, detail) {
  if (!cond) {
    const err = new Error("ASSERT: " + msg);
    err.detail = detail;
    throw err;
  }
}

const cases = [
  {
    advertiserId: "4786110",
    advertiserName: "4camping.cz",
    programUrl: "https://www.4camping.cz",
    primaryCategory: "<parent>Recreation &amp; Leisure</parent><child>Camping and Hiking</child>",
    expectSection: "aff-sport-outdoor",
    expectPublishable: true,
  },
  {
    advertiserId: "6298382",
    advertiserName: "Picasee Europe",
    programUrl: "https://www.picasee.cz/",
    primaryCategory: "<parent>Entertainment</parent><child>Mobile Entertainment</child>",
    expectSection: "aff-mobily",
    expectPublishable: true,
  },
  {
    advertiserId: "6748811",
    advertiserName: "Impresi CZ/SK",
    programUrl: "https://www.impresi.cz/",
    primaryCategory: "<parent>Art/Photo/Music</parent><child>Photo</child>",
    expectSection: "aff-kvetiny-darky",
    expectPublishable: true,
  },
  {
    advertiserId: "7417963",
    advertiserName: "OnBuy EU",
    programUrl: "https://www.onbuy.com/de/",
    primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
    expectSection: null,
    expectPublishable: false,
    expectRule: "department_store_no_single_taxonomy_tile",
    expectSource: "cj_category_merchant_subtype_v51_8",
    holdReason: "NO_CZ_DESTINATION_LINK",
  },
];

const results = [];
for (const c of cases) {
  const r = classifyFromCjEvidence(c);
  if (c.expectPublishable) {
    assert(r.sectionId === c.expectSection, c.advertiserId + "_section", r);
    assert(!!PHASE3Z_CID_SECTION_OVERRIDES_V6[c.advertiserId], c.advertiserId + "_cid_override");
  } else {
    assert(r.sectionId == null, c.advertiserId + "_not_a_bazar", r);
    assert(r.rule === c.expectRule, c.advertiserId + "_department_store_rule", r);
    assert(r.source === c.expectSource, c.advertiserId + "_not_a_cid_override", r);
    assert(r.merchantSubtype === "DEPARTMENT_STORE", c.advertiserId + "_subtype", r);
    assert(!PHASE3Z_CID_SECTION_OVERRIDES_V6[c.advertiserId], c.advertiserId + "_no_force_override");
    assert(!/\/cz(\/|$)/i.test(c.programUrl), c.advertiserId + "_cz_destination_absent");
  }
  results.push({
    advertiserId: c.advertiserId,
    name: c.advertiserName,
    sectionId: r.sectionId,
    source: r.source,
    rule: r.rule || r.holdHint || null,
    publishable: c.expectPublishable,
    holdReason: c.holdReason || null,
  });
}

// Taxonomy exact rules (without CID) still resolve camping / mobile entertainment / photo
const campingNoCid = classifyFromCjEvidence({
  advertiserName: "Some Camping Shop",
  programUrl: "https://example.cz",
  primaryCategory: "<parent>Recreation &amp; Leisure</parent><child>Camping and Hiking</child>",
});
assert(campingNoCid.sectionId === "aff-sport-outdoor", "camping_exact_without_cid", campingNoCid);

const photoNoCid = classifyFromCjEvidence({
  advertiserName: "Photo Gifts Co",
  programUrl: "https://example.cz",
  primaryCategory: "<parent>Art/Photo/Music</parent><child>Photo</child>",
});
assert(photoNoCid.sectionId === "aff-kvetiny-darky", "photo_exact_without_cid", photoNoCid);

const otherDepartmentStore = classifyFromCjEvidence({
  advertiserName: "Example Department Store",
  programUrl: "https://example-mall.example/sk/",
  primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
});
assert(otherDepartmentStore.sectionId == null, "department_store_rule_is_general", otherDepartmentStore);
assert(otherDepartmentStore.merchantSubtype === "DEPARTMENT_STORE", "department_store_subtype", otherDepartmentStore);
assert(otherDepartmentStore.source === "cj_category_merchant_subtype_v51_8", "department_store_not_cid", otherDepartmentStore);

const classifieds = classifyFromCjEvidence({
  advertiserName: "Aukro Bazar",
  programUrl: "https://aukro.cz/",
  primaryCategory: "<parent>Department Stores/Malls</parent><child>Department Stores</child>",
});
assert(classifieds.sectionId === "aff-inzerce-bazary", "classifieds_keep_existing_tile", classifieds);

const ambiguous = classifyFromCjEvidence({
  advertiserName: "Unclear Merchant",
  programUrl: "https://example.example/",
  primaryCategory: "<parent>Business</parent><child>Other</child>",
});
assert(ambiguous.sectionId == null, "ambiguous_stays_unresolved", ambiguous);

console.log(
  JSON.stringify({
    IU_CJ_FOUR_UNRESOLVED_PARTNERS_V51_8_SELFTEST: "PASS",
    results,
  })
);
