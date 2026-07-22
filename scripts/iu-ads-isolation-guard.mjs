/**
 * Static isolation guard for InfoUzel Ads foundation.
 * Ensures ads schema stays separated from analytics aggregates.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = join(root, "cloudflare", "iu-ads", "migrations", "0001_init.sql");
const matrixPath = join(root, "docs", "ads-system", "01-traceability-matrix.json");

const forbidden = [
  "daily_traffic",
  "daily_sections",
  "daily_performance",
  "daily_errors",
  "daily_ads",
  "ingest_audit",
];

const sql = readFileSync(sqlPath, "utf8").toLowerCase();
let failed = false;

for (const table of forbidden) {
  if (sql.includes("create table if not exists " + table) || sql.includes("create table " + table + " ")) {
    console.log("FAIL: ads schema defines analytics table " + table);
    failed = true;
  }
}

const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const ids = new Set((matrix.chapters || []).map((c) => c.id));
if (!ids.has("goal")) {
  console.log("FAIL: matrix missing goal");
  failed = true;
}
for (let i = 1; i <= 48; i++) {
  if (!ids.has(String(i))) {
    console.log("FAIL: matrix missing chapter " + i);
    failed = true;
  }
}

if (!sql.includes("password_hash") || !sql.includes("code_hash")) {
  console.log("FAIL: expected password_hash and code_hash columns");
  failed = true;
}

if (failed) {
  console.log("IU_ADS_ISOLATION_GUARD=FAIL");
  process.exit(1);
}
console.log("IU_ADS_ISOLATION_GUARD=PASS");
