#!/usr/bin/env node
import {
  mergeIntoDurableCatalog,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";
import { PUBLICATION_ELIGIBILITY } from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

const nowIso = "2026-11-28T06:50:00.000Z";
const url = "https://www.kqzyfj.com/click-101883843-1001";

const first = mergeIntoDurableCatalog(null, [
  {
    advertiserId: "1",
    productId: "ok",
    currentPrice: 10,
    availability: "in_stock",
    affiliateUrl: url,
  },
  {
    advertiserId: "1",
    productId: "oos",
    currentPrice: 10,
    availability: "out_of_stock",
    affiliateUrl: url,
  },
  {
    advertiserId: "9",
    productId: "ended",
    currentPrice: 10,
    availability: "in_stock",
    affiliateUrl: url,
  },
], { nowIso, endedAdvertisers: ["9"] });

const ok = first.doc.products["1|ok"];
const oos = first.doc.products["1|oos"];
const ended = first.doc.products["9|ended"];
if (ok.publicationReady !== true) {
  console.error(JSON.stringify({ ok }));
  process.exit(1);
}
if (oos.publicationEligibility !== PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD || oos.publicationReady !== false) {
  console.error(JSON.stringify({ oos }));
  process.exit(1);
}
if (ended.publicationEligibility !== PUBLICATION_ELIGIBILITY.PUBLICATION_BLOCKED || ended.publicationReady !== false) {
  console.error(JSON.stringify({ ended }));
  process.exit(1);
}

const unseen = mergeIntoDurableCatalog(first.doc, [], {
  nowIso: "2026-11-28T07:50:00.000Z",
  endedAdvertisers: ["1"],
  livePublicKeys: new Set(["1|ok"]),
});
const heldOk = unseen.doc.products["1|ok"];
if (heldOk.publicationReady !== false || heldOk.publicOffer !== false) {
  console.error(JSON.stringify({ heldOk }));
  process.exit(1);
}

console.log(JSON.stringify({
  DURABLE_PUBLICATION_READY_SELFTEST: "PASS",
  eligible: ok.publicationReady,
  held: oos.publicationReady,
  blocked: ended.publicationReady,
  unseenEnded: heldOk.publicationReady,
}));
