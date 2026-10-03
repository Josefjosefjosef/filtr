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
const orderUiTs = read("cloudflare/iu-ads/src/premium-order-ui.ts");
const liveSlotCssTs = read("cloudflare/iu-ads/src/premium-live-slot-css.ts");
const termsTs = read("cloudflare/iu-ads/src/premium-terms.ts");
const orderErrorsTs = read("cloudflare/iu-ads/src/premium-order-errors.ts");
const orderUiScriptTs = read("cloudflare/iu-ads/src/premium-order-ui-script.ts");
const publicOrderTs = read("cloudflare/iu-ads/src/public-premium-order.ts");
const secHeadersTs = read("cloudflare/iu-ads/src/security-headers.ts");
const adminUiTs = read("cloudflare/iu-ads/src/admin-ui.ts");
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
must(fs.existsSync(path.join(ROOT, "scripts/iu-premium-selected-render-guard-v1.mjs")), "browser render guard");
must(/function affiliateSelectedSectionVisible\(\)/.test(publicJs), "premium mount when affiliate view is CSS-visible with hidden attr");
must(!/if\s*\(\s*!view\s*\|\|\s*view\.hidden\s*\)\s*return/.test(publicJs), "premium must not gate on hidden attribute alone");
must(/premium-selected-v1-20261003/.test(read("projects/index.html")), "premium asset cache bust");
must(/buildPremiumOrderMetaHtml/.test(indexTs), "order page SSR summary wired");
must(/\/premium\/terms/.test(indexTs), "premium terms route");
must(/validateCzechIco/.test(publicOrderTs), "server-side IČO validation");
must(/b2b_only:\s*true/.test(publicOrderTs), "B2B flag enforced server-side");
must(/readAsDataURL/.test(orderUiScriptTs), "creative preview uses data URL");
must(/id="previewSlot"/.test(orderUiTs), "order preview uses production slot markup");
must(/PREMIUM_LIVE_SLOT_CSS/.test(orderUiTs), "order preview injects live slot CSS");
must(/height:var\(--iuChipH,110px\)/.test(liveSlotCssTs.replace(/\s/g, "")), "live slot CSS height token");
must(/premium-selected-services-b2b-v2-/.test(termsTs), "premium terms v2 current");
must(/buildPremiumTermsV1Html/.test(termsTs), "premium terms v1 archive");
must(/\/premium\/terms\/v1/.test(indexTs), "premium terms v1 route");
must(/invalid_ico_checksum/.test(orderErrorsTs), "IČO checksum error map exists");
must(/Zadané IČO není platné/.test(orderErrorsTs), "IČO checksum Czech message");
must(/id="ico_err"/.test(orderUiTs), "inline IČO error element");
must(fs.existsSync(path.join(ROOT, "scripts/iu-premium-order-preview-parity-guard-v1.mjs")), "preview parity guard");
must(/img-src 'self' blob: data:/.test(secHeadersTs), "CSP allows preview blobs");
must(/iuJRGrid iuPremiumGrid/.test(publicJs), "premium grid matches affiliate JR grid");
must(/btn-nav-toggle/.test(adminUiTs), "admin mobile nav drawer");
must(/#nav-backdrop/.test(adminUiTs), "admin nav backdrop");
must(/max-width:\s*1024px/.test(premiumCss), "mobile/tablet premium compact rules");
must(/schemaVersion:\s*"0013"/.test(indexTs), "health schemaVersion 0013");

const mig0013 = read("cloudflare/iu-ads/migrations/0013_premium_selected_placements_reseed.sql");
const placementIds = [...mig0013.matchAll(/\('(selected_services\.[^']+\.premium\.0[1-4])'/g)].map((m) => m[1]);
must(placementIds.length >= 140, "0013 reseed row count");
must(placementIds.length === new Set(placementIds).size, "0013 placement_id values must be unique");
must(!mig0013.includes("('3256',"), "0013 must not reintroduce literal 3256 placement_id rows");

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("PASS premium-selected-services-freeze-guard-v1");
