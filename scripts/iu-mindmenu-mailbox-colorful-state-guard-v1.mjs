#!/usr/bin/env node
/**
 * MindMenu mailbox — Barevný input + stable slot identity + add/remove state.
 *
 * Root cause: iuMailboxLoad migrations rewritten storage WITHOUT `colorful`,
 * so colorful:false was lost on reload (defaulted via !== false → true).
 * Edit also keyed by array index (fragile with hidden slots).
 *
 * Contract:
 *   colorful OFF → save → reopen editor → OFF + plain pill
 *   colorful ON  → save → reopen editor → ON  + colored pill
 *   OFF→ON→OFF→ON cycle stays in sync
 *   migration rewrite must include colorful boolean
 *   edit/open keyed by data-mailbox-slot (stable slot id)
 *   add +1 / remove −1; edited item survives remove of another
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

const FEED = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
const PKG = fs.readFileSync(path.join(REPO, "package.json"), "utf8");
const SMOKE = fs.readFileSync(path.join(REPO, ".github", "workflows", "smoke.yml"), "utf8");

function staticContract() {
  if (!/function iuMailboxNormalizeColorful\s*\(/.test(FEED)) fail("static_missing_normalize_colorful");
  if (!/function iuMailboxToPersistedItems\s*\(/.test(FEED)) fail("static_missing_to_persisted");
  if (!/function iuMailboxPersistPayload\s*\(/.test(FEED)) fail("static_missing_persist_payload");
  if (!/function iuMailboxInvalidateCanonical\s*\(/.test(FEED)) fail("static_missing_invalidate_canonical");
  if (!/data-mailbox-slot="\$\{slot\}"/.test(FEED)) fail("static_missing_data_mailbox_slot");
  if (!/iuMailboxFindBySlot\s*\(/.test(FEED)) fail("static_missing_find_by_slot");
  if (!/#iuMailboxAdd[\s\S]{0,200}iuMailboxAddOne/.test(FEED)) fail("static_add_must_use_delegation");
  if (!/#iuMailboxRemove[\s\S]{0,200}iuMailboxRemoveOne/.test(FEED)) fail("static_remove_must_use_delegation");
  /* Ban migration writes that omit colorful (the original wipe bug). */
  const migrationWriteOmitColorful =
    /iuVaultTrySetItem\(\s*MAILBOX_STORAGE_KEY\s*,\s*JSON\.stringify\(\s*\{\s*items:\s*fixed\.map\(\s*\(it\)\s*=>\s*\(\s*\{\s*label:[\s\S]*?slot:\s*it\.slot\s*\}\s*\)\s*\)\s*\}\s*\)\s*\)/;
  if (migrationWriteOmitColorful.test(FEED)) fail("static_migration_write_omits_colorful");
  if (!/iuVaultTrySetItem\(\s*MAILBOX_STORAGE_KEY\s*,\s*iuMailboxPersistPayload\(/.test(FEED)) {
    fail("static_migration_must_use_persist_payload");
  }
  if (!/colorful:\s*iuMailboxNormalizeColorful\(/.test(FEED)) fail("static_persist_must_normalize_colorful");
  if (PKG.indexOf("iu-mindmenu-mailbox-colorful-state-guard") < 0) fail("package_missing_script");
  if (SMOKE.indexOf("iu-mindmenu-mailbox-colorful-state-guard") < 0) fail("smoke_missing_guard");
}

function seedItems(specs) {
  return JSON.stringify({
    items: specs.map((s, i) => ({
      label: s.label,
      url: s.url || `https://example.com/${i + 1}`,
      social: s.social == null ? null : s.social,
      hidden: !!s.hidden,
      colorful: s.colorful !== false,
      slot: s.slot || i + 1,
    })),
  });
}

async function openMindMenu(page) {
  await page.waitForFunction(
    () =>
      typeof window.__iuEnsureFeedPipeline === "function" ||
      typeof window.iuArticleActionsOpenOverlay === "function" ||
      document.getElementById("iuMailboxList"),
    null,
    { timeout: 120000 }
  );
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.evaluate(async () => {
        if (typeof window.__iuEnsureFeedPipeline === "function") {
          try {
            await window.__iuEnsureFeedPipeline();
          } catch (_) {}
        }
      });
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
          if (!list || !add) return false;
          const host = document.querySelector(".iuMyInfoUzelMindMenuHost");
          return !!(host && host.contains(list));
        },
        null,
        { timeout: 45000 }
      );
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(400);
    }
  }
  throw lastErr || new Error("openMindMenu_timeout");
}

async function snap(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#iuMailboxList .iu-mailbox-row"));
    const pills = rows.map((row) => {
      const pill = row.querySelector(".iu-mailbox-pill");
      const gear = row.querySelector("[data-mailbox-gear]");
      return {
        label: String((pill && pill.textContent) || "").trim(),
        plain: !!(pill && pill.classList.contains("iu-mailbox-pill--plain")),
        slot: gear ? parseInt(gear.getAttribute("data-mailbox-slot") || gear.getAttribute("data-mailbox-gear") || "0", 10) : null,
      };
    });
    let storage = null;
    try {
      storage = JSON.parse(localStorage.getItem("iu_mailboxes_v1") || "null");
    } catch (_) {}
    return { count: rows.length, pills, storage };
  });
}

async function openEditorForSlot(page, slot) {
  await page.locator(`#iuMailboxList [data-mailbox-gear][data-mailbox-slot="${slot}"]`).click({ force: true });
  await page.waitForSelector("#iu-mailbox-edit-overlay #iu-mailbox-edit-colorful", { timeout: 15000 });
}

async function readEditorColorful(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#iu-mailbox-edit-overlay #iu-mailbox-edit-colorful");
    return el ? !!el.checked : null;
  });
}

async function setEditorColorfulAndSave(page, on) {
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

async function main() {
  staticContract();
  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_COLORFUL_STATE_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }

  const started = await startGuardStaticServer(pickGuardPort(9410, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
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

    await page.evaluate(
      ({ KEY, payload }) => {
        localStorage.setItem(KEY, payload);
        window.dispatchEvent(new Event("iu-vault-hydrated"));
      },
      {
        KEY,
        payload: seedItems([
          { label: "Alpha", colorful: true, slot: 1 },
          { label: "Beta", colorful: true, slot: 2 },
          { label: "Gamma", colorful: true, slot: 3 },
        ]),
      }
    );
    await page.waitForTimeout(200);

    let st = await snap(page);
    if (st.count !== 3) fail(`seed_count_${st.count}`);

    // Cycle colorful on slot 2: ON→OFF→ON→OFF
    const cycle = [false, true, false, true, false];
    for (let i = 0; i < cycle.length; i++) {
      const want = cycle[i];
      await openEditorForSlot(page, 2);
      const before = await readEditorColorful(page);
      if (i === 0 && before !== true) fail(`cycle_initial_checkbox_${before}`);
      await setEditorColorfulAndSave(page, want);
      await page.waitForTimeout(80);
      st = await snap(page);
      const beta = st.pills.find((p) => p.slot === 2);
      if (!beta) fail(`cycle_${i}_beta_missing`);
      else if (beta.plain !== !want) fail(`cycle_${i}_plain_got_${beta.plain}_want_${!want}`);
      const stored = (st.storage && st.storage.items || []).find((it) => it.slot === 2);
      if (!stored || stored.colorful !== want) fail(`cycle_${i}_storage_colorful_${stored && stored.colorful}`);
      await openEditorForSlot(page, 2);
      const after = await readEditorColorful(page);
      if (after !== want) fail(`cycle_${i}_reopen_checkbox_${after}_want_${want}`);
      await closeEditor(page);
    }

    // Add → 4, edit new, remove last-but-keep Alpha config
    const beforeAdd = (await snap(page)).count;
    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(120);
    st = await snap(page);
    if (st.count !== beforeAdd + 1) fail(`add_count_${st.count}_from_${beforeAdd}`);

    await openEditorForSlot(page, 1);
    await page.fill("#iu-mailbox-edit-label", "AlphaKeep");
    await page.fill("#iu-mailbox-edit-url", "https://example.com/alpha-keep");
    await setEditorColorfulAndSave(page, false);
    await page.waitForTimeout(80);

    await page.locator("#iuMailboxRemove").click({ force: true });
    await page.waitForTimeout(120);
    st = await snap(page);
    const alpha = st.pills.find((p) => p.label === "AlphaKeep");
    if (!alpha) fail("remove_lost_edited_alpha");
    else if (!alpha.plain) fail("remove_lost_alpha_plain");
    const alphaStored = (st.storage && st.storage.items || []).find((it) => it.label === "AlphaKeep");
    if (!alphaStored || alphaStored.colorful !== false) fail("remove_alpha_storage_colorful");

    // Persistence across reload
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });
    st = await snap(page);
    const alphaReload = st.pills.find((p) => p.label === "AlphaKeep");
    if (!alphaReload) fail("reload_alpha_missing");
    else if (!alphaReload.plain) fail("reload_alpha_not_plain");
    await openEditorForSlot(page, alphaReload.slot);
    const reloadCb = await readEditorColorful(page);
    if (reloadCb !== false) fail(`reload_checkbox_${reloadCb}`);
    await closeEditor(page);

    // Migration must not strip colorful:false — simulate dirty rewrite via hydrate after ensuring colorful present
    await page.evaluate(({ KEY }) => {
      const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      const items = Array.isArray(raw.items) ? raw.items : [];
      for (const it of items) {
        if (it && it.label === "AlphaKeep") it.colorful = false;
      }
      // Intentionally omit colorful on a sibling to force repair path, without touching AlphaKeep false
      if (items[1] && Object.prototype.hasOwnProperty.call(items[1], "colorful")) {
        delete items[1].colorful;
      }
      localStorage.setItem(KEY, JSON.stringify({ items }));
      window.dispatchEvent(new Event("iu-vault-hydrated"));
    }, { KEY });
    await page.waitForTimeout(200);
    st = await snap(page);
    const alphaAfterMig = (st.storage && st.storage.items || []).find((it) => it.label === "AlphaKeep");
    if (!alphaAfterMig || alphaAfterMig.colorful !== false) fail("migration_stripped_alpha_colorful_false");
    // Missing colorful on sibling must NOT force a load-time rewrite of AlphaKeep.
    // After a user-visible mutation (add), persist must include colorful on all items.
    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(120);
    st = await snap(page);
    const alphaAfterSave = (st.storage && st.storage.items || []).find((it) => it.label === "AlphaKeep");
    if (!alphaAfterSave || alphaAfterSave.colorful !== false) fail("post_add_stripped_alpha_colorful_false");
    if ((st.storage && st.storage.items || []).some((it) => it && !Object.prototype.hasOwnProperty.call(it, "colorful"))) {
      fail("user_save_left_items_without_colorful");
    }

    console.log(
      "IU_MM_MAILBOX_COLORFUL_STATE=" +
        JSON.stringify({
          count: st.count,
          alphaPlain: !!(st.pills.find((p) => p.label === "AlphaKeep") || {}).plain,
          fails: FAILS.length,
        })
    );
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_MM_MAILBOX_COLORFUL_STATE_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_MM_MAILBOX_COLORFUL_STATE_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
