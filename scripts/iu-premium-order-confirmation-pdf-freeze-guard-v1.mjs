/**
 * Freeze guard: premium order confirmation PDF (layout, URLs, fonts, two-page attachment).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ads = path.join(root, "cloudflare", "iu-ads", "src");
const testDir = path.join(root, "cloudflare", "iu-ads", "test");

function read(name) {
  return fs.readFileSync(path.join(ads, name), "utf8");
}

const orderPdf = read("premium-order-confirmation-pdf.ts");
const fields = read("premium-order-pdf-fields.ts");
const placement = read("premium-ad-web-placement.ts");
const publicOrder = read("public-premium-order.ts");

const checks = [
  ["ORDER_CONFIRMATION_TWO_PAGE_ATTACHMENT", orderPdf.includes("Schválený reklamní podklad") && orderPdf.includes("addPage")],
  ["ORDER_CONFIRMATION_BOLD_FONTS", orderPdf.includes("registerPremiumPdfFonts")],
  ["ORDER_CONFIRMATION_BRAND_LOGO", orderPdf.includes('"info"') && orderPdf.includes("Uzel.cz")],
  ["ORDER_CONFIRMATION_SUPPLIER_CONFIG", orderPdf.includes("PREMIUM_INVOICE_SUPPLIER")],
  ["ORDER_CONFIRMATION_SECTION_URL_SNAPSHOT", fields.includes("ad_web_placement_url") && placement.includes("resolvePremiumAdWebPlacementUrl")],
  ["ORDER_SUBMIT_URL_SNAPSHOT", publicOrder.includes("ad_web_placement_url") && publicOrder.includes("buildPremiumAdWebPlacementUrl")],
  ["ORDER_WEB_PLACEMENT_LABEL", orderPdf.includes("Webové umístění reklamy")],
  ["ORDER_SERVICE_PERIOD_BOX", orderPdf.includes("Období poskytování")],
  ["ORDER_CATALOG_SECTION_MAP", fs.existsSync(path.join(ads, "premium-affiliate-catalog-ids.ts"))],
  ["ORDER_PRICE_ONCE", orderPdf.includes("Celková cena reklamní služby za")],
  ["ORDER_APPROVER_NAME", orderPdf.includes("Schválil:")],
  ["ORDER_PAGE_NUMBERING", orderPdf.includes("FOOTER_NOTES") && orderPdf.includes('" / "')],
  [
    "ORDER_CREATIVE_ASPECT",
    orderPdf.includes("Math.min(maxW / embedded.w, creativeZoneH / embedded.h") ||
      orderPdf.includes("Math.min(maxW / embedded.w, maxH / embedded.h"),
  ],
  ["ORDER_NO_PORTAL_CODE_FOOTER", orderPdf.includes("Přístupový kód klientského portálu není")],
  [
    "ORDER_CONFIRMATION_VISUAL_FREEZE_TEST",
    fs.existsSync(path.join(testDir, "premium-order-confirmation-visual-freeze.test.ts")),
  ],
  [
    "ORDER_CATEGORY_URL_TEST",
    fs.existsSync(path.join(testDir, "premium-ad-web-placement.test.ts")),
  ],
  [
    "INVOICE_RENDERER_UNTOUCHED_FOR_ORDER_FREEZE",
    !read("premium-invoice-pdf.ts").includes("Schválený reklamní podklad"),
  ],
];

let fail = 0;
for (const [key, ok] of checks) {
  process.stdout.write(key + "=" + (ok ? "true" : "false") + "\n");
  if (!ok) fail++;
}
process.stdout.write("FREEZE_GUARD_PASS=" + (fail === 0 ? "true" : "false") + "\n");
process.exit(fail === 0 ? 0 : 1);
