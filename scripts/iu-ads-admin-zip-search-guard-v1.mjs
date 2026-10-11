import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(root, "cloudflare", "iu-ads", "src", "index.ts");
const uiPath = path.join(root, "cloudflare", "iu-ads", "src", "admin-ui-script.ts");
const indexSrc = fs.readFileSync(indexPath, "utf8");
const uiSrc = fs.readFileSync(uiPath, "utf8");

const routes = [
  "/v1/admin/search/suggest",
  "/v1/admin/invoices/registry/export-zip",
  "/v1/admin/order-confirmations/registry/export-zip",
];
for (const route of routes) {
  if (!indexSrc.includes(route)) {
    console.error("FAIL: missing route " + route);
    process.exit(1);
  }
}

const uiNeedles = [
  "Globální vyhledávání reklamních objednávek",
  "/v1/admin/search/suggest",
  "downloadZipExport",
  "extendNewOrderModal",
  "ext-target-url",
  "openAdminDocumentAccess",
  "inv-search-go",
  "conf-search-go",
  "ad-corner-badge--active",
  "nav-primary",
];
for (const needle of uiNeedles) {
  if (!uiSrc.includes(needle)) {
    console.error("FAIL: admin UI missing " + needle);
    process.exit(1);
  }
}

console.log("PASS: iu-ads-admin-zip-search-guard-v1");
