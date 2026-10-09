#!/usr/bin/env node
/**
 * Mobile Safari viewport E2E: admin premium order detail must show ready docs + Náhled/Stáhnout.
 * Ephemeral main_admin (D1) — no customer order mutation.
 */
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADS_CWD = join(REPO, "cloudflare", "iu-ads");
const BASE = process.env.ADS_BASE_URL || "https://ads.infouzel.cz";
const PEPPER = process.env.ADS_PASSWORD_PEPPER || "";
const RUN = Date.now().toString(36);
const fails = [];

function pass(k, v) {
  if (v === undefined) v = true;
  console.log(String(k) + "=" + String(v));
}
function fail(k, v) {
  if (v === undefined) v = false;
  fails.push(k);
  console.log(String(k) + "=" + String(v));
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function toHex(buf) {
  return Buffer.from(buf).toString("hex");
}

function hashPassword(password, pepper) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password + "|" + pepper, salt, 100_000, 32, "sha256");
  return "pbkdf2$100000$" + toHex(salt) + "$" + toHex(derived);
}

function resolveAdsDatabaseId() {
  const out = execFileSync("npx", ["wrangler", "d1", "list", "--json"], {
    cwd: ADS_CWD,
    env: process.env,
    encoding: "utf8",
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
  const file = join(tmpdir(), "iu-mobile-doc-e2e-" + RUN + ".sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", "iu-ads", "--remote", "--file", file], {
      cwd: ADS_CWD,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
    { cwd: ADS_CWD, env: process.env, encoding: "utf8" }
  );
  return JSON.parse(out);
}

async function main() {
  if (!PEPPER || !process.env.CLOUDFLARE_API_TOKEN) {
    fail("SECRETS", false);
    fail("MOBILE_BROWSER_E2E_PASS", false);
    process.exit(1);
  }
  resolveAdsDatabaseId();

  const EMAIL = "iu-mob-doc-e2e-" + RUN + "@invalid.test";
  const password = "IU-Mob-" + randomBytes(12).toString("base64url") + "!aA1";
  const USER_ID = "usr_mobdoc_" + RUN;
  const NOW = new Date().toISOString();
  const passwordHash = hashPassword(password, PEPPER);

  d1(
    "INSERT INTO admin_users (user_id, email, password_hash, display_name, is_active, force_password_change, created_at, updated_at) VALUES ('" +
      sqlEscape(USER_ID) +
      "','" +
      sqlEscape(EMAIL) +
      "','" +
      sqlEscape(passwordHash) +
      "','IU Mobile Doc E2E',1,0,'" +
      NOW +
      "','" +
      NOW +
      "'); INSERT INTO admin_user_roles (user_id, role_code, assigned_at, assigned_by) VALUES ('" +
      sqlEscape(USER_ID) +
      "','main_admin','" +
      NOW +
      "','mob_doc_e2e');"
  );

  const iPhone = devices["iPhone 13"];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
    baseURL: BASE,
  });
  const page = await context.newPage();

  try {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.fill("#email", EMAIL);
    await page.fill("#password", password);
    await page.click('#login-form button[type="submit"]');
    await page.waitForSelector("#app-view.show", { timeout: 20000 });

    const navToggle = page.locator("#btn-nav-toggle");
    if (await navToggle.isVisible()) {
      await navToggle.click();
    }
    await page.click('nav button[data-id="premium"]');
    await page.waitForSelector(".order-cards .order-card, article.order-card", { state: "visible", timeout: 30000 });

    const detailButtons = page.locator("[data-premium-detail]");
    const detailCount = await detailButtons.count();
    pass("MOBILE_PREMIUM_ORDERS_LOADED", detailCount > 0);
    if (detailCount === 0) throw new Error("no_premium_orders");

    let orderIdAttr = null;
    let missingText = 99;
    let previewCount = 0;
    let downloadCount = 0;
    const tryCount = Math.min(detailCount, 12);
    for (let i = 0; i < tryCount; i += 1) {
      await detailButtons.nth(i).click();
      await page.waitForSelector(".order-docs-card", { timeout: 30000 });
      missingText = await page.locator(".order-doc-item").filter({ hasText: "Stav: missing" }).count();
      previewCount = await page.locator("[data-premium-doc-preview]").count();
      downloadCount = await page.locator("[data-premium-doc-download]").count();
      orderIdAttr = await page.locator("[data-premium-doc-preview]").first().getAttribute("data-premium-doc-preview");
      if (missingText === 0 && previewCount >= 2 && downloadCount >= 2) break;
      await page.click("#order-detail-back");
      await page.waitForSelector(".order-cards .order-card", { state: "visible", timeout: 15000 });
    }
    pass("MOBILE_UI_MISSING_STATUS_COUNT", missingText);
    pass("CONFIRMATION_BUTTONS_VISIBLE", (await page.locator('[data-doc-kind="order_confirmation"][data-premium-doc-preview]').count()) >= 1);
    pass("INVOICE_BUTTONS_VISIBLE", (await page.locator('[data-doc-kind="invoice_pdf"][data-premium-doc-preview]').count()) >= 1);
    pass("MOBILE_PREVIEW_BUTTON_COUNT", previewCount);
    pass("MOBILE_DOWNLOAD_BUTTON_COUNT", downloadCount);

    if (missingText > 0 || previewCount < 2 || downloadCount < 2) {
      fail("MOBILE_BROWSER_E2E_PASS", false);
    } else {
      pass("MOBILE_BROWSER_E2E_PASS", true);
    }

    pass("ACTUAL_ORDER_IDENTIFIED", orderIdAttr ? orderIdAttr.slice(-12) : "unknown");

    let confPass = true;
    let invPass = true;
    if (orderIdAttr) {
      const cookies = await context.cookies();
      const cookieHeader = cookies.map((c) => c.name + "=" + c.value).join("; ");
      for (const kind of ["order_confirmation", "invoice_pdf"]) {
        for (const disposition of ["inline", "attachment"]) {
          const acc = await fetch(
            BASE +
              "/v1/admin/premium/orders/" +
              encodeURIComponent(orderIdAttr) +
              "/documents/" +
              kind +
              "/access?disposition=" +
              disposition,
            { headers: { Cookie: cookieHeader } }
          );
          const accJson = await acc.json().catch(() => ({}));
          const pdfOk =
            accJson.path &&
            (await fetch(BASE + accJson.path, { headers: { Cookie: cookieHeader } })).ok;
          pass("MOBILE_" + kind + "_" + disposition.toUpperCase() + "_PDF", pdfOk);
          if (!pdfOk) {
            if (kind === "order_confirmation") confPass = false;
            if (kind === "invoice_pdf") invPass = false;
          }
        }
      }
    } else {
      confPass = false;
      invPass = false;
    }

    pass("CONFIRMATION_PREVIEW_DOWNLOAD_PASS", confPass);
    pass("INVOICE_PREVIEW_DOWNLOAD_PASS", invPass);
  } finally {
    await browser.close();
    try {
      d1(
        "UPDATE admin_sessions SET revoked_at = '" +
          sqlEscape(new Date().toISOString()) +
          "' WHERE user_id = '" +
          sqlEscape(USER_ID) +
          "' AND revoked_at IS NULL; UPDATE admin_users SET is_active = 0, password_hash = 'disabled:mob_doc_e2e', updated_at = '" +
          sqlEscape(new Date().toISOString()) +
          "' WHERE user_id = '" +
          sqlEscape(USER_ID) +
          "';"
      );
    } catch (_) {}
  }

  if (fails.length) process.exit(1);
}

main().catch((err) => {
  console.log("FATAL=" + (err && err.message ? err.message : String(err)));
  fail("MOBILE_BROWSER_E2E_PASS", false);
  process.exit(1);
});
