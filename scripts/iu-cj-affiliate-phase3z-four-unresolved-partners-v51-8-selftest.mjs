#!/usr/bin/env node
/**
 * V51.8 — four previously SECTION_UNRESOLVED JOINED partners.
 * 4786110 4camping.cz → aff-sport-outdoor (publishable)
 * 6298382 Picasee Europe → aff-mobily (publishable)
 * 6748811 Impresi CZ/SK → aff-kvetiny-darky (publishable)
 * 7417963 OnBuy EU → HOLD (no onbuy.com/cz destination among approved links)
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
    assert(r.sectionId == null, c.advertiserId + "_hold_no_section", r);
    assert(!PHASE3Z_CID_SECTION_OVERRIDES_V6[c.advertiserId], c.advertiserId + "_no_force_override");
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

console.log(
  JSON.stringify({
    IU_CJ_FOUR_UNRESOLVED_PARTNERS_V51_8_SELFTEST: "PASS",
    results,
  })
);
