/**
 * Read-only production D1 verification for migration 0024 partial unique index.
 * Requires wrangler auth (CLOUDFLARE_ADS_API_TOKEN or CLOUDFLARE_API_TOKEN) and
 * wrangler.toml database_id patched to the remote iu-ads database (Deploy IU Ads step).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const WRANGLER_CWD = join(ROOT, "cloudflare", "iu-ads");
const INDEX_NAME = "idx_premium_selected_orders_pending_placement";
const EXPECTED_FRAGMENT =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_premium_selected_orders_pending_placement";

function runD1Json(sql) {
  const args = ["wrangler", "d1", "execute", "iu-ads", "--remote", "--json", "--command", sql];
  const r = spawnSync("npx", args, {
    cwd: WRANGLER_CWD,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
    console.error("WRANGLER_D1_EXECUTE_ERROR=" + err.slice(0, 800));
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(r.stdout);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first?.results ?? [];
  } catch {
    console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
    console.error("WRANGLER_D1_JSON_PARSE=FAIL");
    process.exit(1);
  }
}

const migSql = readFileSync(
  join(WRANGLER_CWD, "migrations", "0024_premium_pending_placement_unique.sql"),
  "utf8"
);
if (!migSql.includes(EXPECTED_FRAGMENT)) {
  console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
  console.error("REPO_MIGRATION_0024_INDEX_DECL=MISSING");
  process.exit(1);
}

const indexRows = runD1Json(
  `SELECT name, type, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = '${INDEX_NAME}';`
);
if (!indexRows.length || indexRows[0]?.name !== INDEX_NAME) {
  console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
  console.error("PROD_INDEX_PRESENT=false");
  process.exit(1);
}
const indexSql = String(indexRows[0]?.sql || "");
const indexChecks = [
  [/UNIQUE/i.test(indexSql), "unique"],
  [/premium_selected_orders/i.test(indexSql), "table"],
  [/placement_id/i.test(indexSql), "column"],
  [/workflow_status/i.test(indexSql), "partial_status"],
  [/'submitted'/.test(indexSql) && /'under_review'/.test(indexSql), "partial_values"],
];
for (const [ok, label] of indexChecks) {
  if (!ok) {
    console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
    console.error("PROD_INDEX_SHAPE=" + label);
    process.exit(1);
  }
}

const schemaRow = runD1Json(
  "SELECT value FROM system_settings WHERE key = 'SCHEMA_VERSION' LIMIT 1;"
);
const schemaVersion = schemaRow[0]?.value ? String(schemaRow[0].value) : "";
if (schemaVersion !== "0024") {
  console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
  console.error("PROD_SCHEMA_VERSION=" + (schemaVersion || "missing"));
  process.exit(1);
}

const collisionRows = runD1Json(
  `SELECT placement_id, COUNT(*) AS pending_count
   FROM premium_selected_orders
   WHERE workflow_status IN ('submitted', 'under_review')
   GROUP BY placement_id
   HAVING COUNT(*) > 1;`
);
if (collisionRows.length > 0) {
  console.error("IU_ADS_PROD_D1_VERIFY=FAIL");
  console.error("PENDING_PLACEMENT_COLLISIONS=" + String(collisionRows.length));
  process.exit(1);
}

console.log("IU_ADS_PROD_D1_VERIFY=PASS");
console.log("PROD_D1_DATABASE_NAME=iu-ads");
console.log("PROD_D1_BINDING=DB");
console.log("PROD_INDEX_PRESENT=true");
console.log("PROD_SCHEMA_VERSION=0024");
console.log("PENDING_PLACEMENT_COLLISIONS=0");
