#!/usr/bin/env node
/**
 * Legacy SQL generator for main_admin bootstrap — DEPRECATED for remote apply.
 * Cloudflare D1 remote execute rejects BEGIN TRANSACTION / SAVEPOINT.
 * Production path: Worker POST /v1/internal/bootstrap/main-admin + D1 batch().
 *
 * This script still validates email/TTL and can emit SQL WITHOUT explicit transactions
 * for offline inspection only. It refuses to write files containing BEGIN/COMMIT/SAVEPOINT.
 */
import { webcrypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const crypto = webcrypto;
const ITERATIONS = 100_000;

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return "";
  return String(process.argv[idx + 1] || "");
}

function toHex(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

function sqlQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assertNoExplicitTxn(sql) {
  const upper = String(sql || "").toUpperCase();
  if (/\bBEGIN\b/.test(upper) || /\bCOMMIT\b/.test(upper) || /\bROLLBACK\b/.test(upper) || /\bSAVEPOINT\b/.test(upper)) {
    throw new Error("unsupported_explicit_sql_transaction");
  }
}

async function hashPassword(password, pepper) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = toHex(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password + "|" + pepper),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    keyMaterial,
    256
  );
  return "pbkdf2$" + ITERATIONS + "$" + saltHex + "$" + toHex(bits);
}

async function hashOpaqueToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(digest);
}

function randomToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return toHex(a);
}

function randomId(prefix) {
  return prefix + "_" + randomToken().slice(0, 24);
}

async function main() {
  const pepper = process.env.ADS_PASSWORD_PEPPER || "";
  const email = normalizeEmail(argValue("--email") || process.env.BOOTSTRAP_ADMIN_EMAIL || "");
  const displayName =
    argValue("--display-name") || process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || "Hlavní administrátor";
  const sqlOut = argValue("--sql-out");
  const activationOut = argValue("--activation-out");
  const baseUrl =
    argValue("--base-url") ||
    process.env.BOOTSTRAP_ADMIN_BASE_URL ||
    "https://infouzel-ads.josef-zmrhal.workers.dev/admin";
  const ttlSec = Number(process.env.BOOTSTRAP_ACTIVATION_TTL_SECONDS || argValue("--ttl") || "3600");

  if (!pepper) {
    console.error("ERROR: ADS_PASSWORD_PEPPER env is required (value never printed).");
    process.exit(2);
  }
  if (!email || !isValidEmail(email)) {
    console.error("ERROR: valid --email / BOOTSTRAP_ADMIN_EMAIL is required.");
    process.exit(3);
  }
  if (!sqlOut || !activationOut) {
    console.error("ERROR: --sql-out and --activation-out are required.");
    process.exit(4);
  }
  if (!Number.isFinite(ttlSec) || ttlSec < 300 || ttlSec > 86400) {
    console.error("ERROR: activation TTL must be between 300 and 86400 seconds.");
    process.exit(5);
  }

  const userId = randomId("usr");
  const resetId = randomId("rst");
  const auditId = randomId("aud");
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + ttlSec * 1000).toISOString();

  const throwawayPassword = randomToken() + "A1!" + randomToken();
  const passwordHash = await hashPassword(throwawayPassword, pepper);
  const activationToken = randomToken();
  const tokenHash = await hashOpaqueToken(activationToken);

  // NO BEGIN/COMMIT — D1 remote execute rejects explicit SQL transactions.
  // Production must use Worker batch bootstrap; this SQL is inspection-only.
  const sql = [
    "-- iu-ads bootstrap SQL (INSPECTION ONLY — do not wrangler d1 execute remotely)",
    "-- Prefer Worker POST /v1/internal/bootstrap/main-admin with D1 batch().",
    "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at)",
    "VALUES (" +
      [
        sqlQuote(userId),
        sqlQuote(email),
        sqlQuote(passwordHash),
        sqlQuote(displayName),
        "1",
        "1",
        sqlQuote(nowIso),
        sqlQuote(nowIso),
      ].join(", ") +
      ");",
    "INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by)",
    "VALUES (" + [sqlQuote(userId), sqlQuote("main_admin"), sqlQuote(nowIso), sqlQuote("bootstrap")].join(", ") + ");",
    "INSERT INTO admin_password_resets (reset_id, user_id, token_hash, created_at, expires_at, used_at)",
    "VALUES (" +
      [sqlQuote(resetId), sqlQuote(userId), sqlQuote(tokenHash), sqlQuote(nowIso), sqlQuote(expiresIso), "NULL"].join(", ") +
      ");",
    "INSERT INTO audit_logs (audit_id, created_at, actor_user_id, operation, object_type, object_id, before_json, after_json, result)",
    "VALUES (" +
      [
        sqlQuote(auditId),
        sqlQuote(nowIso),
        sqlQuote(userId),
        sqlQuote("main_admin_bootstrap_created"),
        sqlQuote("admin_user"),
        sqlQuote(userId),
        "NULL",
        sqlQuote(JSON.stringify({ email: email, role: "main_admin", activation: "one_time_token", ttl_seconds: ttlSec })),
        sqlQuote("success"),
      ].join(", ") +
      ");",
    "INSERT INTO system_settings (key, value, updated_at) VALUES ('BOOTSTRAP_COMPLETED', '1', " +
      sqlQuote(nowIso) +
      ")",
    "  ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at;",
    "",
  ].join("\n");

  assertNoExplicitTxn(sql);

  const activationUrl =
    baseUrl.replace(/\/$/, "") +
    "?activate=" +
    encodeURIComponent(activationToken) +
    "&email=" +
    encodeURIComponent(email);

  writeFileSync(sqlOut, sql, { encoding: "utf8", mode: 0o600 });
  writeFileSync(
    activationOut,
    [
      "# InfoUzel Ads — inspection-only activation sample (production uses Worker bootstrap response)",
      "# Platnost do: " + expiresIso,
      "",
      activationUrl,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 }
  );

  console.log("BOOTSTRAP_SQL_WRITTEN=1");
  console.log("BOOTSTRAP_SQL_TXN=none");
  console.log("BOOTSTRAP_REMOTE_APPLY=deprecated_use_worker_batch");
  console.log("BOOTSTRAP_ACTIVATION_FILE_WRITTEN=1");
  console.log("BOOTSTRAP_ADMIN_EMAIL_SET=1");
  console.log("BOOTSTRAP_USER_ID_PREFIX=" + userId.slice(0, 8));
  console.log("BOOTSTRAP_ACTIVATION_EXPIRES_AT=" + expiresIso);
  console.log("BOOTSTRAP_STATUS=READY_FOR_WORKER_BATCH");
}

main().catch((err) => {
  console.error("ERROR: bootstrap script failed.");
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
