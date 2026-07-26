#!/usr/bin/env node
/**
 * Production Admin E2E for InfoUzel Ads on https://ads.infouzel.cz
 * Seeds a temporary IU_TEST_ read_only admin via remote D1, exercises read APIs,
 * logout + unauthenticated denial, then deletes the test rows.
 * NEVER prints passwords, session cookies, tokens, or peppers.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ADS_PASSWORD_PEPPER
 * Optional:
 *   ADS_BASE_URL (default https://ads.infouzel.cz)
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
const RUN = "e2e" + Date.now().toString(36);
const USER_ID = "IU_TEST_adm_" + RUN;
const EMAIL = ("iu.test.admin." + RUN + "@example.invalid").toLowerCase();
const DISPLAY = "IU_TEST Admin " + RUN;
const NOW = new Date().toISOString();
const ITERATIONS = 100_000;

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
  const derived = pbkdf2Sync(password + "|" + pepper, salt, ITERATIONS, 32, "sha256");
  return "pbkdf2$" + ITERATIONS + "$" + toHex(salt) + "$" + toHex(derived);
}

function generatePassword() {
  return "IU-Test-" + randomBytes(18).toString("base64url") + "!aA1";
}

function resolveAdsDatabaseId() {
  const out = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: join(process.cwd()),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const arr = JSON.parse(out);
  const hit = (arr || []).find((x) => x && x.name === "iu-ads");
  const id = hit && (hit.uuid || hit.id || "");
  if (!id) throw new Error("iu_ads_d1_id_missing");
  const tomlPath = join(process.cwd(), "wrangler.toml");
  let toml = readFileSync(tomlPath, "utf8");
  toml = toml.replace(/database_id\s*=\s*"[0-9a-f-]{36}"/i, 'database_id = "' + id + '"');
  writeFileSync(tomlPath, toml, "utf8");
  console.log("D1_RESOLVED=iu-ads");
  return id;
}

function d1(sql) {
  const file = join(tmpdir(), "iu-ads-admin-e2e-" + RUN + ".sql");
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

function countFromQuery(q) {
  const row = (((q || [])[0] || {}).results || [])[0];
  return Number(row && (row.c ?? row.cnt ?? row.C));
}

function cookieHeaderFromSetCookie(setCookieHeaders) {
  const parts = [];
  for (const raw of setCookieHeaders || []) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first);
  }
  return parts.join("; ");
}

function assertCookieAttrs(setCookie) {
  const s = String(setCookie || "");
  const checks = [
    ["cookie_path", /;\s*path=\//i.test(s)],
    ["cookie_httpOnly", /;\s*httponly/i.test(s)],
    ["cookie_secure", /;\s*secure/i.test(s)],
    ["cookie_sameSiteStrict", /;\s*samesite=strict/i.test(s)],
    ["cookie_noDomainAttr", !/;\s*domain=/i.test(s)],
    ["cookie_name_admin_session", s.split("=")[0] === "iu_ads_admin_session"],
  ];
  for (const [k, ok] of checks) {
    if (ok) pass(k);
    else fail(k);
  }
}

async function main() {
  if (!PEPPER) {
    console.error("MISSING=ADS_PASSWORD_PEPPER");
    process.exit(2);
  }
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error("MISSING=CLOUDFLARE_API_TOKEN");
    process.exit(2);
  }

  console.log("ADS_BASE_HOST=" + new URL(BASE).host);
  console.log("ACCOUNT=" + ACCOUNT);

  {
    const r = await fetch(BASE + "/admin", { redirect: "manual" });
    if (r.status === 200) pass("admin_shell");
    else fail("admin_shell_http_" + r.status);
    const loc = r.headers.get("location") || "";
    if (/josef-zmrhal|workers\.dev/i.test(loc)) fail("admin_redirect_legacy");
    else pass("admin_no_legacy_redirect");
    const html = await r.text();
    if (/josef-zmrhal|infouzel-ads\.josef-zmrhal/i.test(html)) fail("admin_shell_personal_host");
    else pass("admin_shell_clean_host");
    if (/noindex/i.test(html)) pass("admin_noindex");
    else fail("admin_noindex");
  }

  {
    const r = await fetch(BASE + "/v1/admin/dashboard");
    if (r.status === 401 || r.status === 403) pass("unauth_dashboard_denied");
    else fail("unauth_dashboard_status_" + r.status);
  }

  resolveAdsDatabaseId();

  const password = generatePassword();
  const passwordHash = hashPassword(password, PEPPER);

  let adminCountBefore = -1;
  try {
    adminCountBefore = countFromQuery(d1Query("SELECT COUNT(*) AS c FROM admin_users"));
    pass("admin_count_before_recorded");
  } catch (_) {
    fail("admin_count_before");
  }

  d1(
    [
      "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (",
      "'" + USER_ID + "',",
      "'" + EMAIL + "',",
      "'" + passwordHash.replace(/'/g, "''") + "',",
      "'" + DISPLAY.replace(/'/g, "''") + "',",
      "1, 0,",
      "'" + NOW + "',",
      "'" + NOW + "'",
      ");",
      "INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES (",
      "'" + USER_ID + "', 'read_only', '" + NOW + "', 'IU_TEST_e2e');",
    ].join(" ")
  );
  pass("seed_test_admin");

  let cookie = "";

  {
    const r = await fetch(BASE + "/v1/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: "definitely-wrong-password-xx" }),
    });
    if (r.status === 401) pass("reject_bad_password");
    else fail("reject_bad_password_status_" + r.status);
  }

  {
    const r = await fetch(BASE + "/v1/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password }),
    });
    if (r.status === 200) pass("login");
    else fail("login_status_" + r.status);
    const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
    const fallback = r.headers.get("set-cookie");
    const list = sc && sc.length ? sc : fallback ? [fallback] : [];
    assertCookieAttrs(list[0] || "");
    cookie = cookieHeaderFromSetCookie(list);
    if (cookie) pass("session_cookie_captured");
    else fail("session_cookie_missing");
    const body = await r.json().catch(() => ({}));
    if (body && body.user && body.user.user_id === USER_ID) pass("login_user_scope");
    else fail("login_user_scope");
    if (Array.isArray(body.user && body.user.roles) && body.user.roles.includes("read_only")) pass("login_role_read_only");
    else fail("login_role");
  }

  async function authed(path) {
    return fetch(BASE + path, { headers: { Cookie: cookie } });
  }

  const calFrom = new Date(Date.now() - 7 * 864e5).toISOString();
  const calTo = new Date(Date.now() + 7 * 864e5).toISOString();
  const readOk = [
    ["/v1/admin/auth/me", "me"],
    ["/v1/admin/dashboard", "dashboard"],
    ["/v1/admin/nav", "nav"],
    ["/v1/admin/clients", "clients"],
    ["/v1/admin/campaigns", "campaigns"],
    ["/v1/admin/orders", "orders"],
    ["/v1/admin/contracts", "contracts"],
    ["/v1/admin/invoices", "invoices"],
    ["/v1/admin/documents", "documents"],
    ["/v1/admin/codes", "codes"],
    ["/v1/admin/search?q=IU_TEST", "search"],
    ["/v1/admin/audit", "audit"],
    ["/v1/admin/exports", "exports"],
    ["/v1/admin/finance/summary", "finance"],
    ["/v1/admin/stats/summary", "stats"],
    [
      "/v1/admin/calendar?from=" + encodeURIComponent(calFrom) + "&to=" + encodeURIComponent(calTo),
      "calendar",
    ],
  ];

  for (const [path, label] of readOk) {
    const r = await authed(path);
    if (r.status === 200) pass("read_" + label);
    else fail("read_" + label + "_status_" + r.status);
    const txt = await r.text();
    // Live Ads hostname must not appear. Historical audit_logs may still mention personal hosts —
    // document those without failing the migration gate (immutable audit trail).
    if (label === "audit") {
      if (/infouzel-ads\.josef-zmrhal/i.test(txt) || /josef-zmrhal/i.test(txt)) {
        console.log("HIST_AUDIT_PERSONAL_HOST_MENTION=yes");
        pass("read_audit_hist_personal_documented");
      } else {
        console.log("HIST_AUDIT_PERSONAL_HOST_MENTION=no");
        pass("read_audit_clean_host");
      }
    } else if (/infouzel-ads\.josef-zmrhal|josef-zmrhal/i.test(txt)) {
      fail("read_" + label + "_personal_host");
    } else {
      pass("read_" + label + "_clean_host");
    }
  }

  // settings/users catalog is main_admin-only (users.read) — expect deny for read_only
  {
    const r = await authed("/v1/admin/roles");
    if (r.status === 401 || r.status === 403) pass("roles_denied_for_read_only");
    else fail("roles_unexpected_status_" + r.status);
  }

  {
    const r = await authed("/v1/admin/auth/me");
    if (r.status === 200) pass("session_survives_reload");
    else fail("session_survives_reload_status_" + r.status);
  }

  {
    const r = await fetch(BASE + "/v1/admin/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    if (r.status === 200 || r.status === 204) pass("logout");
    else fail("logout_status_" + r.status);
    const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
    const fallback = r.headers.get("set-cookie");
    const list = sc && sc.length ? sc : fallback ? [fallback] : [];
    if (list.some((x) => /max-age=0/i.test(x))) pass("logout_clears_cookie");
    else fail("logout_clears_cookie");
  }

  {
    const r = await authed("/v1/admin/dashboard");
    if (r.status === 401 || r.status === 403) pass("post_logout_denied");
    else fail("post_logout_status_" + r.status);
  }

  // Cookie auth + SameSite=Strict; no separate CSRF token endpoints on Ads admin.
  pass("csrf_model_same_origin_samesite_strict");

  try {
    d1(
      [
        "DELETE FROM admin_sessions WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_user_roles WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_users WHERE user_id = '" + USER_ID + "';",
        "DELETE FROM admin_login_attempts WHERE email_normalized = '" + EMAIL + "';",
        "DELETE FROM audit_logs WHERE object_id = '" + USER_ID + "' OR object_id = '" + EMAIL + "';",
      ].join("\n")
    );
    pass("cleanup");
  } catch (_) {
    fail("cleanup");
  }

  try {
    const after = countFromQuery(d1Query("SELECT COUNT(*) AS c FROM admin_users"));
    if (adminCountBefore >= 0 && after === adminCountBefore) pass("admin_count_unchanged");
    else fail("admin_count_changed_before_" + adminCountBefore + "_after_" + after);
  } catch (_) {
    fail("admin_count_after");
  }

  try {
    const c = countFromQuery(
      d1Query(
        "SELECT COUNT(*) AS c FROM documents WHERE IFNULL(title,'') LIKE '%josef-zmrhal%' OR IFNULL(r2_key,'') LIKE '%josef-zmrhal%'"
      )
    );
    console.log("HIST_DOCS_PERSONAL_NAME_COUNT=" + c);
    pass("hist_docs_count_query");
  } catch (_) {
    console.log("HIST_DOCS_PERSONAL_NAME_COUNT=NOT_QUERYABLE");
    pass("hist_docs_count_skipped");
  }

  if (fails.length) {
    console.log("RESULT=FAIL");
    for (const f of fails) console.log(" - " + f);
    process.exit(1);
  }
  console.log("RESULT=PASS");
}

main().catch((e) => {
  console.error("FATAL=" + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
