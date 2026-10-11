#!/usr/bin/env node
/**
 * Read-only production purge diagnostics for one premium order (by customer_order_code).
 * Seeds ephemeral main_admin, calls GET purge-diagnostics, verifies campaign_status_events table exists.
 * Never prints passwords, session cookies, or peppers.
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ADS_PASSWORD_PEPPER, ADS_BASE_URL
 *      IU_PURGE_DIAG_ORDER_CODE (required, e.g. IU-26-DGRF-U8B2)
 */
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADS_PUBLIC_ORIGIN } from "../public-origin.mjs";

const BASE = process.env.ADS_BASE_URL || ADS_PUBLIC_ORIGIN;
const PEPPER = process.env.ADS_PASSWORD_PEPPER || "";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "577868e9aac9c289e9323100f68fad16";
const ORDER_CODE = String(process.env.IU_PURGE_DIAG_ORDER_CODE || "").trim();
const RUN = "purgeDiag" + Date.now().toString(36);
const USER_ID = "IU_TEST_main_" + RUN;
const EMAIL = ("iu.test.main." + RUN + "@example.invalid").toLowerCase();
const NOW = new Date().toISOString();

const fails = [];
function pass(m) {
  console.log("PASS " + m);
}
function fail(m) {
  fails.push(m);
  console.log("FAIL " + m);
}

function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

function hashPassword(password, pepper) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password + "|" + pepper, salt, 100_000, 32, "sha256");
  return "pbkdf2$100000$" + toHex(salt) + "$" + toHex(derived);
}

function generatePassword() {
  return "IU-Test-" + randomBytes(18).toString("base64url") + "!aA1";
}

function resolveAdsDatabaseId() {
  const out = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: join(process.cwd()),
    env: process.env,
    encoding: "utf8",
  });
  const arr = JSON.parse(out);
  const hit = (arr || []).find((x) => x && x.name === "iu-ads");
  const id = hit && (hit.uuid || hit.id || "");
  if (!id) throw new Error("iu_ads_d1_id_missing");
  const tomlPath = join(process.cwd(), "wrangler.toml");
  let toml = readFileSync(tomlPath, "utf8");
  toml = toml.replace(/database_id\s*=\s*"[0-9a-f-]{36}"/i, 'database_id = "' + id + '"');
  writeFileSync(tomlPath, toml, "utf8");
  return id;
}

function d1(sql) {
  const file = join(tmpdir(), "iu-purge-diag-" + RUN + ".sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "iu-ads", "--remote", "--file", file], {
      cwd: join(process.cwd()),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } finally {
    try {
      unlinkSync(file);
    } catch (_) {}
  }
}

function d1Query(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "iu-ads", "--remote", "--command", sql, "--json"],
    {
      cwd: join(process.cwd()),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    }
  );
  return JSON.parse(out);
}

function rowsFromQuery(q) {
  return (((q || [])[0] || {}).results || []).slice();
}

function cookieHeaderFromSetCookie(setCookieHeaders) {
  const parts = [];
  for (const raw of setCookieHeaders || []) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first);
  }
  return parts.join("; ");
}

async function main() {
  if (!ORDER_CODE) {
    console.error("MISSING=IU_PURGE_DIAG_ORDER_CODE");
    process.exit(2);
  }
  if (!PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error("MISSING=secrets");
    process.exit(2);
  }

  console.log("PURGE_DIAG_ORDER_CODE=" + ORDER_CODE);
  console.log("ADS_BASE_HOST=" + new URL(BASE).host);

  resolveAdsDatabaseId();

  const schemaProbe = rowsFromQuery(
    d1Query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('campaign_status_events','campaign_state_events')"
    )
  );
  const tableNames = schemaProbe.map((r) => r.name);
  console.log("SCHEMA_TABLES=" + tableNames.join(","));
  if (tableNames.includes("campaign_status_events")) pass("schema_campaign_status_events");
  else fail("schema_campaign_status_events");
  if (tableNames.includes("campaign_state_events")) fail("schema_erroneous_campaign_state_events");
  else pass("schema_no_campaign_state_events");

  const orderRows = rowsFromQuery(
    d1Query(
      "SELECT o.order_id, o.customer_order_code, o.status AS order_status, po.published_campaign_id, po.workflow_status " +
        "FROM orders o JOIN premium_selected_orders po ON po.order_id = o.order_id " +
        "WHERE o.customer_order_code = '" +
        ORDER_CODE.replace(/'/g, "''") +
        "' LIMIT 1"
    )
  );
  if (!orderRows.length) {
    fail("order_not_found_in_d1");
    process.exit(1);
  }
  const orderId = String(orderRows[0].order_id);
  console.log("ORDER_ID=" + orderId);
  console.log("ORDER_STATUS=" + String(orderRows[0].order_status));
  console.log("WORKFLOW_STATUS=" + String(orderRows[0].workflow_status));
  console.log("PUBLISHED_CAMPAIGN_ID=" + String(orderRows[0].published_campaign_id || ""));

  const password = generatePassword();
  const passwordHash = hashPassword(password, PEPPER);
  d1(
    [
      "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (",
      "'" + USER_ID + "',",
      "'" + EMAIL + "',",
      "'" + passwordHash.replace(/'/g, "''") + "',",
      "'IU_TEST Main " + RUN.replace(/'/g, "''") + "',",
      "1, 0,",
      "'" + NOW + "',",
      "'" + NOW + "'",
      ");",
      "INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (",
      "'" + USER_ID + "', 'main_admin', '" + NOW + "', 'IU_TEST_purge_diag');",
    ].join(" ")
  );
  pass("seed_temp_main_admin");

  let cookie = "";
  {
    const r = await fetch(BASE + "/v1/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password }),
    });
    if (r.status !== 200) {
      fail("main_admin_login_" + r.status);
      process.exit(1);
    }
    pass("main_admin_login");
    const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
    const fallback = r.headers.get("set-cookie");
    const list = sc && sc.length ? sc : fallback ? [fallback] : [];
    cookie = cookieHeaderFromSetCookie(list);
  }

  const diagUrl = BASE + "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/purge-diagnostics";
  const dr = await fetch(diagUrl, { headers: { Cookie: cookie } });
  console.log("PURGE_DIAG_HTTP=" + dr.status);
  const body = await dr.json().catch(() => ({}));
  if (dr.status === 200 && body.ok === true) {
    pass("purge_diagnostics_api");
    console.log("PURGE_DIAG_JSON=" + JSON.stringify(body));
  } else {
    fail("purge_diagnostics_api");
    console.log("PURGE_DIAG_BODY=" + JSON.stringify(body));
  }

  try {
    d1(
      [
        "DELETE FROM admin_sessions WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_user_roles WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_users WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_login_attempts WHERE email_normalized = '" + EMAIL + "';",
      ].join("\n")
    );
    pass("temp_main_admin_cleanup");
  } catch (_) {
    fail("temp_main_admin_cleanup");
  }

  if (fails.length) {
    console.log("OVERALL=FAIL");
    process.exit(1);
  }
  console.log("OVERALL=PASS");
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
