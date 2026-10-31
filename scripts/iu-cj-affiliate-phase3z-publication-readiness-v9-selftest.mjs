#!/usr/bin/env node
import {
  evaluatePublicationReadiness,
  attachPublicationReadiness,
  diagnoseContentFailure,
  CONTENT_STATUS,
} from "./iu-cj-affiliate-phase3z-publication-readiness-v9.mjs";

const failures = [];
const proofs = [];
function expect(id, cond, detail) {
  if (!cond) failures.push({ id, detail: detail ?? null });
  else proofs.push({ id, ok: true, detail: detail ?? null });
}

const techOnly = evaluatePublicationReadiness(
  {
    publishability: "READY_FOR_REVIEW",
    relationshipStatus: "joined",
    selectedClickUrl: "https://www.anrdoezrs.net/click-101883843-1",
    destinationType: "MERCHANT_HOMEPAGE",
    unsuitableMainDestination: false,
    czMarketEligibilityVerified: true,
  },
  { reviewStatus: CONTENT_STATUS.CONTENT_INCOMPLETE }
);
expect(
  "tech_ready_not_publication",
  techOnly.technicallyReady === true && techOnly.publicationReady === false,
  techOnly
);

const full = evaluatePublicationReadiness(
  {
    publishability: "READY_FOR_REVIEW",
    relationshipStatus: "joined",
    selectedClickUrl: "https://www.anrdoezrs.net/click-101883843-1",
    destinationType: "MERCHANT_HOMEPAGE",
    unsuitableMainDestination: false,
    czMarketEligibilityVerified: true,
  },
  { reviewStatus: CONTENT_STATUS.CONTENT_VERIFIED, czAvailability: "YES" }
);
expect("publication_ready_all_gates", full.publicationReady === true, full);

const blocked = evaluatePublicationReadiness(
  {
    publishability: "QUARANTINED",
    holdReason: "UNSUITABLE_MAIN_DESTINATION",
    relationshipStatus: "joined",
    selectedClickUrl: "https://x",
    destinationType: "CHECKOUT",
    unsuitableMainDestination: true,
  },
  { reviewStatus: CONTENT_STATUS.BLOCKED }
);
expect("blocked_not_publication", blocked.publicationReady === false, blocked);

const spa = diagnoseContentFailure({
  probe: { ok: true, httpStatus: 200, title: "X", error: null },
  evidence: { contentVerified: false, diagnostics: { spaSuspected: true, thinHtml: true } },
  reviewStatus: CONTENT_STATUS.CONTENT_INCOMPLETE,
});
expect("diag_spa", spa.includes("SPA_JS_RENDERED_MINIMAL_HTML"), spa);
const verifiedEmpty = diagnoseContentFailure({
  probe: { ok: true, httpStatus: 200, title: "x" },
  evidence: { contentVerified: true, diagnostics: {} },
  reviewStatus: "CONTENT_VERIFIED",
});
expect("diag_verified_empty", Array.isArray(verifiedEmpty) && verifiedEmpty.length === 0, verifiedEmpty);

const waf = diagnoseContentFailure({
  probe: { ok: false, httpStatus: 403, title: null, error: null },
  evidence: null,
  reviewStatus: CONTENT_STATUS.CONTENT_UNAVAILABLE,
});
expect("diag_403", waf.includes("HTTP_403_WAF_OR_BOT"), waf);

const registry = {
  partners: [
    {
      advertiserId: "1",
      relationshipStatus: "joined",
      publishability: "READY_FOR_REVIEW",
      selectedClickUrl: "https://www.anrdoezrs.net/click-101883843-1",
      destinationType: "MERCHANT_HOMEPAGE",
      unsuitableMainDestination: false,
      czMarketEligibilityVerified: true,
    },
    {
      advertiserId: "2",
      relationshipStatus: "joined",
      publishability: "READY_FOR_REVIEW",
      selectedClickUrl: "https://www.anrdoezrs.net/click-101883843-2",
      destinationType: "MERCHANT_HOMEPAGE",
      unsuitableMainDestination: false,
      czMarketEligibilityVerified: true,
    },
  ],
};
const summary = attachPublicationReadiness(registry, {
  partners: [
    { advertiserCid: "1", reviewStatus: CONTENT_STATUS.CONTENT_VERIFIED, czAvailability: "YES" },
    { advertiserCid: "2", reviewStatus: CONTENT_STATUS.CONTENT_INCOMPLETE },
  ],
});
expect(
  "summary_split",
  summary.technicallyReady === 2 &&
    summary.publicationReady === 1 &&
    summary.allPublicationReadyContentVerified === true,
  summary
);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, proofs }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      IU_CJ_PHASE3Z_PUBLICATION_READINESS_SELFTEST: "OK",
      proofCount: proofs.length,
      publicationReadyExample: full.publicationReady,
      technicallyOnly: techOnly.publicationReady,
    },
    null,
    2
  )
);
