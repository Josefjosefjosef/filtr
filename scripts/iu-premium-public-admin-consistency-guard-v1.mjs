#!/usr/bin/env node
/**
 * Regression guard: premium public render must stay tied to admin publication authority.
 * Run: npm run iu-premium-public-admin-consistency-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const consistencySrc = fs.readFileSync(
  path.join(ROOT, "cloudflare/iu-ads/src/premium-publication-consistency.ts"),
  "utf8"
);
const rejectSrc = fs.readFileSync(path.join(ROOT, "cloudflare/iu-ads/src/admin-premium-selected.ts"), "utf8");
const maintenanceSrc = fs.readFileSync(path.join(ROOT, "cloudflare/iu-ads/src/premium-maintenance.ts"), "utf8");
const publicRenderSrc = fs.readFileSync(path.join(ROOT, "cloudflare/iu-ads/src/public-premium-selected.ts"), "utf8");
const clientJs = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.js"), "utf8");

ok("module:consistency_exists", /assessPremiumCampaignPublicAuthority/.test(consistencySrc));
ok("module:reject_unpublish", /executePremiumOrderReject/.test(consistencySrc));
ok("module:repair_scan", /scanPremiumPublicationConsistency/.test(consistencySrc));
ok("reject:wires_execute", /executePremiumOrderReject/.test(rejectSrc));
ok("maintenance:repair_hook", /repairPremiumPublicationConsistency/.test(maintenanceSrc));
ok("public:uses_active_campaign", /active_campaign_id/.test(publicRenderSrc));
ok("public:no_tracking", !/\/click|impression|trackEvent/i.test(clientJs));
ok(
  "test:consistency_suite",
  fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/test/premium-publication-consistency.test.ts"))
);

if (fails.length) {
  console.error("FAIL iu-premium-public-admin-consistency-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-public-admin-consistency-guard-v1");
