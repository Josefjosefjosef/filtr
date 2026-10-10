#!/usr/bin/env node
/**
 * Fail if bundled ads section titles drift from assets/iu-affiliate-catalog.js.
 * Run: npm run iu-premium-affiliate-catalog-titles-parity-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(ROOT, "assets", "iu-affiliate-catalog.js");
const titlesPath = path.join(ROOT, "cloudflare", "iu-ads", "src", "premium-affiliate-catalog-titles.ts");
const slugsPath = path.join(ROOT, "cloudflare", "iu-ads", "src", "premium-selected-services.ts");

const catalogSrc = fs.readFileSync(catalogPath, "utf8");
const catalog = {};
const re = /\bid:\s*"(aff-[a-z0-9-]+)"[\s\S]*?\btitle:\s*"([^"]+)"/g;
let m;
while ((m = re.exec(catalogSrc)) !== null) {
  catalog[m[1]] = m[2];
}

const titlesSrc = fs.readFileSync(titlesPath, "utf8");
const bundled = {};
const tre = /"(aff-[a-z0-9-]+)":\s*"([^"]+)"/g;
while ((m = tre.exec(titlesSrc)) !== null) {
  bundled[m[1]] = m[2];
}

const slugsSrc = fs.readFileSync(slugsPath, "utf8");
const slugBlock = slugsSrc.match(/PREMIUM_AFFILIATE_CATEGORY_SLUGS[\s\S]*?=\s*\[([\s\S]*?)\];/);
if (!slugBlock) {
  console.error("IU_PREMIUM_AFFILIATE_CATALOG_TITLES_PARITY_FAIL=missing_slug_list");
  process.exit(1);
}
const slugs = [];
const sre = /"(aff-[^"]+)"/g;
while ((m = sre.exec(slugBlock[1]))) slugs.push(m[1]);

const fails = [];
for (const slug of slugs) {
  if (!catalog[slug]) fails.push("catalog_missing:" + slug);
  else if (bundled[slug] !== catalog[slug]) {
    fails.push("title_mismatch:" + slug + ":bundled=" + bundled[slug] + ":catalog=" + catalog[slug]);
  }
}
for (const slug of Object.keys(bundled)) {
  if (!catalog[slug]) fails.push("bundled_orphan:" + slug);
}

if (fails.length) {
  console.error("IU_PREMIUM_AFFILIATE_CATALOG_TITLES_PARITY_FAIL=" + fails.join(","));
  process.exit(1);
}
console.log("IU_PREMIUM_AFFILIATE_CATALOG_TITLES_PARITY_PASS=true");
console.log("SECTION_COUNT=" + slugs.length);
