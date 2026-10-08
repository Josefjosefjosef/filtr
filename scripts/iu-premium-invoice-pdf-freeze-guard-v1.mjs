/**
 * Freeze guard: premium invoice PDF (QR Platba, web placement, brand logo, VAT config).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ads = path.join(root, "cloudflare", "iu-ads", "src");

function read(name) {
  return fs.readFileSync(path.join(ads, name), "utf8");
}

const invoicePdf = read("premium-invoice-pdf.ts");
const spayd = read("premium-invoice-spayd.ts");
const vat = read("premium-invoice-vat.ts");
const orderPdf = read("premium-order-confirmation-pdf.ts");

const checks = [
  ["INVOICE_QR_SPAYD", spayd.includes("SPD*1.0") && spayd.includes("buildPremiumInvoiceSpayd")],
  ["INVOICE_QR_LOCAL", read("premium-invoice-qr.ts").includes("buildPremiumInvoiceQrPng") && !invoicePdf.includes("infouzel.cz/assets")],
  [
    "INVOICE_WEB_PLACEMENT",
    invoicePdf.includes("Webové umístění reklamy") && read("premium-invoice-brand.ts").includes("www.infouzel.cz"),
  ],
  ["INVOICE_TEXT_LOGO", invoicePdf.includes('"info"') && invoicePdf.includes("Uzel.cz")],
  ["INVOICE_BRAND_HEX", read("premium-invoice-brand.ts").includes("#003cff")],
  ["INVOICE_COMMERCIAL_REGISTER", read("premium-invoice-supplier.ts").includes("447292")],
  ["ORDER_WEB_PLACEMENT", orderPdf.includes("Webové umístění reklamy")],
  ["ORDER_PRICE_ONCE", orderPdf.includes("Celková cena reklamní služby za")],
  ["ORDER_APPROVER_NAME", orderPdf.includes("Schválil:")],
  ["VAT_NON_PAYER_DEFAULT", vat.includes('mode: "non_payer"')],
  ["VAT_FUTURE_PAYER_RESOLVER", vat.includes("resolvePremiumInvoiceVat")],
  ["PUBLISH_APPROVER_SNAPSHOT", read("premium-publish.ts").includes("published_by_display_name")],
];

let fail = 0;
for (const [key, ok] of checks) {
  process.stdout.write(key + "=" + (ok ? "true" : "false") + "\n");
  if (!ok) fail++;
}
process.stdout.write("FREEZE_GUARD_PASS=" + (fail === 0 ? "true" : "false") + "\n");
process.exit(fail === 0 ? 0 : 1);
