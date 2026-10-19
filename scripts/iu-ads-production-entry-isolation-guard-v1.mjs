#!/usr/bin/env node
/**
 * Ensures production Worker entry (index-production.ts) does not wire CJ affiliate archive routes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adsSrc = path.join(repoRoot, "cloudflare", "iu-ads", "src");
const indexProd = path.join(adsSrc, "index-production.ts");
const indexMain = path.join(adsSrc, "index.ts");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

if (!fs.existsSync(indexProd)) {
  console.error("IU_ADS_PRODUCTION_ENTRY_ISOLATION_GUARD=FAIL missing index-production.ts");
  process.exit(1);
}

const prodText = read(indexProd);
const indexText = read(indexMain);

if (
  /from\s+["'][^"']*admin-affiliate-archive/.test(prodText) ||
  /from\s+["'][^"']*affiliate-ad-archive/.test(prodText) ||
  /from\s+["'][^"']*index-cj-affiliate-archive/.test(prodText)
) {
  console.error("IU_ADS_PRODUCTION_ENTRY_ISOLATION_GUARD=FAIL index-production.ts imports CJ archive modules");
  process.exit(1);
}

if (/\/v1\/admin\/affiliate-archive/.test(indexText)) {
  console.error("IU_ADS_PRODUCTION_ENTRY_ISOLATION_GUARD=FAIL index.ts exposes affiliate-archive routes");
  process.exit(1);
}

if (/from\s+["']\.\/admin-affiliate-archive/.test(indexText)) {
  console.error("IU_ADS_PRODUCTION_ENTRY_ISOLATION_GUARD=FAIL index.ts imports admin-affiliate-archive");
  process.exit(1);
}

console.log("IU_ADS_PRODUCTION_ENTRY_ISOLATION_GUARD=PASS");
