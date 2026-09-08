#!/usr/bin/env node
/**
 * MindMenu mailbox factory default = 4 for fresh users.
 * Stored custom counts must never be forced back to 4.
 *
 * Behavior (Playwright), not string-only:
 *   A) no iu_mailboxes_v1 → exactly 4 visible "Nastavit e-mail"
 *   B) stored 8 → remains 8 (labels preserved)
 *   C) stored 2 → remains 2
 *   D) fresh add+2 → reload keeps 6
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
const CTA = "Nastavit e-mail";
const DEFAULT_N = 4;
const MAX = 10;
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

function staticContract() {
  const feed = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const pkg = fs.readFileSync(path.join(REPO, "package.json"), "utf8");
  const smoke = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");

  if (!/const IU_MAILBOX_DEFAULT_COUNT\s*=\s*4\s*;/.test(feed)) fail("static_default_count_not_4");
  if (!/const IU_MAILBOX_MAX\s*=\s*10\s*;/.test(feed)) fail("static_max_changed");
  if (!/const IU_MAILBOX_MIN\s*=\s*1\s*;/.test(feed)) fail("static_min_changed");
  if (!/function iuMailboxDefaultItems\s*\(/.test(feed)) fail("static_missing_default_items");
  /* Ban force-truncate of stored lists to 4 (would wipe custom counts). */
  if (/items\.slice\s*\(\s*0\s*,\s*4\s*\)/.test(feed) && /iuMailbox/.test(feed)) {
    /* Allow only if not in load/render of mailboxes — soft check via adjacent context. */
  }
  if (/iuMailboxLoad[\s\S]{0,800}slice\s*\(\s*0\s*,\s*4\s*\)/.test(feed)) {
    fail("static_load_truncates_to_4");
  }
  if (/iuMailboxRender[\s\S]{0,1200}slice\s*\(\s*0\s*,\s*4\s*\)/.test(feed)) {
    fail("static_render_truncates_to_4");
  }
  if (pkg.indexOf("iu-mindmenu-mailbox-default-count-guard") < 0) fail("package_missing_script");
  if (smoke.indexOf("iu-mindmenu-mailbox-default-count-guard") < 0) fail("smoke_missing_guard");
}

function seedItems(n, labels) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({
      label: labels && labels[i] ? labels[i] : `Box${i + 1}`,
      url: `https://example.com/m${i + 1}`,
      social: null,
      hidden: false,
      slot: i + 1,
    });
  }
  return JSON.stringify({ items });
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

function snapshot(page) {
  return page.evaluate((cta) => {
    const pills = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-pill"));
    const labels = pills.map((el) => String(el.textContent || "").trim());
    const add = document.getElementById("iuMailboxAdd");
    const addCs = add ? getComputedStyle(add) : null;
    let stored = null;
    try {
      const raw = localStorage.getItem("iu_mailboxes_v1");
      stored = raw ? JSON.parse(raw) : null;
    } catch (_) {}
    return {
      count: pills.length,
      labels,
      allCta: labels.length > 0 && labels.every((l) => l === cta),
      addVisible: !!(add && addCs && addCs.display !== "none" && addCs.visibility !== "hidden"),
      storedLen: stored && Array.isArray(stored.items) ? stored.items.filter((it) => !it.hidden).length : null,
    };
  }, CTA);
}

async function runFresh(browser, base, name, viewport) {
  const ctx = await browser.newContext({ viewport });
  await installConsent(ctx);
  /* Explicitly no mailbox key — fresh factory path. */
  await ctx.addInitScript(() => {
    try {
      localStorage.removeItem("iu_mailboxes_v1");
    } catch (_) {}
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    const st = await snapshot(page);
    if (st.count !== DEFAULT_N) fail(`${name}_fresh_count_${st.count}`);
    if (!st.allCta) fail(`${name}_fresh_not_all_cta`);
    if (!st.addVisible) fail(`${name}_fresh_add_missing`);

    /* Persistence of growth: +2 → 6 after reload */
    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(120);
    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(120);
    let mid = await snapshot(page);
    if (mid.count !== 6) fail(`${name}_after_add_got_${mid.count}`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    const after = await snapshot(page);
    if (after.count !== 6) fail(`${name}_reload_grew_got_${after.count}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function runStored(browser, base, name, viewport, n, labels) {
  const ctx = await browser.newContext({ viewport });
  await installConsent(ctx);
  const payload = seedItems(n, labels);
  await ctx.addInitScript((args) => {
    try {
      localStorage.setItem(args.KEY, args.payload);
    } catch (_) {}
  }, { KEY, payload });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    /* After vault, durable path may own the key — re-seed via durableSet if available. */
    await page.evaluate(async (args) => {
      try {
        if (window.iuVault && typeof window.iuVault.durableSet === "function") {
          await window.iuVault.durableSet(args.KEY, args.payload);
        } else {
          localStorage.setItem(args.KEY, args.payload);
        }
        window.dispatchEvent(new Event("iu-vault-hydrated"));
      } catch (_) {}
    }, { KEY, payload });
    await page.waitForTimeout(200);
    await openMindMenu(page);
    const st = await snapshot(page);
    if (st.count !== n) fail(`${name}_stored${n}_got_${st.count}`);
    if (labels) {
      for (const lab of labels) {
        if (!st.labels.includes(lab)) fail(`${name}_stored${n}_missing_${lab}`);
      }
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  staticContract();
  const started = await startGuardStaticServer(pickGuardPort(9420, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  const viewports = {
    MOBILE: { width: 390, height: 844 },
    TABLET: { width: 768, height: 1024 },
    PC: { width: 1280, height: 800 },
  };
  try {
    for (const [name, vp] of Object.entries(viewports)) {
      await runFresh(browser, base, name, vp);
    }
    /* One viewport enough for stored preservation (shared JS). */
    await runStored(browser, base, "PC", viewports.PC, 8, ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
    await runStored(browser, base, "PC", viewports.PC, 2, ["OnlyOne", "OnlyTwo"]);
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  const report = {
    IU_MINDMENU_MAILBOX_DEFAULT_COUNT_GUARD: FAILS.length === 0 ? "PASS" : "FAIL",
    fails: FAILS,
    defaultCount: DEFAULT_N,
    max: MAX,
  };
  console.log(JSON.stringify(report, null, 2));
  if (FAILS.length) process.exit(1);
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
