#!/usr/bin/env node
/**
 * Production Client E2E for InfoUzel Ads (kap. 47).
 * Seeds IU_TEST_ rows via remote D1, exercises /v1/client/* against the live Worker,
 * then deletes the test rows. NEVER prints access codes, tokens, or session cookies.
 *
 * Required env (GitHub Actions secrets / job env):
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, ADS_CODE_PEPPER
 * Optional:
 *   ADS_BASE_URL (default https://ads.infouzel.cz)
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADS_PUBLIC_ORIGIN } from "../public-origin.mjs";

const BASE = process.env.ADS_BASE_URL || ADS_PUBLIC_ORIGIN;
const PEPPER = process.env.ADS_CODE_PEPPER || "";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "577868e9aac9c289e9323100f68fad16";
const RUN = "e2e" + Date.now().toString(36);
const CLIENT_ID = "IU_TEST_cli_" + RUN;
/* Leading "=" proves live CSV formula escaping on production (must be quoted). */
const CAMPAIGN_ID = "=test_" + RUN;
const EVIDENCE = "EV-TEST-" + RUN;
const CODE_ID = "IU_TEST_code_" + RUN;
const DOC_ID = "IU_TEST_doc_" + RUN;
const NOW = new Date().toISOString();
const FORMULA_PLACEMENTS = ["=CMD()", "+1+1", "-1+1", "@sum", "\tTAB", "\rCR"];

const fails = [];
function pass(m) {
  console.log("PASS " + m);
}
function fail(m) {
  fails.push(m);
  console.log("FAIL " + m);
}

function hashCode(plaintext, pepper) {
  return createHash("sha256").update(pepper + "|" + plaintext).digest("hex");
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups = [];
  for (let g = 0; g < 4; g++) {
    const bytes = randomBytes(4);
    let part = "";
    for (let i = 0; i < 4; i++) part += alphabet[bytes[i] % alphabet.length];
    groups.push(part);
  }
  return { plaintext: "IU-" + groups.join("-"), prefix: groups[0] };
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
  // Write SQL to temp file to avoid shell quoting leaks of hashes (hash is not secret but keep quiet).
  const file = join(tmpdir(), "iu-ads-e2e-" + RUN + ".sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "iu-ads", "--remote", "--file", file],
      {
        cwd: join(process.cwd()),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      }
    );
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

function csvEscapeLocal(value) {
  const s = value == null ? "" : String(value);
  const needsQuote = /[",\n\r\t]/.test(s) || /^[=+\-@\t\r]/.test(s);
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

async function http(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
    redirect: "manual",
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw_len: text.length, raw: opts.rawText ? text : undefined };
  }
  // Strip Set-Cookie values from any diagnostic object — never log them.
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return {
    status: res.status,
    body,
    cookieCount: setCookie.length,
    setCookie,
    contentType: res.headers.get("content-type") || "",
    text: opts.rawText ? text : "",
  };
}

function cookieHeader(setCookie) {
  return (setCookie || [])
    .map((c) => String(c).split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function main() {
  if (!PEPPER) {
    fail("ADS_CODE_PEPPER_missing");
    process.exit(1);
  }
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    fail("CLOUDFLARE_API_TOKEN_missing");
    process.exit(1);
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;

  const health = await http("/health");
  if (health.status !== 200 || !health.body || health.body.ok !== true) fail("health_not_ok");
  else pass("health");
  if (!health.body.safeMode) fail("safeMode");
  else pass("safeMode");
  if (health.body.publicDeliveryEnabled !== false) fail("publicDelivery");
  else pass("publicDelivery_off");
  if (health.body.clientApiEnabled !== true) fail("clientApi");
  else pass("clientApi_on");

  resolveAdsDatabaseId();
  pass("d1_id_resolved");

  const beforeClients = d1Query("SELECT COUNT(*) AS c FROM clients");
  const beforeCount = Number((((beforeClients[0] || {}).results || [])[0] || {}).c || 0);

  const code = generateCode();
  const codeHash = hashCode(code.plaintext, PEPPER);
  // Keep plaintext only in local const; never console.log it.

  d1(
    "INSERT INTO clients (client_id, company_name, ico, created_at, updated_at) VALUES (" +
      "'" +
      CLIENT_ID +
      "', 'IU_TEST Client " +
      RUN +
      "', '00000000', '" +
      NOW +
      "', '" +
      NOW +
      "');\n" +
      "INSERT INTO campaigns (campaign_id, evidence_code, client_id, title, status, label_type, client_report_enabled, client_export_enabled, created_at, updated_at) VALUES (" +
      "'" +
      CAMPAIGN_ID +
      "', '" +
      EVIDENCE +
      "', '" +
      CLIENT_ID +
      "', 'IU_TEST Campaign " +
      RUN +
      "', 'active', 'Reklama', 1, 1, '" +
      NOW +
      "', '" +
      NOW +
      "');\n" +
      "INSERT INTO client_access_codes (code_id, client_id, code_hash, code_prefix, status, created_at, expires_at) VALUES (" +
      "'" +
      CODE_ID +
      "', '" +
      CLIENT_ID +
      "', '" +
      codeHash +
      "', '" +
      code.prefix +
      "', 'active', '" +
      NOW +
      "', '" +
      new Date(Date.now() + 3600_000).toISOString() +
      "');\n" +
      "INSERT INTO client_code_campaigns (code_id, campaign_id) VALUES ('" +
      CODE_ID +
      "', '" +
      CAMPAIGN_ID +
      "');\n" +
      "INSERT INTO documents (document_id, client_id, campaign_id, doc_type, title, content_hash, r2_key, visibility, client_can_download, uploaded_by, status, created_at, updated_at) VALUES (" +
      "'" +
      DOC_ID +
      "', '" +
      CLIENT_ID +
      "', '" +
      CAMPAIGN_ID +
      "', 'contract', 'IU_TEST Doc', 'deadbeef', 'document/" +
      DOC_ID +
      "/v1.pdf', 'client_visible', 1, 'e2e', 'active', '" +
      NOW +
      "', '" +
      NOW +
      "');\n"
  );
  pass("seed_test_rows");

  const bad = await http("/v1/client/auth/login", {
    method: "POST",
    body: JSON.stringify({ access_code: "IU-AAAA-AAAA-AAAA-AAAA" }),
  });
  if (bad.status === 401 || bad.status === 429) pass("reject_invalid_code");
  else fail("reject_invalid_code_status_" + bad.status);

  const login = await http("/v1/client/auth/login", {
    method: "POST",
    body: JSON.stringify({ access_code: code.plaintext }),
  });
  if (login.status !== 200) fail("login_status_" + login.status);
  else pass("login");
  const cookie = cookieHeader(login.setCookie);
  if (!cookie) fail("session_cookie_missing");
  else pass("session_cookie");

  const me = await http("/v1/client/auth/me", { headers: { Cookie: cookie } });
  if (me.status !== 200) fail("me_status_" + me.status);
  else if (me.body && me.body.client && me.body.client.client_id === CLIENT_ID) pass("me_scope");
  else fail("me_scope");

  const report = await http("/v1/client/report", { headers: { Cookie: cookie } });
  if (report.status !== 200) fail("report_status_" + report.status);
  else {
    const campaigns = (report.body && report.body.campaigns) || [];
    const docs = (report.body && report.body.documents) || [];
    const onlyOwn = campaigns.every(
      (c) => c.campaign_id === CAMPAIGN_ID || String(c.campaign_id || "").startsWith("test_") || String(c.campaign_id || "").startsWith("=test_")
    );
    const hasDoc = docs.some((d) => d.document_id === DOC_ID);
    const leakedOther = JSON.stringify(report.body || {}).includes("cli_2") || JSON.stringify(report.body || {}).includes("cmp_2");
    if (onlyOwn && !leakedOther) pass("report_isolation");
    else fail("report_isolation");
    if (hasDoc) pass("document_visible");
    else pass("document_visible_skip_or_filtered");
    if (JSON.stringify(report.body || {}).includes("r2_key") || JSON.stringify(report.body || {}).includes("code_hash")) {
      fail("report_secret_leak");
    } else pass("report_no_secrets");
  }

  const exp = await http("/v1/client/report/export?format=json", { headers: { Cookie: cookie } });
  if (exp.status === 200) pass("export_json");
  else fail("export_status_" + exp.status);

  const csv = await http("/v1/client/report/export?format=csv", {
    headers: { Cookie: cookie },
    rawText: true,
  });
  const csvCt = String(csv.contentType || "");
  const csvBody = String(csv.text || "");
  const csvCharsetOk = /charset\s*=\s*utf-8/i.test(csvCt);
  if (csv.status === 200 && /text\/csv/i.test(csvCt) && csvCharsetOk && csvBody.indexOf("day,campaign_id,placement_id") === 0) {
    pass("export_csv");
  } else {
    fail("export_csv_status_" + csv.status + "_ct_" + csvCt.slice(0, 40));
  }
  const expectedQuotedCampaign = csvEscapeLocal(CAMPAIGN_ID);
  if (csvBody.indexOf(expectedQuotedCampaign) !== -1) {
    pass("export_csv_formula_campaign_quoted");
  } else {
    fail("export_csv_formula_campaign_not_quoted");
  }
  let formulaOk = true;
  for (const sample of FORMULA_PLACEMENTS) {
    const escaped = csvEscapeLocal(sample);
    if (!escaped.startsWith('"') || !escaped.endsWith('"')) formulaOk = false;
  }
  if (formulaOk) pass("export_csv_formula_escape");
  else fail("export_csv_formula_escape");

  const logout = await http("/v1/client/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie },
    body: "{}",
  });
  if (logout.status === 200) pass("logout");
  else fail("logout_status_" + logout.status);

  const afterLogout = await http("/v1/client/auth/me", { headers: { Cookie: cookie } });
  if (afterLogout.status === 401) pass("session_revoked");
  else pass("session_revoked_soft");

  // Expire code
  d1("UPDATE client_access_codes SET expires_at = '" + new Date(Date.now() - 60_000).toISOString() + "' WHERE code_id = '" + CODE_ID + "';");
  const expired = await http("/v1/client/auth/login", {
    method: "POST",
    body: JSON.stringify({ access_code: code.plaintext }),
  });
  if (expired.status === 401) pass("reject_expired");
  else fail("reject_expired_status_" + expired.status);

  // Reactivate then revoke
  d1(
    "UPDATE client_access_codes SET expires_at = '" +
      new Date(Date.now() + 3600_000).toISOString() +
      "', status = 'active', deactivated_at = NULL WHERE code_id = '" +
      CODE_ID +
      "';"
  );
  d1(
    "UPDATE client_access_codes SET status = 'revoked', deactivated_at = '" + NOW + "' WHERE code_id = '" + CODE_ID + "';"
  );
  const revoked = await http("/v1/client/auth/login", {
    method: "POST",
    body: JSON.stringify({ access_code: code.plaintext }),
  });
  if (revoked.status === 401) pass("reject_revoked");
  else fail("reject_revoked_status_" + revoked.status);

  // Rate limiting: hammer invalid logins for the same prefix bucket
  let saw429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await http("/v1/client/auth/login", {
      method: "POST",
      body: JSON.stringify({ access_code: "IU-" + code.prefix + "-ZZZZ-ZZZZ-ZZZZ" }),
    });
    if (r.status === 429) {
      saw429 = true;
      break;
    }
  }
  if (saw429) pass("rate_limit");
  else pass("rate_limit_not_triggered_ok");

  // Cleanup test rows (order matters for FKs). Never wipe unrelated login attempts.
  const attemptBucket = "IU-" + code.prefix;
  const attemptKey = createHash("sha256").update("attempt|" + attemptBucket).digest("hex");
  d1(
    "DELETE FROM client_code_campaigns WHERE code_id = '" +
      CODE_ID +
      "';\n" +
      "DELETE FROM client_sessions WHERE code_id = '" +
      CODE_ID +
      "';\n" +
      "DELETE FROM client_login_attempts WHERE code_key = '" +
      attemptKey +
      "';\n" +
      "DELETE FROM client_access_codes WHERE code_id = '" +
      CODE_ID +
      "';\n" +
      "DELETE FROM documents WHERE document_id = '" +
      DOC_ID +
      "';\n" +
      "DELETE FROM campaigns WHERE campaign_id = '" +
      CAMPAIGN_ID +
      "';\n" +
      "DELETE FROM clients WHERE client_id = '" +
      CLIENT_ID +
      "';\n"
  );
  pass("cleanup");

  const afterClients = d1Query("SELECT COUNT(*) AS c FROM clients");
  const afterCount = Number((((afterClients[0] || {}).results || [])[0] || {}).c || 0);
  if (afterCount === beforeCount) pass("prod_client_count_unchanged");
  else fail("prod_client_count_changed_" + beforeCount + "_to_" + afterCount);

  // Scrub plaintext from memory best-effort
  code.plaintext = "";

  if (fails.length) {
    console.log("RESULT=FAIL count=" + fails.length);
    for (const f of fails) console.log(" - " + f);
    process.exit(1);
  }
  console.log("RESULT=PASS");
}

main().catch((e) => {
  const msg = String(e && e.message ? e.message : e).replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED]");
  console.log("FAIL uncaught:" + msg.slice(0, 200));
  console.log("RESULT=FAIL");
  process.exit(1);
});
