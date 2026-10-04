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
const publicSelectedTs = read("cloudflare/iu-ads/src/public-premium-selected.ts");
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
must(/premium-selected-v1-20261004-sales-blue/.test(read("projects/index.html")), "premium asset cache bust");
must(/--iu-premium-sales-fg/.test(premiumCss), "premium sales blue token");
must(/#iuAffiliateView \.iuPremiumSalesPanel/.test(premiumCss), "premium sales panel color scope");
must(!/aff-cestovni-kancelare/.test(premiumCss), "no category-specific premium color hacks");
must(fs.existsSync(path.join(ROOT, "scripts/iu-premium-sales-color-hierarchy-guard-v1.mjs")), "premium sales color guard");
must(fs.existsSync(path.join(ROOT, "cloudflare/iu-ads/migrations/0014_premium_catalog_four_positions.sql")), "migration 0014");
must(!/capacityAfterP2FirstPublish/.test(publishTs), "legacy P2 unlock publish removed");
must(/sales_catalog_positions:\s*4/.test(publicSelectedTs), "catalog always four positions");
must(!/if\s*\(\s*!slot\.publicly_listed\s*\)\s*continue/.test(publicJs), "sales panel must not filter P3/P4");
must(/Chci zde mít vlastní tlačítko/.test(publicJs), "premium sales link in client JS");
must(/iuPremiumSalesPanel/.test(publicJs), "premium sales panel in client JS");
must(!/buildFreeSlot/.test(publicJs), "no public free-slot renderer");
must(/assignPremiumDisplayRanks/.test(read("cloudflare/iu-ads/src/premium-display.ts")), "display rank helper");
must(/sale_state/.test(publicSelectedTs), "catalog sale_state in public API");
must(fs.existsSync(path.join(ROOT, "scripts/iu-premium-display-compaction-guard-v1.mjs")), "display compaction guard");
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
must(/schemaVersion:\s*"0014"/.test(indexTs), "health schemaVersion 0014");

const mig0013 = read("cloudflare/iu-ads/migrations/0013_premium_selected_placements_reseed.sql");
const placementIds = [...mig0013.matchAll(/\('(selected_services\.[^']+\.premium\.0[1-4])'/g)].map((m) => m[1]);
must(placementIds.length >= 140, "0013 reseed row count");
must(placementIds.length === new Set(placementIds).size, "0013 placement_id values must be unique");
must(!mig0013.includes("('3256',"), "0013 must not reintroduce literal 3256 placement_id rows");

const freezeContract = {
  EMPTY_PREMIUM_PUBLICLY_HIDDEN: !/buildFreeSlot/.test(publicJs),
  ACTIVE_PREMIUM_PUBLICLY_VISIBLE: /iuPremiumSlot--sold/.test(publicJs),
  ACTIVE_PREMIUM_COMPACT_ORDER: /assignPremiumDisplayRanks/.test(read("cloudflare/iu-ads/src/premium-display.ts")),
  CONTRACTED_POSITION_IMMUTABLE:
    /contracted position stays immutable/.test(read("cloudflare/iu-ads/src/premium-display.ts")) &&
    /display ranks without changing contracted position/.test(read("cloudflare/iu-ads/test/premium-display-compaction.test.ts")),
  DISPLAY_RANK_DYNAMIC:
    /display_rank/.test(read("cloudflare/iu-ads/src/premium-display.ts")) &&
    /assignPremiumDisplayRanks/.test(read("cloudflare/iu-ads/src/public-premium-selected.ts")),
  SALES_LINK_PRESENT: /Chci zde mít vlastní tlačítko/.test(publicJs),
  SALES_PANEL_SERVER_AUTHORITATIVE: /sale_state/.test(publicSelectedTs) && /iuPremiumSalesPanel/.test(publicJs),
  SALES_PANEL_ALL_POSITIONS_VISIBLE: /sales_catalog_positions:\s*4/.test(publicSelectedTs),
  P1_FREE_BUYABLE: /buyable:\s*saleState === "available"/.test(publicSelectedTs),
  P2_FREE_BUYABLE: /buyable:\s*saleState === "available"/.test(publicSelectedTs),
  P3_FREE_BUYABLE: /isPremiumSlotPubliclyListed\(capacity,\s*position\)/.test(publicSelectedTs),
  P4_FREE_BUYABLE: !/if\s*\(\s*position\s*<=\s*2\s*\)\s*return\s*true/.test(premiumTs),
  PREMIUM_POSITIONS_INDEPENDENT:
    /availability is occupancy-only/.test(premiumTs) && !/capacityAfterP2FirstPublish/.test(publishTs),
  P3_P4_REQUIRE_P1_P2_SALE: false,
  LEGACY_PREMIUM_UNLOCK_LOGIC_REMOVED:
    !/capacityAfterP2FirstPublish/.test(premiumTs) && !/premium_capacity becomes 4/.test(premiumTs),
  PREVIEW_EQUALS_LIVE_SLOT: /id="previewSlot"/.test(orderUiTs) && /PREMIUM_LIVE_SLOT_CSS/.test(orderUiTs),
  ICO_REQUIRED: /validateCzechIco/.test(publicOrderTs),
  B2B_ONLY: /b2b_only:\s*true/.test(publicOrderTs),
  NO_TRACKING: !/\/v1\/public\/premium\/selected-services\/click/.test(indexTs),
  PREMIUM_SALES_TRIGGER_GREEN: /var\(--iuLink/.test(premiumCss) && /#iuAffiliateView \.iuPremiumSalesLink/.test(premiumCss),
  PREMIUM_SALES_CONTENT_BLUE: /--iu-premium-sales-fg/.test(premiumCss),
  PREMIUM_SALES_TOP_EXPLANATION_BLUE: /\.iuPremiumSalesPanel \.iuPremiumSalesHint/.test(premiumCss),
  PREMIUM_SALES_CARD_TEXT_BLUE: /\.iuPremiumSalesPanel a\.iuPremiumSlot--sale/.test(premiumCss),
  PREMIUM_SALES_PRICE_BLUE: /\.iuPremiumSlotSub/.test(premiumCss),
  PREMIUM_SALES_ORDER_TEXT_BLUE: /\.iuPremiumSlotBuy/.test(premiumCss),
  PREMIUM_SALES_BOTTOM_EXPLANATION_BLUE: /\.iuPremiumSalesPanel \.iuPremiumSalesHint/.test(premiumCss),
  STANDARD_DISCLOSURE_COLOR_UNCHANGED: !/\.iuAffiliateDisclosure[\s\S]*--iu-premium-sales-fg/.test(premiumCss),
  ALL_SELECTED_SERVICES_CATEGORIES_USE_SHARED_PREMIUM_STYLE:
    !/aff-/.test(premiumCss) && /#iuAffiliateView \.iuPremiumSalesPanel/.test(premiumCss),
  CATEGORY_SPECIFIC_PREMIUM_COLOR_HACKS: 0,
  DEVICE_SPECIFIC_PREMIUM_COLOR_HACKS: !(premiumCss.match(/@media[^{]+\{[\s\S]*?\n\}/g) || []).some((block) =>
    /--iu-premium-sales-fg/.test(block)
  ),
  PREVIOUSLY_CORRECT_BROKEN: failures.length,
};

if (failures.length) {
  console.error("FAIL");
  for (const f of failures) console.error(f);
  console.error(JSON.stringify(freezeContract, null, 2));
  process.exit(1);
}
console.log("PASS premium-selected-services-freeze-guard-v1");
console.log(JSON.stringify(freezeContract, null, 2));
