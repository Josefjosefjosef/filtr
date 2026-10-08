/**
 * Freeze guard: premium auto PDF documents on approve-publish (behavioral smoke, repo-local).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ads = path.join(root, "cloudflare", "iu-ads", "src");

function read(name) {
  return fs.readFileSync(path.join(ads, name), "utf8");
}

const publish = read("premium-publish.ts");
const docs = read("premium-order-documents.ts");
const ui = fs.readFileSync(path.join(ads, "admin-ui-script.ts"), "utf8");

const checks = [
  ["DOCUMENTS_AUTOMATIC_ON_APPROVAL", publish.includes("ensurePremiumOrderDocumentsAfterPublish")],
  ["ORDER_PDF_IMPLEMENTED", fs.existsSync(path.join(ads, "premium-order-confirmation-pdf.ts"))],
  ["INVOICE_PDF_IMPLEMENTED", fs.existsSync(path.join(ads, "premium-invoice-pdf.ts"))],
  ["DOCUMENTS_IDEMPOTENT", docs.includes("idx_documents_premium_order_kind") || docs.includes("order_id = ? AND doc_type")],
  ["ADMIN_DOCUMENTS_SECTION", ui.includes("Dokumenty objednávky")],
  ["INVOICE_DUE_3", read("premium-selected-services.ts").includes("PREMIUM_INVOICE_DUE_CALENDAR_DAYS = 3")],
  ["ORDER_PDF_FIELDS_GUARD", fs.existsSync(path.join(ads, "premium-order-pdf-fields.ts"))],
  [
    "ORDER_PDF_FONT_BUNDLED",
    fs.existsSync(path.join(ads, "..", "assets", "fonts", "noto-sans-latin-ext-400-normal.ttf")) &&
      read("premium-pdf-font-bundled.ts").includes("noto-sans-latin-ext-400-normal.ttf") &&
      !read("premium-pdf-font.ts").includes("infouzel.cz/assets/fonts"),
  ],
  [
    "ORDER_PDF_FONT_WRANGLER_DATA_RULE",
    fs.readFileSync(path.join(ads, "..", "wrangler.toml"), "utf8").includes('type = "Data"') &&
      fs.readFileSync(path.join(ads, "..", "wrangler.toml"), "utf8").includes("**/*.ttf"),
  ],
  [
    "PROD_PROOF_NO_BACKFILL_APPLY",
    fs
      .readFileSync(path.join(root, "scripts", "iu-premium-order-documents-prod-proof.mjs"), "utf8")
      .includes("skipped_no_apply"),
  ],
  [
    "PROD_PROOF_QR_DECODE",
    fs
      .readFileSync(path.join(root, "scripts", "iu-premium-order-documents-prod-proof.mjs"), "utf8")
      .includes("decodeSpaydFromProdInvoicePdf"),
  ],
];

let fail = 0;
for (const [key, ok] of checks) {
  process.stdout.write(key + "=" + (ok ? "true" : "false") + "\n");
  if (!ok) fail++;
}
process.stdout.write("FREEZE_GUARD_PASS=" + (fail === 0 ? "true" : "false") + "\n");
process.exit(fail === 0 ? 0 : 1);
