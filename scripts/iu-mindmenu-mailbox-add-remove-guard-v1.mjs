/**
 * MindMenu mailbox Add/Remove controls — regression guard.
 *
 * Root cause (07b8049): vault hydrate/unlock re-rendered pills but left
 * #iuMailboxAdd display + closed-over mailboxCount stuck on pre-hydrate
 * defaults (often 10 → Add hidden while only 3–4 pills visible).
 *
 * Contract:
 *   count < MAX → + Přidat tlačítko visible + click adds exactly 1
 *   count = MAX → Add not available
 *   Remove → count − 1; Add available again when below MAX
 *   Add → durable save → reload → same count
 *   Existing labels preserved across add
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
const MAX = 10;
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

const FEED = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");

// Static: MAX remains project constant 10
if (!/const IU_MAILBOX_MAX\s*=\s*10\s*;/.test(FEED)) fail("static_max_not_10");
if (!/const IU_MAILBOX_MIN\s*=\s*1\s*;/.test(FEED)) fail("static_min_not_1");

// Static: hydrate/unlock must refresh controls via render return (not render-only)
if (
  !/iu-vault-hydrated[\s\S]{0,220}mailboxCount\s*=\s*iuMailboxRender\s*\(\s*\)/.test(FEED)
) {
  fail("static_hydrate_must_sync_mailboxCount_from_render");
}
if (
  !/iu-vault-unlocked[\s\S]{0,220}mailboxCount\s*=\s*iuMailboxRender\s*\(\s*\)/.test(FEED)
) {
  fail("static_unlock_must_sync_mailboxCount_from_render");
}

// Static: render itself must update Add/Remove visibility
if (
  !/function iuMailboxRender\s*\(\s*\)\s*\{[\s\S]{0,3500}iuUpdateMailboxControls\s*\(/.test(FEED)
) {
  fail("static_render_must_call_iuUpdateMailboxControls");
}

function seedPayload(visible, labels) {
  const items = [];
  for (let i = 0; i < MAX; i++) {
    const slot = i + 1;
    const hidden = i >= visible;
    items.push({
      label: hidden ? "" : labels[i] || `Seed${slot}`,
      url: hidden ? "" : `https://example.com/m${slot}`,
      social: null,
      hidden,
      slot,
    });
  }
  return JSON.stringify({ items });
}

function controlState(page) {
  return page.evaluate(() => {
    const add = document.getElementById("iuMailboxAdd");
    const rem = document.getElementById("iuMailboxRemove");
    const rows = document.querySelectorAll("#iuMailboxList .iu-mailbox-row");
    const addCs = add ? getComputedStyle(add) : null;
    const remCs = rem ? getComputedStyle(rem) : null;
    const labels = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-pill")).map((el) =>
      String(el.textContent || "").trim()
    );
    return {
      rowCount: rows.length,
      addDisplay: add ? add.style.display : null,
      remDisplay: rem ? rem.style.display : null,
      addVisible: !!(add && addCs && addCs.display !== "none" && addCs.visibility !== "hidden"),
      remVisible: !!(rem && remCs && remCs.display !== "none" && remCs.visibility !== "hidden"),
      labels,
      storage: localStorage.getItem("iu_mailboxes_v1"),
    };
  });
}

async function openMindMenu(page) {
  await page.waitForFunction(
    () =>
      typeof window.iuArticleActionsOpenOverlay === "function" ||
      document.getElementById("iuMailboxList") ||
      document.getElementById("iuMobileGateWrap"),
    null,
    { timeout: 90000 }
  );
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      try {
        await window.__iuEnsureFeedPipeline();
      } catch (_) {}
    }
    const narrow = !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
    if (narrow) {
      const wrap = document.getElementById("iuMobileGateWrap");
      if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
        wrap.__iuMobileGateSetTab("tools");
      } else {
        const tab = document.getElementById("iuMobileGateTabTools");
        if (tab) tab.click();
      }
      return;
    }
    if (typeof window.iuArticleActionsOpenOverlay === "function") {
      try {
        await window.iuArticleActionsOpenOverlay();
      } catch (_) {}
    }
  });
  await page.waitForFunction(
    () => {
      const add = document.getElementById("iuMailboxAdd");
      const row = document.querySelector("#iuMailboxList .iu-mailbox-row");
      if (!add && !row) return false;
      const el = row || add;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0;
    },
    null,
    { timeout: 90000 }
  );
}

async function runViewport(browser, base, name, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });

    // Repro hydrate race: force pre-hydrate UI (10 defaults / Add hidden), then inject 3 visible + hydrate.
    await page.evaluate(({ KEY, payload }) => {
      const add = document.getElementById("iuMailboxAdd");
      const rem = document.getElementById("iuMailboxRemove");
      if (add) add.style.display = "none";
      if (rem) rem.style.display = "inline";
      localStorage.setItem(KEY, payload);
      window.dispatchEvent(new Event("iu-vault-hydrated"));
    }, { KEY, payload: seedPayload(3, ["Alpha", "Beta", "Gamma"]) });

    await page.waitForTimeout(200);
    let st = await controlState(page);
    if (st.rowCount !== 3) fail(`${name}_hydrate_rowCount_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_hydrate_add_not_visible`);
    if (!st.remVisible) fail(`${name}_hydrate_remove_not_visible`);
    if (!st.labels.includes("Alpha") || !st.labels.includes("Beta") || !st.labels.includes("Gamma")) {
      fail(`${name}_hydrate_labels_lost`);
    }

    // 3 → 4 via Add
    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(150);
    st = await controlState(page);
    if (st.rowCount !== 4) fail(`${name}_add_3to4_got_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_add_still_visible_at_4`);
    if (!st.labels.includes("Alpha") || !st.labels.includes("Beta") || !st.labels.includes("Gamma")) {
      fail(`${name}_add_mutated_existing_labels`);
    }

    // Climb to MAX
    for (let c = 4; c < MAX; c++) {
      await page.locator("#iuMailboxAdd").click({ force: true });
      await page.waitForTimeout(80);
    }
    st = await controlState(page);
    if (st.rowCount !== MAX) fail(`${name}_reach_max_got_${st.rowCount}`);
    if (st.addVisible) fail(`${name}_add_visible_at_max`);
    if (!st.remVisible) fail(`${name}_remove_hidden_at_max`);

    // Extra Add must not exceed MAX
    await page.evaluate(() => {
      const add = document.getElementById("iuMailboxAdd");
      if (add) {
        add.style.display = "inline";
        add.click();
      }
    });
    await page.waitForTimeout(100);
    st = await controlState(page);
    if (st.rowCount !== MAX) fail(`${name}_exceeded_max_got_${st.rowCount}`);

    // MAX → MAX-1 via Remove; Add returns
    await page.locator("#iuMailboxRemove").click({ force: true });
    await page.waitForTimeout(150);
    st = await controlState(page);
    if (st.rowCount !== MAX - 1) fail(`${name}_remove_from_max_got_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_add_missing_after_remove_from_max`);

    // Persistence: set 5, reload, same count + labels
    await page.evaluate(({ KEY, payload }) => {
      localStorage.setItem(KEY, payload);
      window.dispatchEvent(new Event("iu-vault-hydrated"));
    }, { KEY, payload: seedPayload(5, ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) });
    await page.waitForTimeout(150);
    st = await controlState(page);
    if (st.rowCount !== 5) fail(`${name}_pre_reload_seed5_got_${st.rowCount}`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });
    st = await controlState(page);
    if (st.rowCount !== 5) fail(`${name}_reload_count_got_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_reload_add_not_visible`);
    if (!st.labels.includes("Alpha") || !st.labels.includes("Epsilon")) {
      fail(`${name}_reload_labels_lost`);
    }

    console.log(
      `IU_MM_MAILBOX_ADD_REMOVE_${name}=` +
        JSON.stringify({
          viewport,
          rowCount: st.rowCount,
          addVisible: st.addVisible,
          remVisible: st.remVisible,
          max: MAX,
        })
    );
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9400, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, base, "PC", { width: 1280, height: 800 });
    await runViewport(browser, base, "MOBILE", { width: 390, height: 844 });
    await runViewport(browser, base, "TABLET", { width: 768, height: 1024 });
  } finally {
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_ADD_REMOVE_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_MM_MAILBOX_ADD_REMOVE_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
