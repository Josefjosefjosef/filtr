/**
 * Blocks dangerous D1 migration changes to premium selected catalog / orders before merge.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.join(ROOT, "cloudflare/iu-ads/migrations");
const failures = [];

function must(cond, msg) {
  if (!cond) failures.push(msg);
}

function readMigrations() {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/i.test(f))
    .sort();
  const parts = files.map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  return { files, combined: parts.join("\n"), byFile: Object.fromEntries(files.map((f, i) => [f, parts[i]])) };
}

const { files, combined, byFile } = readMigrations();

must(files.length >= 24, "expected migration 0024 (pending placement unique) in repo");

const cjArchiveInStandard = files.filter((f) => /^002[5-9]_affiliate_ad_archive/i.test(f));
must(
  cjArchiveInStandard.length === 0,
  "CJ affiliate archive migrations must live under cloudflare/iu-ads/migrations-cj-affiliate-archive/ (found in migrations/: " +
    cjArchiveInStandard.join(", ") +
    ")"
);

for (const [file, sql] of Object.entries(byFile)) {
  const upper = sql.toUpperCase();
  if (/DROP\s+TABLE\s+PREMIUM_SELECTED_(PLACEMENTS|ORDERS|CATEGORIES)/i.test(sql)) {
    must(/_BACKUP/i.test(sql) || /0015_premium_eight_positions/i.test(file), `${file}: DROP premium selected table without backup migration pattern`);
  }
  if (/ALTER\s+TABLE\s+PREMIUM_SELECTED_PLACEMENTS/i.test(upper) && /DROP\s+COLUMN\s+CURRENT_PRICE_CENTS/i.test(upper)) {
    failures.push(`${file}: must not drop current_price_cents on premium_selected_placements`);
  }
  if (/DELETE\s+FROM\s+PREMIUM_SELECTED_PLACEMENTS/i.test(upper) && !/WHERE/i.test(upper)) {
    failures.push(`${file}: unqualified DELETE FROM premium_selected_placements`);
  }
  if (/UPDATE\s+PREMIUM_SELECTED_PLACEMENTS\s+SET\s+CURRENT_PRICE_CENTS/i.test(upper) && !/0013_|0014_|0015_/i.test(file)) {
    failures.push(`${file}: bulk price rewrite on placements outside seed migrations`);
  }
}

must(
  /idx_premium_selected_orders_pending_placement/i.test(combined),
  "missing partial unique index idx_premium_selected_orders_pending_placement (0024)"
);
must(/idx_premium_selected_placements_cat_pos/i.test(combined), "missing placement category/position unique index");
must(/CREATE TABLE premium_selected_orders/i.test(combined), "premium_selected_orders table definition missing");
must(/FOREIGN KEY \(order_id\) REFERENCES orders\(order_id\)/i.test(combined), "premium orders FK to orders missing");

if (failures.length) {
  console.error("IU_ADS_MIGRATION_SCHEMA_COMPAT_GUARD=FAIL");
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log("IU_ADS_MIGRATION_SCHEMA_COMPAT_GUARD=PASS");
