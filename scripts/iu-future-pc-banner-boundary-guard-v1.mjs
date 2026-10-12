/**
 * Ensures future PC sidebar banners stay isolated from premium P1–P8 selected_services.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const failures = [];

function must(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const indexTs = read("cloudflare/iu-ads/src/index.ts");
const placeholderTs = read("cloudflare/iu-ads/src/admin-invoices-registry.ts");
const premiumTs = read("cloudflare/iu-ads/src/premium-selected-services.ts");

must(/handleAdminBannerPcPlaceholder/.test(indexTs), "admin banner PC route wired in index");
must(/\/v1\/admin\/banner-pc/.test(indexTs), "banner-pc path registered");
must(/P1–P8|P1-P8|tlačítkové pozice P1–P8/i.test(placeholderTs), "placeholder documents P1–P8 unchanged");
must(!/executePremiumApproveAndPublish/.test(placeholderTs), "banner placeholder must not publish premium orders");
must(/selected_services\./.test(premiumTs), "premium catalog id prefix preserved");
must(!/sidebar_banner/i.test(premiumTs), "premium selected services must not define sidebar banner product");

if (failures.length) {
  console.error("IU_FUTURE_PC_BANNER_BOUNDARY_GUARD=FAIL");
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log("IU_FUTURE_PC_BANNER_BOUNDARY_GUARD=PASS");
