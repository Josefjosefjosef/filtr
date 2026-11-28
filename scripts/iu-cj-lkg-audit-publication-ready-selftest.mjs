#!/usr/bin/env node
import { classifyLkgProductFull } from "./iu-cj-affiliate-phase3z-lkg-rootcause-audit-v51-8.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

const base = {
  advertiserId: "1",
  productId: "p",
  affiliateUrl: "https://www.kqzyfj.com/click-101883843-1-p",
  lastVerifiedAt: "2026-11-28T09:00:00Z",
};

const ready = classifyLkgProductFull({ ...base, publicationReady: true });
expect("explicit_true_eligible", ready.publicationEligible === true);

const held = classifyLkgProductFull({ ...base, publicationReady: true, lkgPublicHold: true });
expect("hold_not_eligible", held.publicationEligible === false);

const blocked = classifyLkgProductFull({
  ...base,
  publicationReady: true,
  publicationEligibility: "PUBLICATION_BLOCKED",
});
expect("blocked_not_eligible", blocked.publicationEligible === false);

for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  const row = { ...base };
  if (value !== undefined) row.publicationReady = value;
  const classified = classifyLkgProductFull(row);
  expect("probe_" + String(value), classified.publicationEligible === false);
  expect("probe_reason_" + String(value), classified.reasons.includes("NOT_PUBLICATION_READY"));
}

console.log(
  JSON.stringify({
    IU_CJ_LKG_AUDIT_PUBLICATION_READY_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
