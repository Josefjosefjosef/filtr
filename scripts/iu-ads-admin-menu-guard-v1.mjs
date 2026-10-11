import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const navPath = path.join(root, "cloudflare", "iu-ads", "src", "admin-nav.ts");
const src = fs.readFileSync(navPath, "utf8");

const orderMatch = src.match(/ADMIN_NAV_ORDER_IDS:\s*readonly\s*string\[\]\s*=\s*\[([\s\S]*?)\];/);
if (!orderMatch) {
  console.error("FAIL: ADMIN_NAV_ORDER_IDS not found");
  process.exit(1);
}

const ids = [...orderMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const requiredPrefix = [
  "dashboard",
  "search",
  "orders_all",
  "premium",
  "banner_pc",
  "order_confirmations",
  "invoices",
];

for (let i = 0; i < requiredPrefix.length; i++) {
  if (ids[i] !== requiredPrefix[i]) {
    console.error("FAIL: nav order at index " + i + " expected " + requiredPrefix[i] + " got " + (ids[i] || "(missing)"));
    process.exit(1);
  }
}

const labels = [
  ["orders_all", "Všechny objednávky"],
  ["premium", "Reklamní tlačítka"],
  ["banner_pc", "Bannerová reklama"],
  ["order_confirmations", "Potvrzení objednávek"],
];
for (const [id, fragment] of labels) {
  if (!src.includes('id: "' + id + '"') || !src.includes(fragment)) {
    console.error("FAIL: missing nav label for " + id);
    process.exit(1);
  }
}

console.log("PASS: iu-ads-admin-menu-guard-v1");
