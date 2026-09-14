#!/usr/bin/env node
/**
 * MindMenu mailbox — fresh-user "Barevný input" default OFF.
 *
 * Contract:
 *   A) no iu_mailboxes_v1 → all pills plain + edit checkbox unchecked
 *   B) stored colorful:true → colored pill + checkbox ON
 *   C) stored colorful:false → plain pill + checkbox OFF
 *   D) stored missing colorful key → legacy ON (do not migrate existing users off)
 *   E) fresh user enables colorful → save → reload keeps ON
 *
 * Does NOT weaken other mailbox guards.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const KEY = "iu_mailboxes_v1";
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

function staticContract() {
  const feed = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const pkg = fs.readFileSync(path.join(REPO, "package.json"), "utf8");
  const smoke = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const shell = fs.readFileSync(path.join(REPO, "assets", "iu-mobile-bottom-nav-shell-v1.js"), "utf8");

  if (!/function iuMailboxDefaultItems\s*\([\s\S]{0,900}?colorful:\s*false/.test(feed)) {
    fail("static_default_items_must_set_colorful_false");
  }
  if (!/Missing colorful in stored JSON = legacy colorful ON/.test(feed)) {
    fail("static_missing_legacy_colorful_comment");
  }
  if (!/colorful:\s*it\?\.colorful\s*!==\s*false/.test(feed)) {
    fail("static_load_must_keep_legacy_missing_as_on");
  }
  if (!/items\.push\(\s*\{[^}]*colorful:\s*false/.test(feed)) {
    fail("static_add_must_default_colorful_false");
  }
  if (/colorfulEl\s*\?\s*!!colorfulEl\.checked\s*:\s*true/.test(feed)) {
    fail("static_edit_fallback_must_not_default_true");
  }
  if (!/colorful:\s*it\.colorful\s*!==\s*false/.test(feed)) {
    fail("static_migration_must_persist_colorful");
  }
  /* Ban legacy migration maps that list label/url/social/hidden/slot without colorful. */
  if (
    /fixed\.map\(\s*\(\s*it\s*\)\s*=>\s*\(\s*\{\s*label:\s*it\.label,\s*url:\s*it\.url,\s*social:\s*it\.social,\s*hidden:\s*!!it\.hidden,\s*slot:\s*it\.slot\s*\}\s*\)\s*\)/.test(
      feed
    )
  ) {
    fail("static_migration_write_omits_colorful");
  }
  if (pkg.indexOf("iu-mindmenu-mailbox-colorful-default-off-guard") < 0) fail("package_missing_script");
  if (smoke.indexOf("iu-mindmenu-mailbox-colorful-default-off-guard") < 0) fail("smoke_missing_guard");
  if (!/mindmenu-colorful-default-off-v1-20260914/.test(app)) fail("app_js_cachebust_missing");
  if (!/mindmenu-colorful-default-off-v1-20260914/.test(shell)) fail("shell_cachebust_missing");
}

async function installConsent(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
}

async function openMindMenu(page) {
  await page.waitForFunction(
    () =>
      typeof window.__iuEnsureFeedPipeline === "function" ||
      document.getElementById("iuMailboxList") ||
      document.getElementById("iuMobileGateWrap"),
    null,
    { timeout: 120000 }
  );
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const narrow = await page.evaluate(
        () => !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches)
      );
      await page.evaluate(async () => {
        if (typeof window.__iuEnsureFeedPipeline === "function") {
          try {
            await window.__iuEnsureFeedPipeline();
          } catch (_) {}
        }
      });
      if (narrow) {
        await page.waitForFunction(
          () => {
            const wrap = document.getElementById("iuMobileGateWrap");
            return !!(wrap && typeof wrap.__iuMobileGateSetTab === "function");
          },
          null,
          { timeout: 45000 }
        );
        await page.evaluate(() => {
          const wrap = document.getElementById("iuMobileGateWrap");
          if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
            wrap.__iuMobileGateSetTab("tools");
          }
        });
        await page.waitForFunction(
          () => {
            const list = document.getElementById("iuMailboxList");
            const add = document.getElementById("iuMailboxAdd");
            return !!(list && add);
          },
          null,
          { timeout: 45000 }
        );
      } else {
        await page.evaluate(async () => {
          if (typeof window.iuArticleActionsOpenOverlay === "function") {
            try {
              await window.iuArticleActionsOpenOverlay();
            } catch (_) {}
          }
        });
        await page.waitForFunction(
          () => {
            const list = document.getElementById("iuMailboxList");
            const add = document.getElementById("iuMailboxAdd");
            return !!(list && add);
          },
          null,
          { timeout: 45000 }
        );
      }
      await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(400);
    }
  }
  throw lastErr || new Error("openMindMenu_timeout");
}

function snap(page) {
  return page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-pill"));
    return {
      count: pills.length,
      plain: pills.map((el) => el.classList.contains("iu-mailbox-pill--plain")),
      labels: pills.map((el) => String(el.textContent || "").trim()),
    };
  });
}

async function openFirstGear(page) {
  await page.locator("#iuMailboxList [data-mailbox-gear]").first().click({ force: true });
  await page.waitForSelector("#iu-mailbox-edit-overlay #iu-mailbox-edit-colorful", { timeout: 15000 });
}

async function readColorfulCheckbox(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#iu-mailbox-edit-overlay #iu-mailbox-edit-colorful");
    return el ? !!el.checked : null;
  });
}

async function setColorfulAndSave(page, on) {
  await page.evaluate((want) => {
    const el = document.querySelector("#iu-mailbox-edit-overlay #iu-mailbox-edit-colorful");
    if (el) el.checked = !!want;
    const form = document.querySelector("#iu-mailbox-edit-overlay form");
    if (form) form.requestSubmit();
  }, on);
  await page.waitForSelector("#iu-mailbox-edit-overlay", { state: "detached", timeout: 15000 });
}

async function closeEditor(page) {
  const cancel = page.locator("#iu-mailbox-edit-cancel");
  if (await cancel.count()) {
    await cancel.click({ force: true });
    await page.waitForSelector("#iu-mailbox-edit-overlay", { state: "detached", timeout: 15000 });
  }
}

async function seedAndHydrate(page, payload) {
  await page.evaluate(
    async ({ KEY, payload }) => {
      try {
        if (window.iuVault && typeof window.iuVault.durableSet === "function") {
          await window.iuVault.durableSet(KEY, payload);
        } else {
          localStorage.setItem(KEY, payload);
        }
        window.dispatchEvent(new Event("iu-vault-hydrated"));
      } catch (_) {}
    },
    { KEY, payload }
  );
  await page.waitForTimeout(200);
}

async function boot(page, base) {
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForVaultReady(page, 120000);
  await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
  await openMindMenu(page);
}

async function main() {
  staticContract();
  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_COLORFUL_DEFAULT_OFF_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }

  const started = await startGuardStaticServer(pickGuardPort(9420, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });

  try {
    // A) Fresh user
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installConsent(ctx);
      await ctx.addInitScript(() => {
        try {
          localStorage.removeItem("iu_mailboxes_v1");
        } catch (_) {}
      });
      const page = await ctx.newPage();
      await boot(page, base);
      const st = await snap(page);
      if (st.count < 1) fail("fresh_no_pills");
      if (!st.plain.every(Boolean)) fail("fresh_pills_not_all_plain");
      await openFirstGear(page);
      const cb = await readColorfulCheckbox(page);
      if (cb !== false) fail("fresh_checkbox_not_off_" + cb);
      await closeEditor(page);

      // E) Enable + reload
      await openFirstGear(page);
      await setColorfulAndSave(page, true);
      await page.waitForTimeout(80);
      let afterOn = await snap(page);
      if (afterOn.plain[0] !== false) fail("fresh_enable_pill_still_plain");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await waitForVaultReady(page, 120000);
      await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
      await openMindMenu(page);
      afterOn = await snap(page);
      if (afterOn.plain[0] !== false) fail("fresh_enable_reload_lost_color");
      await openFirstGear(page);
      const cbReload = await readColorfulCheckbox(page);
      if (cbReload !== true) fail("fresh_enable_reload_checkbox_" + cbReload);
      await closeEditor(page);
      await ctx.close().catch(() => {});
    }

    // B) Stored colorful:true
    {
      const payload = JSON.stringify({
        items: [{ label: "OnBox", url: "https://example.com/on", social: null, hidden: false, colorful: true, slot: 1 }],
      });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installConsent(ctx);
      await ctx.addInitScript(
        ({ KEY, payload }) => {
          try {
            localStorage.setItem(KEY, payload);
          } catch (_) {}
        },
        { KEY, payload }
      );
      const page = await ctx.newPage();
      await boot(page, base);
      await seedAndHydrate(page, payload);
      await openMindMenu(page);
      const st = await snap(page);
      if (st.plain[0] !== false) fail("stored_true_not_colored");
      await openFirstGear(page);
      if ((await readColorfulCheckbox(page)) !== true) fail("stored_true_checkbox");
      await closeEditor(page);
      await ctx.close().catch(() => {});
    }

    // C) Stored colorful:false
    {
      const payload = JSON.stringify({
        items: [{ label: "OffBox", url: "https://example.com/off", social: null, hidden: false, colorful: false, slot: 1 }],
      });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installConsent(ctx);
      await ctx.addInitScript(
        ({ KEY, payload }) => {
          try {
            localStorage.setItem(KEY, payload);
          } catch (_) {}
        },
        { KEY, payload }
      );
      const page = await ctx.newPage();
      await boot(page, base);
      await seedAndHydrate(page, payload);
      await openMindMenu(page);
      const st = await snap(page);
      if (st.plain[0] !== true) fail("stored_false_not_plain");
      await openFirstGear(page);
      if ((await readColorfulCheckbox(page)) !== false) fail("stored_false_checkbox");
      await closeEditor(page);
      await ctx.close().catch(() => {});
    }

    // D) Legacy missing colorful key → ON
    {
      const payload = JSON.stringify({
        items: [{ label: "Legacy", url: "https://example.com/leg", social: null, hidden: false, slot: 1 }],
      });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await installConsent(ctx);
      await ctx.addInitScript(
        ({ KEY, payload }) => {
          try {
            localStorage.setItem(KEY, payload);
          } catch (_) {}
        },
        { KEY, payload }
      );
      const page = await ctx.newPage();
      await boot(page, base);
      await seedAndHydrate(page, payload);
      await openMindMenu(page);
      const st = await snap(page);
      if (st.plain[0] !== false) fail("legacy_missing_must_stay_colored");
      await openFirstGear(page);
      if ((await readColorfulCheckbox(page)) !== true) fail("legacy_missing_checkbox");
      await closeEditor(page);
      await ctx.close().catch(() => {});
    }

    console.log(
      "IU_MM_MAILBOX_COLORFUL_DEFAULT_OFF_PASS=" +
        JSON.stringify({ fails: FAILS.length, contract: ["fresh_off", "stored_true", "stored_false", "legacy_on", "enable_persist"] })
    );
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_COLORFUL_DEFAULT_OFF_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
