#!/usr/bin/env node
/**
 * MindMenu mailbox — fresh-user social icons on first stable render.
 *
 * Contract:
 *   A) no iu_mailboxes_v1 → first MindMenu open (no clicks) shows
 *      facebook, Instagram, x, tiktok social slots
 *   B) reload + reopen → same socials still present
 *   C) + Přidat → 5th row gets linkedin (existing slot-5 default)
 *   D) stored custom socials preserved (no overwrite of user state)
 *   E) factory default items must set IU_MAILBOX_DEFAULT_SOCIAL (not null)
 *
 * Does NOT require user interaction to reveal social icons on first visit.
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
const EXPECTED_FRESH = ["facebook", "instagram", "x", "tiktok"];
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

  if (!/const IU_MAILBOX_DEFAULT_SOCIAL\s*=\s*\[\s*"facebook"\s*,\s*"instagram"\s*,\s*"x"\s*,\s*"tiktok"\s*\]/.test(feed)) {
    fail("static_default_social_list_changed");
  }
  if (
    !/function iuMailboxDefaultItems\s*\([\s\S]{0,900}?social:\s*IU_MAILBOX_DEFAULT_SOCIAL\[i\]\s*\|\|\s*null/.test(
      feed
    )
  ) {
    fail("static_default_items_must_set_default_social");
  }
  if (/function iuMailboxDefaultItems\s*\([\s\S]{0,700}?social:\s*null/.test(feed)) {
    fail("static_default_items_still_null_social");
  }
  if (pkg.indexOf("iu-mindmenu-mailbox-social-first-render-guard") < 0) fail("package_missing_script");
  if (smoke.indexOf("iu-mindmenu-mailbox-social-first-render-guard") < 0) fail("smoke_missing_guard");
  if (!/mindmenu-social-first-render-v1-20260914/.test(app)) fail("app_js_cachebust_missing");
  if (!/mindmenu-social-first-render-v1-20260914/.test(shell)) fail("shell_cachebust_missing");
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

function snapSocial(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-row"));
    const socials = rows.map((row) => {
      const slot = row.querySelector("[data-mailbox-social][data-social]");
      return slot ? String(slot.getAttribute("data-social") || "").trim() : null;
    });
    const pills = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-pill"));
    return {
      rowCount: rows.length,
      pillCount: pills.length,
      socials,
      socialCount: socials.filter(Boolean).length,
      gears: document.querySelectorAll("#iuMailboxList [data-mailbox-gear]").length,
    };
  });
}

async function boot(page, base) {
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForVaultReady(page, 120000);
  await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
  await openMindMenu(page);
}

function expectFreshSocials(st, prefix) {
  if (st.pillCount !== 4) fail(prefix + "_pill_count_" + st.pillCount);
  if (st.gears !== 4) fail(prefix + "_gear_count_" + st.gears);
  if (st.socialCount !== 4) fail(prefix + "_social_count_" + st.socialCount);
  for (let i = 0; i < EXPECTED_FRESH.length; i++) {
    if (st.socials[i] !== EXPECTED_FRESH[i]) {
      fail(prefix + "_social_" + i + "_got_" + String(st.socials[i]));
    }
  }
}

async function main() {
  staticContract();
  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_SOCIAL_FIRST_RENDER_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }

  const started = await startGuardStaticServer(pickGuardPort(9430, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });

  try {
    // A + B) Fresh first render + reload (desktop)
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installConsent(ctx);
      await ctx.addInitScript(() => {
        try {
          localStorage.removeItem("iu_mailboxes_v1");
          localStorage.removeItem("iu_mm_social_defaults_v1");
        } catch (_) {}
      });
      const page = await ctx.newPage();
      await boot(page, base);
      // Critical: assert BEFORE any Add/Remove/gear click.
      const first = await snapSocial(page);
      expectFreshSocials(first, "fresh_first");

      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await waitForVaultReady(page, 120000);
      await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
      await openMindMenu(page);
      const reloaded = await snapSocial(page);
      expectFreshSocials(reloaded, "fresh_reload");

      // C) Add → LinkedIn on 5th
      await page.locator("#iuMailboxAdd").click({ force: true });
      await page.waitForTimeout(120);
      const afterAdd = await snapSocial(page);
      if (afterAdd.pillCount !== 5) fail("add_pill_count_" + afterAdd.pillCount);
      if (afterAdd.socials[4] !== "linkedin") fail("add_slot5_not_linkedin_" + String(afterAdd.socials[4]));
      for (let i = 0; i < 4; i++) {
        if (afterAdd.socials[i] !== EXPECTED_FRESH[i]) fail("add_preserved_" + i + "_" + String(afterAdd.socials[i]));
      }

      // Remove back to 4
      await page.locator("#iuMailboxRemove").click({ force: true });
      await page.waitForTimeout(120);
      const afterRem = await snapSocial(page);
      expectFreshSocials(afterRem, "after_remove");
      await ctx.close().catch(() => {});
    }

    // Mobile viewport fresh first render
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await installConsent(ctx);
      await ctx.addInitScript(() => {
        try {
          localStorage.removeItem("iu_mailboxes_v1");
          localStorage.removeItem("iu_mm_social_defaults_v1");
        } catch (_) {}
      });
      const page = await ctx.newPage();
      await boot(page, base);
      const mobile = await snapSocial(page);
      expectFreshSocials(mobile, "mobile_fresh");
      await ctx.close().catch(() => {});
    }

    // D) Existing user custom socials preserved
    {
      const payload = JSON.stringify({
        items: [
          { label: "Work", url: "https://example.com/w", social: "youtube", hidden: false, colorful: false, slot: 1 },
          { label: "Home", url: "https://example.com/h", social: "messenger", hidden: false, colorful: false, slot: 2 },
        ],
      });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installConsent(ctx);
      await ctx.addInitScript(
        ({ KEY, payload }) => {
          try {
            localStorage.setItem(KEY, payload);
            localStorage.setItem("iu_mm_social_defaults_v1", "1");
          } catch (_) {}
        },
        { KEY, payload }
      );
      const page = await ctx.newPage();
      await boot(page, base);
      const st = await snapSocial(page);
      if (st.pillCount !== 2) fail("stored_pill_count_" + st.pillCount);
      if (st.socials[0] !== "youtube") fail("stored_social0_" + String(st.socials[0]));
      if (st.socials[1] !== "messenger") fail("stored_social1_" + String(st.socials[1]));
      await ctx.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_SOCIAL_FIRST_RENDER_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_MM_MAILBOX_SOCIAL_FIRST_RENDER_PASS=true");
}

main().catch((err) => {
  console.error("IU_MM_MAILBOX_SOCIAL_FIRST_RENDER_FAIL=uncaught_" + String(err && err.message ? err.message : err));
  process.exitCode = 1;
});
