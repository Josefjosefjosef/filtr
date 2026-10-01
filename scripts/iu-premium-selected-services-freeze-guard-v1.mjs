/**
 * Freeze guard — premium selected services invariants.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function must(cond, msg) {
  if (!cond) failures.push(msg);
}

const premiumTs = read("cloudflare/iu-ads/src/premium-selected-services.ts");
const publicTs = read("cloudflare/iu-ads/src/public-premium-selected.ts");
const publicJs = read("assets/iu-premium-selected-services-v1.js");
const premiumCss = read("assets/iu-premium-selected-services-v1.css");
const affiliateJs = read("assets/iu-affiliate-catalog.js");
const appCss = read("assets/app.css");
const indexTs = read("cloudflare/iu-ads/src/index.ts");
const publishTs = read("cloudflare/iu-ads/src/premium-publish.ts");
const clientPremiumTs = read("cloudflare/iu-ads/src/client-premium.ts");
const clientUi = read("cloudflare/iu-ads/src/client-ui.ts");
const adminPreviewTs = read("cloudflare/iu-ads/src/admin-premium-preview.ts");

must(/selected_services\./.test(premiumTs), "stable placement id prefix");
must(/resolveAuthoritativePriceCents/.test(premiumTs), "price tampering guard");
must(/impressions:\s*false/.test(publicTs), "no impressions in public API");
must(/clicks:\s*false/.test(publicTs), "no clicks in public API");
must(!/\/v1\/public\/premium\/selected-services\/click/.test(indexTs), "no click tracking endpoint");
must(!/affiliateUrlReady/.test(publicJs), "premium JS must not touch affiliate URLs");
must(!/ads\.infouzel\.cz\/click/.test(publicJs), "no ads click redirect");
must(/target_url/.test(publicJs), "direct target href");
must(/iuAffiliateGrid/.test(affiliateJs), "standard affiliate grid preserved");
must(/iuRadioChip/.test(appCss), "standard chip class preserved");
must(/height:\s*var\(--iuChipH,\s*110px\)/.test(premiumCss), "premium height matches chip");
must(/border-radius:\s*12px/.test(premiumCss), "premium radius 12px");
must(!/iuSectionAccent/.test(premiumCss), "premium must not use section accent colors");
must(/overflow:\s*hidden/.test(premiumCss), "banner clip inside rounded box");
must(/object-fit:\s*cover/.test(premiumCss), "full-bleed banner crop");
must(/object-fit:\s*contain/.test(premiumCss), "logo contain");
must(/executePremiumApproveAndPublish/.test(publishTs), "approve and publish workflow");
must(/premium_publish_events/.test(publishTs), "publish idempotency");
must(fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/migrations/0011_premium_selected_services.sql")), "migration 0011");
must(fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/migrations/0012_premium_selected_ops.sql")), "migration 0012");
must(fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/migrations/0013_premium_selected_placements_reseed.sql")), "migration 0013");
must(/measurement:\s*\{\s*impressions:\s*false/.test(clientPremiumTs), "client portal no impressions");
must(/\/v1\/client\/premium\/summary/.test(clientUi), "client portal premium tab");
must(/preview_html/.test(adminPreviewTs), "admin creative preview");
must(/renewal_publish:/.test(read("cloudflare/iu-ads/src/admin-premium-selected.ts")), "renewal publish idempotency");
must(fs.existsSync(path.join(ROOT, "scripts/iu-premium-selected-no-tracking-guard-v1.mjs")), "browser no-tracking guard");

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("PASS premium-selected-services-freeze-guard-v1");
