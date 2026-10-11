#!/usr/bin/env node
/**
 * Production operator reset — calls POST /v1/admin/premium/test-data/reset (main admin, read-write).
 * Requires IU_PREMIUM_TEST_RESET_APPROVED=1 and exact confirm phrase.
 */
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADS_PUBLIC_ORIGIN } from "../public-origin.mjs";
const PREMIUM_TEST_RESET_CONFIRM_PHRASE = "VYMAZAT TESTOVACI DATA";

const BASE = process.env.ADS_BASE_URL || ADS_PUBLIC_ORIGIN;
const PEPPER = process.env.ADS_PASSWORD_PEPPER || "";
const RUN = "testReset" + Date.now().toString(36);
const USER_ID = "IU_TEST_main_" + RUN;
const EMAIL = ("iu.test.main.reset." + RUN + "@example.invalid").toLowerCase();
const NOW = new Date().toISOString();

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
}

async function d1Exec(sql) {
  const file = join(tmpdir(), "iu-test-reset-" + RUN + ".sql");
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

function cookieHeaderFromSetCookie(setCookieHeaders) {
  const parts = [];
  for (const raw of setCookieHeaders || []) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first);
  }
  return parts.join("; ");
}

async function main() {
  if (process.env.IU_PREMIUM_TEST_RESET_APPROVED !== "1") {
    console.error("BLOCKED=set IU_PREMIUM_TEST_RESET_APPROVED=1");
    process.exit(2);
  }
  if (!PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    console.error("MISSING=secrets");
    process.exit(2);
  }

  resolveAdsDatabaseId();

  const password = generatePassword();
  const passwordHash = hashPassword(password, PEPPER);
  await d1Exec(
    [
      "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (",
      "'" + USER_ID + "',",
      "'" + EMAIL + "',",
      "'" + passwordHash.replace(/'/g, "''") + "',",
      "'IU_TEST Reset " + RUN.replace(/'/g, "''") + "',",
      "1, 0,",
      "'" + NOW + "',",
      "'" + NOW + "'",
      ");",
      "INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (",
      "'" + USER_ID + "', 'main_admin', '" + NOW + "', 'IU_TEST_reset');",
    ].join(" ")
  );

  const lr = await fetch(BASE + "/v1/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  if (lr.status !== 200) {
    console.error("LOGIN_FAIL=" + lr.status);
    process.exit(1);
  }
  const sc = typeof lr.headers.getSetCookie === "function" ? lr.headers.getSetCookie() : [];
  const fallback = lr.headers.get("set-cookie");
  const list = sc && sc.length ? sc : fallback ? [fallback] : [];
  const cookie = cookieHeaderFromSetCookie(list);

  const rr = await fetch(BASE + "/v1/admin/premium/test-data/reset", {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirm: true, confirm_phrase: PREMIUM_TEST_RESET_CONFIRM_PHRASE }),
  });
  const body = await rr.json().catch(() => ({}));
  console.log("RESET_HTTP=" + rr.status);
  console.log("RESET_BODY=" + JSON.stringify(body));

  await d1Exec(
    [
      "DELETE FROM admin_sessions WHERE user_id = '" + USER_ID + "';",
      "DELETE FROM admin_user_roles WHERE user_id = '" + USER_ID + "';",
      "DELETE FROM admin_users WHERE user_id = '" + USER_ID + "';",
      "DELETE FROM admin_login_attempts WHERE email_normalized = '" + EMAIL + "';",
    ].join("\n")
  );

  const { execFileSync } = await import("node:child_process");
  const countOut = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "iu-ads",
      "--remote",
      "--command",
      "SELECT (SELECT COUNT(*) FROM premium_selected_orders) AS po, (SELECT COUNT(*) FROM campaigns) AS camps, (SELECT COUNT(*) FROM documents WHERE doc_type LIKE 'premium_%') AS docs",
      "--json",
    ],
    { cwd: join(process.cwd()), env: process.env, encoding: "utf8" }
  );
  console.log("POST_RESET_COUNTS=" + countOut.trim());
  if (!rr.ok || body.ok !== true) process.exit(1);
  console.log("OVERALL=PASS");
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
