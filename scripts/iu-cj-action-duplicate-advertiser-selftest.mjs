import assert from "node:assert/strict";
import { auditActionButtons } from "./iu-cj-affiliate-phase3z-individual-completeness-audit-v51-8.mjs";

const base = {
  offerId: "a1",
  title: "Black Week",
  publicationReady: true,
  publishable: true,
  fixtureOnly: false,
  blockers: [],
};
const audit = auditActionButtons([
  { ...base, advertiserId: "222", currency: "EUR", affiliateUrl: "https://www.example.com/click-101883843-1" },
  { ...base, advertiserId: "333", currency: "EUR", affiliateUrl: "https://www.example.com/click-101883843-2" },
  { ...base, advertiserId: "222", currency: "EUR", affiliateUrl: "https://www.example.com/click-101883843-3" },
]);
assert.equal(audit.rows[0].flags.includes("duplicate_offerId"), false);
assert.equal(audit.rows[1].flags.includes("duplicate_offerId"), false);
assert.equal(audit.rows[1].advertiserId, "333");
assert.equal(audit.rows[2].flags.includes("duplicate_offerId"), true);
assert.equal(audit.rows[2].advertiserId, "222");

process.stdout.write("IU_CJ_ACTION_DUPLICATE_ADVERTISER_SELFTEST PASS\n");
