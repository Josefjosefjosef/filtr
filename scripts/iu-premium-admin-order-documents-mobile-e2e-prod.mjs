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
    await page.waitForSelector(".order-cards .order-card", { state: "visible", timeout: 30000 });

    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => c.name + "=" + c.value).join("; ");
    const listRes = await fetch(BASE + "/v1/admin/premium/orders?status=published&limit=20", {
      headers: { Cookie: cookieHeader },
    });
    const listJson = await listRes.json().catch(() => ({}));
    const publishedIds = (listJson.premium_orders || []).map((o) => o && o.order_id).filter(Boolean);
    pass("MOBILE_PUBLISHED_ORDER_COUNT", publishedIds.length);
    pass("MOBILE_PUBLISHED_ORDER_TAILS", publishedIds.map((id) => id.slice(-12)).join(",") || "none");
    if (publishedIds.length === 0) throw new Error("no_published_orders");

    let mobileAllPass = true;
    let lastVerifiedOrderId = null;
    let lastPreviewCount = 0;
    let lastDownloadCount = 0;
    for (const oid of publishedIds) {
      const openSel = '[data-order-open="' + oid + '"], [data-premium-detail="' + oid + '"]';
      const openBtn = page.locator(openSel).first();
      if ((await openBtn.count()) === 0) {
        pass("MOBILE_OPEN_ORDER_" + oid.slice(-12), false);
        mobileAllPass = false;
        continue;
      }
      await openBtn.click();
      await page.waitForSelector(".order-docs-card", { timeout: 30000 });
      const missingText = await page.locator(".order-doc-item").filter({ hasText: "Stav: missing" }).count();
      const previewCount = await page.locator("[data-premium-doc-preview]").count();
      const downloadCount = await page.locator("[data-premium-doc-download]").count();
      const tail = oid.slice(-12);
      pass("MOBILE_ORDER_" + tail + "_MISSING_COUNT", missingText);
      pass("MOBILE_ORDER_" + tail + "_PREVIEW_COUNT", previewCount);
      pass("MOBILE_ORDER_" + tail + "_DOWNLOAD_COUNT", downloadCount);
      const orderOk = missingText === 0 && previewCount >= 2 && downloadCount >= 2;
      pass("MOBILE_ORDER_" + tail + "_UI_PASS", orderOk);
      if (!orderOk) {
        mobileAllPass = false;
      } else {
        lastVerifiedOrderId = oid;
        lastPreviewCount = previewCount;
        lastDownloadCount = downloadCount;
      }
      await page.click("#order-detail-back");
      await page.waitForSelector(".order-cards .order-card", { state: "visible", timeout: 15000 });
    }

    pass("MOBILE_UI_MISSING_STATUS_COUNT", mobileAllPass ? 0 : 1);
    pass("CONFIRMATION_BUTTONS_VISIBLE", mobileAllPass && lastPreviewCount >= 1);
    pass("INVOICE_BUTTONS_VISIBLE", mobileAllPass && lastPreviewCount >= 2);
    pass("MOBILE_PREVIEW_BUTTON_COUNT", lastPreviewCount);
    pass("MOBILE_DOWNLOAD_BUTTON_COUNT", lastDownloadCount);

    if (mobileAllPass) {
      pass("MOBILE_BROWSER_E2E_PASS", true);
    } else {
      fail("MOBILE_BROWSER_E2E_PASS", false);
    }

    pass(
      "ACTUAL_ORDER_IDENTIFIED",
      mobileAllPass
        ? publishedIds.map((id) => id.slice(-12)).join(",")
        : lastVerifiedOrderId
          ? lastVerifiedOrderId.slice(-12)
          : "none"
    );

    let confPass = mobileAllPass;
    let invPass = mobileAllPass;
    if (mobileAllPass && lastVerifiedOrderId) {
      for (const kind of ["order_confirmation", "invoice_pdf"]) {
        for (const disposition of ["inline", "attachment"]) {
          const acc = await fetch(
            BASE +
              "/v1/admin/premium/orders/" +
              encodeURIComponent(lastVerifiedOrderId) +
              "/documents/" +
              kind +
              "/access?disposition=" +
              disposition,
            { headers: { Cookie: cookieHeader } }
          );
          const accJson = await acc.json().catch(() => ({}));
          const pdfOk = accJson.path && (await fetch(BASE + accJson.path, { headers: { Cookie: cookieHeader } })).ok;
          pass("MOBILE_" + kind + "_" + disposition.toUpperCase() + "_PDF", pdfOk);
          if (!pdfOk) {
            if (kind === "order_confirmation") confPass = false;
            if (kind === "invoice_pdf") invPass = false;
          }
        }
      }
    } else if (!mobileAllPass) {
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
