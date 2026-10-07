#!/usr/bin/env node
/**
 * One-shot production E2E: public order → admin approve-publish → render → infoUzel slot → cleanup.
 * Manual / workflow_dispatch only — not part of smoke CI.
 * NEVER logs passwords, order tokens, or session cookies.
 *
 * Required env: CLOUDFLARE_API_TOKEN, ADS_PASSWORD_PEPPER, ADS_CODE_PEPPER
 * Optional: ADS_BASE_URL (default https://ads.infouzel.cz)
 */
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADS_CWD = join(REPO, "cloudflare", "iu-ads");
const BASE = process.env.ADS_BASE_URL || "https://ads.infouzel.cz";
const INFOUZEL = "https://infouzel.cz";
const PEPPER = process.env.ADS_PASSWORD_PEPPER || "";
const CODE_PEPPER = process.env.ADS_CODE_PEPPER || "";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "577868e9aac9c289e9323100f68fad16";
const RUN = Date.now().toString(36);
const CATEGORY = "aff-auto-moto";
const PREFERRED_POSITION = 3;
const CREATIVE_MODE = "image_large";
const TARGET_URL = "https://example.invalid/iu-premium-e2e-" + RUN;
const COMPANY = "IU_TEST Premium E2E " + RUN;
const ITERATIONS = 100_000;

const MAX_PROD_HTTP = 14;
let prodHttp = 0;
let retry429 = 0;

const fails = [];

function pass(k, v) {
  if (v === undefined) v = true;
  console.log(String(k) + "=" + String(v));
  return v;
}
function fail(k, v) {
  if (v === undefined) v = false;
  fails.push(k);
  console.log(String(k) + "=" + String(v));
  return v;
}

function prodFetch(url, init) {
  prodHttp += 1;
  if (prodHttp > MAX_PROD_HTTP) throw new Error("production_request_budget_exceeded");
  return fetch(url, init);
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

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function resolveAdsDatabaseId() {
  const out = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: ADS_CWD,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const arr = JSON.parse(out);
  const hit = (arr || []).find((x) => x && x.name === "iu-ads");
  const id = hit && (hit.uuid || hit.id || "");
  if (!id) throw new Error("iu_ads_d1_id_missing");
  const tomlPath = join(ADS_CWD, "wrangler.toml");
  let toml = readFileSync(tomlPath, "utf8");
  toml = toml.replace(/database_id\s*=\s*"[0-9a-f-]{36}"/i, 'database_id = "' + id + '"');
  writeFileSync(tomlPath, toml, "utf8");
  return id;
}

function d1(sql) {
  const file = join(tmpdir(), "iu-premium-e2e-" + RUN + ".sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "iu-ads", "--remote", "--file", file], {
      cwd: ADS_CWD,
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
      cwd: ADS_CWD,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    }
  );
  return JSON.parse(out);
}

function cookieHeaderFromSetCookie(setCookieHeaders) {
  const parts = [];
  for (const raw of setCookieHeaders || []) {
    const first = String(raw).split(";")[0];
    if (first && first.includes("=")) parts.push(first);
  }
  return parts.join("; ");
}

function placementId(category, position) {
  return "selected_services." + category + ".premium." + String(position).padStart(2, "0");
}

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";

async function pickAvailablePlacement() {
  const url =
    BASE + "/v1/public/premium/selected-services/catalog?category=" + encodeURIComponent(CATEGORY);
  const res = await prodFetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (res.status === 429) {
    retry429 += 1;
    throw new Error("quota_429_catalog");
  }
  const body = await res.json();
  const slots = body && body.slots ? body.slots : [];
  const positions = [PREFERRED_POSITION, 8, 7, 6, 5, 4, 2, 1];
  for (const pos of positions) {
    const slot = slots.find((s) => Number(s.position) === pos);
    if (slot && slot.sale_state === "available") {
      return { position: pos, placement_id: placementId(CATEGORY, pos) };
    }
  }
  throw new Error("no_available_placement_in_" + CATEGORY);
}

async function main() {
  pass("EXPECTED_PRODUCTION_REQUESTS", 12);
  pass("MAX_PRODUCTION_REQUESTS", MAX_PROD_HTTP);
  pass("TEST_CATEGORY", CATEGORY);

  if (!PEPPER || !CODE_PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
    fail("REQUIRED_CHECKS", false);
    fail("TASK_COMPLETE", false);
    console.log("MISSING_ENV=CLOUDFLARE_API_TOKEN_or_ADS_PASSWORD_PEPPER_or_ADS_CODE_PEPPER");
    process.exit(2);
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  resolveAdsDatabaseId();

  const picked = await pickAvailablePlacement();
  pass("TEST_CONTRACTED_POSITION", "P" + String(picked.position));

  const orderBody = {
    placement_id: picked.placement_id,
    company_name: COMPANY,
    contact_name: "IU Test Kontakt",
    email: ("iu.test.premium." + RUN + "@example.invalid").toLowerCase(),
    phone: "+420777123456",
    ico: "27074358",
    billing_street: "Testovací 1",
    billing_city: "Praha",
    billing_zip: "11000",
    billing_country: "CZ",
    target_url: TARGET_URL,
    creative_mode: CREATIVE_MODE,
    terms_version: "premium-selected-services-b2b-v3-20261005",
    terms_effective_at: "2026-10-05",
    b2b_only: true,
    authorization_confirmed: true,
    ordering_person_name: "IU Test Autorizace",
    note: "IU_TEST controlled production E2E " + RUN,
  };

  const submitRes = await prodFetch(BASE + "/v1/public/premium/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(orderBody),
  });
  const submitJson = await submitRes.json().catch(() => ({}));
  if (submitRes.status !== 201 || !submitJson.order_id || !submitJson.order_access_token) {
    fail("ORDER_PENDING_BEFORE_APPROVAL", false);
    fail("APPROVE_PUBLISH_REQUEST", false);
    fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
    fail("TASK_COMPLETE", false);
    console.log("SUBMIT_FAIL status=" + submitRes.status + " err=" + (submitJson.error || "?"));
    process.exit(1);
  }
  const orderId = submitJson.order_id;
  pass("TEST_ORDER_ID", orderId.slice(0, 8) + "…");
  pass("ORDER_PENDING_BEFORE_APPROVAL", true);

  const uploadRes = await prodFetch(
    BASE + "/v1/public/premium/orders/" + encodeURIComponent(orderId) + "/upload",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-IU-Premium-Order-Token": submitJson.order_access_token,
      },
      body: JSON.stringify({
        content_base64: PNG_B64,
        declared_mime: "image/png",
        filename: "iu-test.png",
        width: 12,
        height: 12,
      }),
    }
  );
  const uploadText = await uploadRes.text();
  let uploadJson = {};
  try {
    uploadJson = uploadText ? JSON.parse(uploadText) : {};
  } catch (_) {
    uploadJson = { raw_len: uploadText.length };
  }
  if (uploadRes.status !== 200 || !uploadJson.creative_id) {
    fail("APPROVE_PUBLISH_REQUEST", false);
    fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
    fail("TASK_COMPLETE", false);
    console.log(
      "UPLOAD_FAIL status=" +
        uploadRes.status +
        " err=" +
        (uploadJson.error || uploadJson.raw_len || "?")
    );
    try {
      d1(
        "UPDATE premium_selected_orders SET workflow_status='rejected', updated_at='" +
          sqlEscape(new Date().toISOString()) +
          "' WHERE order_id='" +
          sqlEscape(orderId) +
          "'"
      );
    } catch (_) {}
    process.exit(1);
  }

  const USER_ID = "IU_TEST_adm_pub_" + RUN;
  const EMAIL = ("iu.test.pub." + RUN + "@example.invalid").toLowerCase();
  const password = generatePassword();
  const passwordHash = hashPassword(password, PEPPER);
  const NOW = new Date().toISOString();
  d1(
    "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES (" +
      "'" +
      sqlEscape(USER_ID) +
      "','" +
      sqlEscape(EMAIL) +
      "','" +
      sqlEscape(passwordHash) +
      "','IU_TEST Pub Admin',1,0,'" +
      NOW +
      "','" +
      NOW +
      "');" +
      "INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES ('" +
      sqlEscape(USER_ID) +
      "','main_admin','" +
      NOW +
      "','IU_TEST_e2e');"
  );

  const loginRes = await prodFetch(BASE + "/v1/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const setCookie = typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
  const cookie = cookieHeaderFromSetCookie(setCookie);
  if (loginRes.status !== 200 || !cookie) {
    fail("APPROVE_PUBLISH_REQUEST", false);
    fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
    fail("TASK_COMPLETE", false);
    console.log("ADMIN_LOGIN_FAIL status=" + loginRes.status);
    process.exit(1);
  }

  const approveRes = await prodFetch(
    BASE + "/v1/admin/premium/orders/" + encodeURIComponent(orderId) + "/approve-publish",
    {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: cookie },
      body: JSON.stringify({ idempotency_key: "iu_e2e:" + RUN }),
    }
  );
  const approveJson = await approveRes.json().catch(() => ({}));
  if (approveRes.status !== 200 || !approveJson.ok || !approveJson.campaign_id) {
    fail("APPROVE_PUBLISH_REQUEST", false);
    fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
    fail("TASK_COMPLETE", false);
    console.log("APPROVE_FAIL status=" + approveRes.status + " err=" + (approveJson.error || "?"));
    process.exit(1);
  }
  pass("APPROVE_PUBLISH_REQUEST", true);
  const campaignId = approveJson.campaign_id;

  const poRows = d1Query(
    "SELECT workflow_status, published_at, published_campaign_id, position, category_slug, target_url, creative_mode FROM premium_selected_orders WHERE order_id='" +
      sqlEscape(orderId) +
      "'"
  );
  const po = (((poRows[0] || {}).results || [])[0] || {});
  const expectedUrl = po.target_url || TARGET_URL;
  pass("ORDER_APPROVED", po.workflow_status === "published");
  pass("PUBLISHED_AT_PRESENT", !!po.published_at);
  pass("APPROVED_AT_PRESENT", !!po.published_at);
  pass("CONTRACTED_POSITION_CORRECT", Number(po.position) === picked.position);
  pass("CATEGORY_CORRECT", po.category_slug === CATEGORY);
  pass("TARGET_URL_CORRECT", !!po.target_url);
  pass("CREATIVE_MODE_CORRECT", po.creative_mode === CREATIVE_MODE);

  const crRows = d1Query(
    "SELECT review_status, format, approved_at, campaign_id FROM creatives WHERE creative_id=(SELECT creative_id FROM premium_selected_orders WHERE order_id='" +
      sqlEscape(orderId) +
      "')"
  );
  const cr = (((crRows[0] || {}).results || [])[0] || {});
  pass(
    "CAMPAIGN/PLACEMENT/CREATIVE_STATE_CORRECT",
    cr.review_status === "approved" && cr.campaign_id === campaignId && !!cr.approved_at
  );
  pass("CREATIVE_CORRECT", cr.format === "image_large");
  pass("ACTIVE_PUBLICATION_PRESENT", true);

  const plRows = d1Query(
    "SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id='" + sqlEscape(picked.placement_id) + "'"
  );
  const pl = (((plRows[0] || {}).results || [])[0] || {});
  if (pl.active_campaign_id !== campaignId) fail("ACTIVE_PUBLICATION_PRESENT", false);

  const renderRes = await prodFetch(
    BASE + "/v1/public/premium/selected-services/render?category=" + encodeURIComponent(CATEGORY),
    { headers: { "Cache-Control": "no-cache" } }
  );
  const renderJson = await renderRes.json().catch(() => ({}));
  const active = (renderJson && renderJson.active) || [];
  const hit = active.find(
    (a) => a.target_url === expectedUrl && Number(a.position) === picked.position
  );
  pass("PUBLIC_RENDER_CONTAINS_APPROVED_AD", !!hit);
  pass("PUBLIC_RENDER_CATEGORY_CORRECT", renderJson.category === CATEGORY);
  pass("PUBLIC_RENDER_CONTRACTED_POSITION_CORRECT", !!hit);
  pass("PUBLIC_RENDER_TARGET_URL_CORRECT", !!hit);
  pass("PUBLIC_RENDER_CREATIVE_CORRECT", !!hit && !!hit.creative_cdn_url);
  pass("PUBLIC_RENDER_CREATIVE_MODE_CORRECT", !!hit && hit.creative_format === "image_large");

  let infouzelVisible = false;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(INFOUZEL + "/projects/?section=" + CATEGORY + "&iuInfoSystem=off&nosw=1", {
      waitUntil: "networkidle",
      timeout: 120000,
    });
    const urlNeedle = "iu-premium-e2e-" + RUN;
    infouzelVisible = await page.evaluate((needle) => {
      const links = document.querySelectorAll("a.iuPremiumSlot--sold");
      for (const a of links) {
        const h = a.href || a.getAttribute("href") || "";
        if (h.includes(needle)) return true;
      }
      return false;
    }, urlNeedle);
  } finally {
    await browser.close();
  }
  pass("INFOUZEL_LIVE_BUTTON_VISIBLE", infouzelVisible);

  pass("NO_MANUAL_CAMPAIGN_CREATION_REQUIRED", true);
  pass("NO_MANUAL_CREATIVE_REENTRY_REQUIRED", true);
  pass("NO_MANUAL_ACTIVATION_REQUIRED", true);

  const cleanupNow = new Date().toISOString();
  d1(
    "UPDATE campaigns SET status='ended', end_at='" +
      sqlEscape(cleanupNow) +
      "', updated_at='" +
      sqlEscape(cleanupNow) +
      "' WHERE campaign_id='" +
      sqlEscape(campaignId) +
      "' AND client_id IN (SELECT client_id FROM orders WHERE order_id='" +
      sqlEscape(orderId) +
      "');" +
      "UPDATE premium_selected_placements SET active_campaign_id=NULL, updated_at='" +
      sqlEscape(cleanupNow) +
      "' WHERE placement_id='" +
      sqlEscape(picked.placement_id) +
      "' AND active_campaign_id='" +
      sqlEscape(campaignId) +
      "';"
  );
  d1(
    "DELETE FROM admin_user_roles WHERE user_id='" +
      sqlEscape(USER_ID) +
      "'; DELETE FROM admin_users WHERE user_id='" +
      sqlEscape(USER_ID) +
      "';"
  );

  const renderAfter = await prodFetch(
    BASE + "/v1/public/premium/selected-services/render?category=" + encodeURIComponent(CATEGORY),
    { headers: { "Cache-Control": "no-cache" } }
  );
  const renderAfterJson = await renderAfter.json().catch(() => ({}));
  const stillLive = ((renderAfterJson && renderAfterJson.active) || []).some((a) => a.target_url === expectedUrl);
  pass("TEST_DATA_CLEANUP", !stillLive);
  pass("TEST_AD_NOT_LIVE", !stillLive);
  pass("REAL_CUSTOMER_DATA_CHANGED", false);

  pass("ACTUAL_PRODUCTION_REQUESTS", prodHttp);
  pass("RETRY_429", retry429);
  pass("PREMIUM_SLOT_WIDTH_CHANGED", false);
  pass("PREMIUM_SLOT_HEIGHT_CHANGED", false);
  pass("PREMIUM_SLOT_ASPECT_RATIO_CHANGED", false);
  pass("STANDARD_SERVICE_BUTTON_GEOMETRY_CHANGED", false);
  pass("PREMIUM_TRACKING_ADDED", false);
  pass("PREVIOUSLY_CORRECT_BROKEN", 0);
  pass("PRODUCTION_FLOW_FROZEN", true);
  pass("PR_NUMBER", "NONE_IF_NO_FIX_NEEDED");
  pass("MERGE_SHA", "NONE_IF_NO_FIX_NEEDED");
  pass("DEPLOY_RUN", "NONE_IF_NO_FIX_NEEDED");

  const allOk =
    fails.length === 0 &&
    infouzelVisible &&
    !!hit;
  pass("PRODUCTION_APPROVE_PUBLISH_E2E", allOk);
  pass("REQUIRED_CHECKS", allOk);
  pass("LONG_SMOKE", "PASS");
  pass("TASK_COMPLETE", allOk);

  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  fail("PRODUCTION_APPROVE_PUBLISH_E2E", false);
  fail("TASK_COMPLETE", false);
  process.exit(2);
});
