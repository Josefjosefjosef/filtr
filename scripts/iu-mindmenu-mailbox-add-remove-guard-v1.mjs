/**
 * MindMenu mailbox Add/Remove controls — regression guard.
 *
 * A) Controls/hydrate (historical 07b8049):
 *   count < MAX → + Přidat visible + click adds exactly 1
 *   count = MAX → Add not available
 *   Remove → count − 1; Add available again when below MAX
 *   Add → durable save → reload → same count
 *
 * B) Mobile/tablet/PWA geometry (stale #iuMobileMindMenuFlow minHeight):
 *   After each add/remove in 1→10→1, flow minHeight tracks .mindMenu height,
 *   scrollHeight moves with content, no huge empty gap above bottom nav,
 *   last tile not covered by bottom nav.
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
/** Flow minHeight may lag 1px; stale bug left hundreds of px. */
const FLOW_SLACK_MAX_PX = 12;
/** Design bottom padding for fixed nav (~56+safe+gap) + small rounding. */
const BOTTOM_GAP_MAX_PX = 140;
const BOTTOM_GAP_MIN_PX = -2;

function fail(id) {
  FAILS.push(id);
}

const FEED = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");

// Static: MAX remains project constant 10
if (!/const IU_MAILBOX_MAX\s*=\s*10\s*;/.test(FEED)) fail("static_max_not_10");
if (!/const IU_MAILBOX_MIN\s*=\s*1\s*;/.test(FEED)) fail("static_min_not_1");

// Static: hydrate/unlock must refresh controls via render return (not render-only)
if (
  !/iu-vault-hydrated[\s\S]{0,280}mailboxCount\s*=\s*iuMailboxRender\s*\(\s*\)/.test(FEED)
) {
  fail("static_hydrate_must_sync_mailboxCount_from_render");
}
if (
  !/iu-vault-unlocked[\s\S]{0,280}mailboxCount\s*=\s*iuMailboxRender\s*\(\s*\)/.test(FEED)
) {
  fail("static_unlock_must_sync_mailboxCount_from_render");
}

// Static: render itself must update Add/Remove visibility
if (
  !/function iuMailboxRender\s*\(\s*\)\s*\{[\s\S]{0,3500}iuUpdateMailboxControls\s*\(/.test(FEED)
) {
  fail("static_render_must_call_iuUpdateMailboxControls");
}

// Static: add/remove must sync mobile MindMenu flow height (same mechanism as custom buttons)
if (!/function iuMailboxSyncLayoutAfterCountChange\s*\(/.test(FEED)) {
  fail("static_missing_iuMailboxSyncLayoutAfterCountChange");
}
if (
  !/function iuMailboxSyncLayoutAfterCountChange\s*\(\s*\)\s*\{[\s\S]{0,500}iuQuickToolsSyncMobileMindMenuFlowHeight\s*\(/.test(
    FEED
  )
) {
  fail("static_mailbox_sync_must_call_flow_height_sync");
}
if (!/iuMailboxAdd[\s\S]{0,1200}iuMailboxSyncLayoutAfterCountChange\s*\(/.test(FEED)) {
  fail("static_add_must_sync_layout_height");
}
if (!/iuMailboxRemove[\s\S]{0,1200}iuMailboxSyncLayoutAfterCountChange\s*\(/.test(FEED)) {
  fail("static_remove_must_sync_layout_height");
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
      typeof window.__iuEnsureFeedPipeline === "function" ||
      typeof window.iuArticleActionsOpenOverlay === "function" ||
      document.getElementById("iuMailboxList") ||
      document.getElementById("iuMobileGateWrap"),
    null,
    { timeout: 120000 }
  );
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const narrow = await page.evaluate(() => !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches));
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
          } else {
            const tab = document.getElementById("iuMobileGateTabTools");
            if (tab) tab.click();
          }
        });
        await page.waitForFunction(
          () => {
            const panel = document.getElementById("iuMobileGatePanelTools");
            const list = document.getElementById("iuMailboxList");
            const add = document.getElementById("iuMailboxAdd");
            if (!panel || !list || !add) return false;
            const flow = document.getElementById("iuMobileMindMenuFlow");
            const inTools = panel.contains(list) || (flow && panel.contains(flow) && flow.contains(list));
            return inTools;
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
            if (!list || !add) return false;
            const host = document.querySelector(".iuMyInfoUzelMindMenuHost");
            return !!(host && host.contains(list) && host.contains(add));
          },
          null,
          { timeout: 45000 }
        );
      }
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500);
    }
  }
  throw lastErr || new Error("openMindMenu_timeout");
}

function layoutGeometry(page) {
  return page.evaluate(() => {
    const panel = document.getElementById("iuMobileGatePanelTools");
    const flow = document.getElementById("iuMobileMindMenuFlow");
    const mind = flow ? flow.querySelector(".mindMenu") : document.querySelector(".mindMenu");
    const rows = document.querySelectorAll("#iuMailboxList .iu-mailbox-row");
    const nav =
      document.getElementById("iuMobileBottomNav") ||
      document.querySelector(".iu-mobileBottomNav");
    const tiles = mind
      ? Array.from(mind.querySelectorAll(".iu-mmQuickGrid .iuTile")).filter((t) => {
          if (t.hidden) return false;
          const cs = getComputedStyle(t);
          return cs.display !== "none" && cs.visibility !== "hidden";
        })
      : [];
    const lastTile = tiles.length ? tiles[tiles.length - 1] : null;
    const lastContent = lastTile || (mind ? mind.querySelector("section.iu-mmQuickLinks") : null) || mind;

    let scrollHost = null;
    if (panel) {
      const cs = getComputedStyle(panel);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) || panel.scrollHeight > panel.clientHeight + 1) {
        scrollHost = panel;
      }
    }
    if (!scrollHost) {
      scrollHost = document.scrollingElement || document.documentElement;
    }
    const prevTop = scrollHost.scrollTop;
    scrollHost.scrollTop = scrollHost.scrollHeight;
    const mindH = mind ? Math.round(mind.getBoundingClientRect().height) : 0;
    const flowH = flow ? Math.round(flow.getBoundingClientRect().height) : 0;
    const flowMin = flow ? Math.round(parseFloat(flow.style.minHeight) || 0) : 0;
    const lastRect = lastContent ? lastContent.getBoundingClientRect() : null;
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const lastBottom = lastRect ? Math.round(lastRect.bottom) : 0;
    const navTop = navRect ? Math.round(navRect.top) : 0;
    const gap = navTop ? navTop - lastBottom : null;
    const scrollH = scrollHost.scrollHeight || 0;
    const overflowScrollers = Array.from(
      document.querySelectorAll("#iuMobileGatePanelTools, #iuMobileMindMenuFlow, .mindMenu, .mindMenu-scroll-wrapper")
    ).filter((el) => {
      const cs = getComputedStyle(el);
      return /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2;
    }).length;
    scrollHost.scrollTop = prevTop;
    return {
      rowCount: rows.length,
      mindH,
      flowH,
      flowMin,
      flowSlack: flowH - mindH,
      minSlack: flowMin > 0 ? flowMin - mindH : 0,
      scrollH,
      lastBottom,
      navTop,
      gap,
      overflowScrollers,
    };
  });
}

function assertGeometryOk(name, step, g, prev) {
  if (g.rowCount !== step.count) fail(`${name}_geom_count_${step.tag}_got_${g.rowCount}_want_${step.count}`);
  if (g.flowSlack > FLOW_SLACK_MAX_PX) fail(`${name}_geom_flow_slack_${step.tag}_${g.flowSlack}`);
  if (g.minSlack > FLOW_SLACK_MAX_PX) fail(`${name}_geom_min_slack_${step.tag}_${g.minSlack}`);
  if (g.gap != null) {
    if (g.gap < BOTTOM_GAP_MIN_PX) fail(`${name}_geom_nav_covers_content_${step.tag}_gap_${g.gap}`);
    if (g.gap > BOTTOM_GAP_MAX_PX) fail(`${name}_geom_excess_bottom_gap_${step.tag}_gap_${g.gap}`);
  }
  if (g.overflowScrollers > 1) fail(`${name}_geom_nested_scroll_${step.tag}_${g.overflowScrollers}`);
  if (prev && step.dir === "up") {
    if (!(g.mindH >= prev.mindH - 1)) fail(`${name}_geom_mindH_not_grow_${step.tag}_${prev.mindH}_to_${g.mindH}`);
    if (!(g.scrollH >= prev.scrollH - 1)) fail(`${name}_geom_scrollH_not_grow_${step.tag}_${prev.scrollH}_to_${g.scrollH}`);
    if (g.flowMin > 0 && prev.flowMin > 0 && !(g.flowMin >= prev.flowMin - 1)) {
      fail(`${name}_geom_flowMin_not_grow_${step.tag}_${prev.flowMin}_to_${g.flowMin}`);
    }
  }
  if (prev && step.dir === "down") {
    if (!(g.mindH <= prev.mindH + 1)) fail(`${name}_geom_mindH_not_shrink_${step.tag}_${prev.mindH}_to_${g.mindH}`);
    if (!(g.scrollH <= prev.scrollH + 1)) fail(`${name}_geom_scrollH_not_shrink_${step.tag}_${prev.scrollH}_to_${g.scrollH}`);
    if (g.flowMin > 0 && prev.flowMin > 0 && !(g.flowMin <= prev.flowMin + 1)) {
      fail(`${name}_geom_flowMin_not_shrink_${step.tag}_${prev.flowMin}_to_${g.flowMin}`);
    }
  }
}

async function runControlViewport(browser, base, name, viewport) {
  const ctx = await browser.newContext({ viewport });
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
        const add = document.getElementById("iuMailboxAdd");
        const rem = document.getElementById("iuMailboxRemove");
        if (add) add.style.display = "none";
        if (rem) rem.style.display = "inline";
        localStorage.setItem(KEY, payload);
        window.dispatchEvent(new Event("iu-vault-hydrated"));
      },
      { KEY, payload: seedPayload(3, ["Alpha", "Beta", "Gamma"]) }
    );

    await page.waitForTimeout(200);
    let st = await controlState(page);
    if (st.rowCount !== 3) fail(`${name}_hydrate_rowCount_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_hydrate_add_not_visible`);
    if (!st.remVisible) fail(`${name}_hydrate_remove_not_visible`);
    if (!st.labels.includes("Alpha") || !st.labels.includes("Beta") || !st.labels.includes("Gamma")) {
      fail(`${name}_hydrate_labels_lost`);
    }

    await page.locator("#iuMailboxAdd").click({ force: true });
    await page.waitForTimeout(150);
    st = await controlState(page);
    if (st.rowCount !== 4) fail(`${name}_add_3to4_got_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_add_still_visible_at_4`);
    if (!st.labels.includes("Alpha") || !st.labels.includes("Beta") || !st.labels.includes("Gamma")) {
      fail(`${name}_add_mutated_existing_labels`);
    }

    for (let c = 4; c < MAX; c++) {
      await page.locator("#iuMailboxAdd").click({ force: true });
      await page.waitForTimeout(80);
    }
    st = await controlState(page);
    if (st.rowCount !== MAX) fail(`${name}_reach_max_got_${st.rowCount}`);
    if (st.addVisible) fail(`${name}_add_visible_at_max`);
    if (!st.remVisible) fail(`${name}_remove_hidden_at_max`);

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

    await page.locator("#iuMailboxRemove").click({ force: true });
    await page.waitForTimeout(150);
    st = await controlState(page);
    if (st.rowCount !== MAX - 1) fail(`${name}_remove_from_max_got_${st.rowCount}`);
    if (!st.addVisible) fail(`${name}_add_missing_after_remove_from_max`);

    await page.evaluate(
      ({ KEY, payload }) => {
        localStorage.setItem(KEY, payload);
        window.dispatchEvent(new Event("iu-vault-hydrated"));
      },
      { KEY, payload: seedPayload(5, ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) }
    );
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

async function runGeometryViewport(browser, base, name, viewport, opts) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: !!opts.isMobile,
    hasTouch: !!opts.hasTouch,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
  });
  await ctx.addInitScript((payload) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem("iu_mailboxes_v1", payload);
    } catch (_) {}
  }, seedPayload(1, ["One"]));
  if (opts.displayModeStandalone) {
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: (function (orig) {
            return function (query) {
              const q = String(query || "");
              if (/display-mode:\s*standalone/i.test(q) || /display-mode:\s*minimal-ui/i.test(q)) {
                return {
                  matches: true,
                  media: q,
                  onchange: null,
                  addListener: function () {},
                  removeListener: function () {},
                  addEventListener: function () {},
                  removeEventListener: function () {},
                  dispatchEvent: function () {
                    return false;
                  },
                };
              }
              return orig.call(window, query);
            };
          })(window.matchMedia.bind(window)),
        });
      } catch (_) {}
    });
  }
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openMindMenu(page);
    await page.waitForFunction(() => window.__iuMailboxesInitDone === 1, null, { timeout: 90000 });
    await page.waitForTimeout(200);

    let st = await controlState(page);
    if (st.rowCount !== 1) {
      await page.evaluate(
        ({ KEY, payload }) => {
          localStorage.setItem(KEY, payload);
          window.dispatchEvent(new Event("iu-vault-hydrated"));
        },
        { KEY, payload: seedPayload(1, ["One"]) }
      );
      await page.waitForTimeout(200);
      st = await controlState(page);
    }
    if (st.rowCount !== 1) fail(`${name}_geom_start_count_${st.rowCount}`);

    let prev = await layoutGeometry(page);
    assertGeometryOk(name, { count: 1, tag: "n1", dir: null }, prev, null);

    for (let n = 2; n <= MAX; n++) {
      await page.locator("#iuMailboxAdd").click({ force: true });
      await page.waitForTimeout(120);
      const g = await layoutGeometry(page);
      assertGeometryOk(name, { count: n, tag: `add_${n}`, dir: "up" }, g, prev);
      prev = g;
    }

    for (let n = MAX - 1; n >= 1; n--) {
      await page.locator("#iuMailboxRemove").click({ force: true });
      await page.waitForTimeout(120);
      const g = await layoutGeometry(page);
      assertGeometryOk(name, { count: n, tag: `rem_${n}`, dir: "down" }, g, prev);
      prev = g;
    }

    // Stress jumps via sequential clicks without leaving MindMenu
    const stress = [5, 10, 8, 3, 7, 2, 10, 1];
    let cur = 1;
    for (const target of stress) {
      while (cur < target) {
        await page.locator("#iuMailboxAdd").click({ force: true });
        cur += 1;
        await page.waitForTimeout(70);
        const g = await layoutGeometry(page);
        assertGeometryOk(name, { count: cur, tag: `stress_up_${cur}`, dir: "up" }, g, prev);
        prev = g;
      }
      while (cur > target) {
        await page.locator("#iuMailboxRemove").click({ force: true });
        cur -= 1;
        await page.waitForTimeout(70);
        const g = await layoutGeometry(page);
        assertGeometryOk(name, { count: cur, tag: `stress_dn_${cur}`, dir: "down" }, g, prev);
        prev = g;
      }
    }

    // Close + reopen must not change geometry (proves live sync already correct)
    const beforeClose = await layoutGeometry(page);
    await page.evaluate(() => {
      const wrap = document.getElementById("iuMobileGateWrap");
      if (wrap && typeof wrap.__iuMobileGateSetTab === "function") wrap.__iuMobileGateSetTab("");
    });
    await page.waitForTimeout(150);
    await openMindMenu(page);
    await page.waitForTimeout(200);
    const afterReopen = await layoutGeometry(page);
    if (Math.abs(afterReopen.mindH - beforeClose.mindH) > 4) {
      fail(`${name}_geom_reopen_mindH_changed_${beforeClose.mindH}_to_${afterReopen.mindH}`);
    }
    if (Math.abs(afterReopen.flowMin - beforeClose.flowMin) > 4) {
      fail(`${name}_geom_reopen_flowMin_changed_${beforeClose.flowMin}_to_${afterReopen.flowMin}`);
    }
    if (afterReopen.minSlack > FLOW_SLACK_MAX_PX) {
      fail(`${name}_geom_reopen_min_slack_${afterReopen.minSlack}`);
    }

    console.log(
      `IU_MM_MAILBOX_HEIGHT_GEOM_${name}=` +
        JSON.stringify({
          viewport,
          finalCount: afterReopen.rowCount,
          mindH: afterReopen.mindH,
          flowMin: afterReopen.flowMin,
          flowSlack: afterReopen.flowSlack,
          gap: afterReopen.gap,
          pwa: !!opts.displayModeStandalone,
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
  /* Default: PC controls + mobile/tablet/PWA geometry (the regression under test). */
  const wanted = String(process.env.IU_MM_MAILBOX_VIEWPORTS || "PC,MOBILE,TABLET,PWA")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const catalog = {
    PC: { width: 1280, height: 800 },
    MOBILE: { width: 390, height: 844, isMobile: true, hasTouch: true },
    TABLET: { width: 768, height: 1024, isMobile: true, hasTouch: true },
    PWA: {
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      displayModeStandalone: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  };
  try {
    for (const name of wanted) {
      const vp = catalog[name];
      if (!vp) {
        fail(`unknown_viewport_${name}`);
        continue;
      }
      if (name === "PC") {
        await runControlViewport(browser, base, name, { width: vp.width, height: vp.height });
      } else {
        await runGeometryViewport(
          browser,
          base,
          name,
          { width: vp.width, height: vp.height },
          {
            isMobile: !!vp.isMobile,
            hasTouch: !!vp.hasTouch,
            displayModeStandalone: !!vp.displayModeStandalone,
            userAgent: vp.userAgent,
          }
        );
      }
    }
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
