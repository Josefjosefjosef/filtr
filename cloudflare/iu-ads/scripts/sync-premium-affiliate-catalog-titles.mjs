#!/usr/bin/env node
/**
 * Regenerate premium-affiliate-catalog-titles.ts from assets/iu-affiliate-catalog.js.
 * Run from repo root: node cloudflare/iu-ads/scripts/sync-premium-affiliate-catalog-titles.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(adsDir, "..", "..");
const catalogPath = path.join(repoRoot, "assets", "iu-affiliate-catalog.js");
const outPath = path.join(adsDir, "src", "premium-affiliate-catalog-titles.ts");

const src = fs.readFileSync(catalogPath, "utf8");
const re = /\bid:\s*"(aff-[a-z0-9-]+)"[\s\S]*?\btitle:\s*"([^"]+)"/g;
const titles = {};
let m;
while ((m = re.exec(src)) !== null) {
  titles[m[1]] = m[2];
}

const lines = Object.keys(titles)
  .sort()
  .map((id) => '  "' + id + '": ' + JSON.stringify(titles[id]) + ",");

const file =
  "/**\n" +
  " * Public section titles — synced from assets/iu-affiliate-catalog.js (InfoUzel.cz source of truth).\n" +
  " * Regenerate when catalog titles change: node scripts/sync-premium-affiliate-catalog-titles.mjs\n" +
  " */\n" +
  "export const PREMIUM_AFFILIATE_CATEGORY_TITLES_CS: Readonly<Record<string, string>> = {\n" +
  lines.join("\n") +
  "\n};\n";

fs.writeFileSync(outPath, file, "utf8");
process.stdout.write("SYNC_OK=" + Object.keys(titles).length + "\n");
process.stdout.write("OUT=" + outPath + "\n");
