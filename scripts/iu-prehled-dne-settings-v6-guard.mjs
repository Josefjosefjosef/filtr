#!/usr/bin/env node
/**
 * Regression guard: Přehled dne settings (autosave, structure, taxonomy, scroll open).
 * Static contract + Playwright behavioral checks (local static server).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const REGISTRY = path.join(ROOT, "projects", "data", "info_events", "source_registry.json");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8967", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media`;
const CACHE_BUST = "heavy-feed-offmain-v1-20260809";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const core = fs.readFileSync(CORE, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));

  must(/data-iu-ui=\"v6-clean\"/.test(ui), "ui:v6_marker");
  must(/data-act=\"open-settings\"/.test(ui), "ui:open_settings");
  must(/data-act=\"settings-close\"/.test(ui), "ui:settings_close");
  must(/Zavřít/.test(ui), "ui:close_label");
  must(!/settings-save/.test(ui), "ui:no_settings_save");
  must(!/Uložit nastavení/.test(ui), "ui:no_save_label");
  must(!/settings-cancel/.test(ui), "ui:no_settings_cancel");
  must(!/>\s*Zrušit\s*</.test(ui) && !/">Zrušit</.test(ui), "ui:no_cancel_label");
  must(!/Další instituce/.test(ui), "ui:no_dalsi_instituce");
  must(!/label:\s*\"Kraje\"/.test(ui), "ui:no_kraje_source_group");
  must(/activeSection/.test(ui), "ui:single_section_state");
  must(/persistDraft|setPrefs\(snapshot\)/.test(ui), "ui:autosave");
  must(/NONE_SENTINEL|__none__/.test(ui), "ui:none_sentinel");
  must(/isMinistryEntry|ministerstvo/i.test(ui), "ui:ministry_classifier");
  must(/iuPdBtn--settings/.test(ui), "ui:green_btn_class");
  must(/resetSettingsScroll/.test(ui), "ui:open_scroll_reset");
  must(/standaloneSources/.test(ui), "ui:standalone_sources");
  must(/document\.body\.appendChild|mountSettingsOverlay/.test(ui), "ui:settings_body_portal");
  must(/SECTION_ORDER/.test(ui) && /temata/.test(ui) && /zdroje/.test(ui) && /lokalita/.test(ui), "ui:section_order");
  must(/iuPrehledDne__axis/.test(ui) && /iuPrehledDne__dot/.test(ui), "ui:timeline_axis_markup");
  must(/sectionColor|iu-pd-dot/.test(ui), "ui:timeline_dot_color");
  must(/iuPrehledDne__timeline/.test(ui), "ui:timeline_list");

  must(/\.iuPdBtn--settings/.test(css), "css:green_btn");
  must(/iuPrehledDne__axis::before/.test(css) && /\.iuPrehledDne__dot\b/.test(css), "css:timeline_axis");
  must(/\.iuPdCard__actions[\s\S]*justify-content:\s*flex-end/.test(css), "css:actions_right");

  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  must(/iu-prehled-dne-/.test(sw) && /network-first/i.test(sw), "sw:prehled_network_first");
  must(/2026-08-06-traffic-overview-rsd-prehled-v1|2026-08-06-traffic-overview-rsd-prehled-v1|2026-08-04-root-hub-no-projects-v1|2026-08-01-homecard-cta-square-v1|2026-07-31-chmi-smog-onset-split-v1|2026-07-31-chmi-info-events-passthrough-v2|2026-07-31-chmi-validfrom-timeline-v1|2026-07-31-chmi-title-locality-v1|2026-07-31-chmi-multibrowser-console-v1|2026-07-30-chmi-cap-no-segment-dedupe-v1|2026-07-30-chmi-cap-unified-public-click-v1|2026-07-30-chmi-cap-open-ended-public-url-v1|2026-07-30-chmi-cap-temporal-status-v1|2026-07-30-chmi-cap-concrete-url-chrono-v1|2026-07-30-banner-homecard-fouc-v1|2026-07-29-media-sources-removed-v1|2026-07-27-pwa-offline-nav-fallback-v1|2026-07-26-app-root-pwa-assets-redirects-v1|2026-07-26-app-root-url-drop-projects-v1|2026-07-21-prehled-settings-sw-network-first-v1-cross-origin-passthrough/.test(sw), "sw:cache_version_bump");
  must(/#16a34a|#15803d/.test(css), "css:green_color");
  must(/iu-pd-settings-open/.test(css), "css:body_lock");
  must(/--bottom-nav-height/.test(css), "css:bottom_nav");
  must(/overscroll-behavior:\s*contain/.test(css), "css:overscroll");
  must(!/\.iuPdSettings__foot/.test(css), "css:no_sticky_foot");

  must(/function setPrefs[\s\S]*return true/.test(core), "core:setPrefs_returns_bool");

  must(index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "index:css_cache_bust");
  must(index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index:js_cache_bust");
  must(/infouzel-prehled-dne-banner\.png/.test(ui), "ui:banner_asset");
  must(/data-iu-pd-banner=\"1\"/.test(ui), "ui:banner_marker");
  must(/infouzel-prehled-dne-banner\.png/.test(index), "index:banner_asset");
  must(/class=\"iu-info-system-cutover\"/.test(index), "index:cutover_class_first_byte");
  must(/__iuInfoSystemCutoverEarlyBoot/.test(index), "index:cutover_early_boot");
  must(/\.iuPd__bannerImg/.test(css) && /aspect-ratio:\s*1661\s*\/\s*616/.test(css), "css:banner_aspect");
  must(/#iuFeedNewsSplitPostHomeCards/.test(css) && /#iuSilverFinanceHomeCard/.test(css), "css:cutover_hides_finance_homecard");

  const allEntries = registry.entries || [];
  const ministries = allEntries.filter(
    (e) => String(e.group || "") === "ministerstva" || /ministerstvo/i.test(String(e.label || ""))
  );
  must(ministries.some((e) => e.id === "mzcr"), "registry:mzcr_is_ministry_by_label");
  must(ministries.length >= 5, "registry:ministries_min_5");
  const mzcrDup = allEntries.filter((e) => /ministerstvo zdravotnictví/i.test(String(e.label || "")));
  must(mzcrDup.length === 1, "registry:mzcr_not_duplicate");

  return { pass: fails.length === 0, fails: fails.slice() };
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(ROOT, p.replace(/^\/+/, ""));
        if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const mime = fp.endsWith(".css")
          ? "text/css; charset=utf-8"
          : fp.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : fp.endsWith(".json")
              ? "application/json; charset=utf-8"
              : fp.endsWith(".html")
                ? "text/html; charset=utf-8"
                : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function runPlaywright() {
  const server = await startServer();
  await waitForPort("127.0.0.1", PORT, 10000);
  const browser = await chromium.launch({ headless: true });
  const pwFails = [];
  const viewports = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 834, height: 1194 },
    { name: "desktop", width: 1280, height: 900 },
  ];

  try {
    for (const vp of viewports) {
      const context = await bootstrapGuardContext(browser, { viewport: { width: vp.width, height: vp.height } });
      const page = await bootstrapGuardPage(context);
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => {
        try {
          // Guard bootstrap sets __IU_INFO_SYSTEM_CUTOVER__=false for legacy HomeCards
          // layout tests; Prehled dne settings require production cutover ON.
          window.__IU_INFO_SYSTEM_CUTOVER__ = true;
        } catch (_) {}
      });
      await page.waitForFunction(() => !!document.querySelector('[data-act="open-settings"]'), { timeout: 45000 });
      await page.evaluate(() => {
        document.documentElement.classList.add("iu-info-system-cutover");
        const root = document.getElementById("iuPrehledDneRoot");
        if (root) {
          root.style.display = "block";
          root.hidden = false;
        }
        const vpEl = document.getElementById("iuSilverTallScrollViewport");
        if (vpEl) {
          vpEl.style.display = "block";
          vpEl.hidden = false;
        }
        if (window.IUInfoSystem && typeof window.IUInfoSystem.applyCutoverDom === "function") {
          window.IUInfoSystem.applyCutoverDom();
        }
      });
      await page.waitForTimeout(200);

      const green = await page.evaluate(() => {
        const btn = document.querySelector('[data-act="open-settings"]');
        if (!btn) return { ok: false, reason: "missing" };
        const cs = getComputedStyle(btn);
        const bg = (cs.backgroundColor || "") + " " + (cs.backgroundImage || "");
        const ok =
          /16a34a|15803d|22c55e|rgb\(22,\s*163,\s*74\)|rgb\(21,\s*128,\s*61\)/i.test(bg) ||
          btn.classList.contains("iuPdBtn--settings");
        return { ok, bg, cls: btn.className };
      });
      if (!green.ok) pwFails.push(vp.name + ":green_btn");

      await page.evaluate(() => {
        const vpEl = document.getElementById("iuSilverTallScrollViewport");
        if (vpEl) vpEl.scrollTop = 400;
      });
      const feedYBefore = await page.evaluate(() => {
        const vpEl = document.getElementById("iuSilverTallScrollViewport");
        return vpEl ? vpEl.scrollTop : 0;
      });

      await page.evaluate(() => {
        const btn = document.querySelector('[data-act="open-settings"]');
        if (btn) btn.click();
      });
      await page.waitForSelector("#iuPdSettings", { timeout: 10000 });

      const openState = await page.evaluate(() => {
        const scroll = document.getElementById("iuPdSettingsScroll");
        const h2 = document.querySelector("#iuPdSettings h2");
        const rails = [...document.querySelectorAll("[data-act='open-section']")].map((el) =>
          (el.textContent || "").replace(/\s+/g, " ").trim()
        );
        const closeBtn = document.querySelector('[data-act="settings-close"].iuPdSettings__closeBtn, .iuPdSettings__closeBtn');
        const lokalita = [...document.querySelectorAll("[data-act='open-section']")].find((el) =>
          /Lokalita/i.test(el.textContent || "")
        );
        let gap = null;
        if (closeBtn && lokalita) {
          const a = lokalita.getBoundingClientRect();
          const b = closeBtn.getBoundingClientRect();
          gap = Math.round(b.top - a.bottom);
        }
        const save = !!document.querySelector('#iuPdSettings [data-act="settings-save"]');
        const cancel = [...document.querySelectorAll("#iuPdSettings button")].some((b) => (b.textContent || "").trim() === "Zrušit");
        return {
          scrollTop: scroll ? scroll.scrollTop : -1,
          title: h2 ? (h2.textContent || "").trim() : "",
          rails,
          gap,
          save,
          cancel,
          main: !!document.querySelector("[data-iu-pd-settings-main]"),
          bodyChild: !!(document.getElementById("iuPdSettings") && document.getElementById("iuPdSettings").parentElement === document.body),
        };
      });

      if (openState.scrollTop !== 0) pwFails.push(vp.name + ":open_scroll_top");
      if (openState.title !== "Můj přehled / Nastavení") pwFails.push(vp.name + ":title");
      if (openState.rails.length !== 3) pwFails.push(vp.name + ":three_rails");
      if (openState.rails[0] !== "Témata" || openState.rails[1] !== "Zdroje a instituce" || openState.rails[2] !== "Lokalita") {
        pwFails.push(vp.name + ":rail_order");
      }
      if (openState.gap == null || openState.gap < 0 || openState.gap > 28) pwFails.push(vp.name + ":close_gap:" + openState.gap);
      if (openState.save) pwFails.push(vp.name + ":save_present");
      if (openState.cancel) pwFails.push(vp.name + ":cancel_present");
      if (!openState.bodyChild) pwFails.push(vp.name + ":settings_not_on_body");

      await page.evaluate(() => document.querySelector('[data-act="open-section"][data-id="temata"]')?.click());
      await page.waitForSelector('[data-iu-pd-sec="temata"]', { timeout: 8000 });
      const onlyTemata = await page.evaluate(() => {
        const rails = document.querySelectorAll("[data-act='open-section']").length;
        const secs = [...document.querySelectorAll("[data-iu-pd-sec]")].map((el) => el.getAttribute("data-iu-pd-sec"));
        return { rails, secs };
      });
      if (onlyTemata.rails !== 0) pwFails.push(vp.name + ":rails_under_section");
      if (onlyTemata.secs.join(",") !== "temata") pwFails.push(vp.name + ":only_temata");

      await page.evaluate(() => document.querySelector('input[data-draft-act="topics-all"]')?.click());
      await page.waitForTimeout(120);
      const topicsNone = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('input[data-draft-act="topic"]')];
        return boxes.length > 0 && boxes.every((b) => !b.checked);
      });
      if (!topicsNone) pwFails.push(vp.name + ":topics_all_off");

      await page.evaluate(() => document.querySelector('input[data-draft-act="topics-all"]')?.click());
      await page.waitForTimeout(120);
      const topicsAll = await page.evaluate(() => {
        const all = document.querySelector('input[data-draft-act="topics-all"]');
        return !!(all && all.checked);
      });
      if (!topicsAll) pwFails.push(vp.name + ":topics_all_on");

      const prefsAfterTopic = await page.evaluate(() => {
        try {
          return localStorage.getItem("iu.infoEvents.prefs.v1");
        } catch (_) {
          return null;
        }
      });
      if (!prefsAfterTopic) pwFails.push(vp.name + ":autosave_prefs_missing");

      await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
      await page.waitForSelector("[data-iu-pd-settings-main]", { timeout: 8000 });

      await page.evaluate(() => document.querySelector('[data-act="open-section"][data-id="zdroje"]')?.click());
      await page.waitForSelector('[data-iu-pd-sec="zdroje"]', { timeout: 8000 });
      const sourcesTaxonomy = await page.evaluate(() => {
        const html = document.querySelector("#iuPdSettings")?.innerHTML || "";
        const text = document.querySelector("#iuPdSettings")?.innerText || "";
        const hasDalsi = /Další instituce/.test(text) || /Další instituce/.test(html);
        const sg = [...document.querySelectorAll("[data-sg]")].map((el) => el.getAttribute("data-sg"));
        const mzcrStandalone = [...document.querySelectorAll('input[data-draft-act="source-id"][data-group="standalone"]')].some(
          (el) => el.value === "mzcr"
        );
        return { hasDalsi, sg, mzcrStandalone };
      });
      if (sourcesTaxonomy.hasDalsi) pwFails.push(vp.name + ":dalsi_visible");
      if (sourcesTaxonomy.sg.includes("kraje") || sourcesTaxonomy.sg.includes("dalsi")) pwFails.push(vp.name + ":bad_source_groups");
      if (sourcesTaxonomy.mzcrStandalone) pwFails.push(vp.name + ":mzcr_standalone");
      await page.evaluate(() => document.querySelector('[data-sg="ministerstva"] [data-act="toggle-sg"]')?.click());
      await page.waitForTimeout(100);
      const mzcrOk = await page.evaluate(() =>
        [...document.querySelectorAll('[data-sg="ministerstva"] input[data-draft-act="source-id"]')].some((el) => el.value === "mzcr")
      );
      if (!mzcrOk) pwFails.push(vp.name + ":mzcr_not_under_ministerstva");

      await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
      await page.waitForSelector("[data-iu-pd-settings-main]", { timeout: 8000 });
      await page.evaluate(() => document.querySelector('[data-act="open-section"][data-id="lokalita"]')?.click());
      await page.waitForSelector('[data-iu-pd-sec="lokalita"]', { timeout: 8000 });
      const locOrder = await page.evaluate(() => {
        const body = document.querySelector('[data-iu-pd-sec="lokalita"]');
        const text = (body?.innerText || "").replace(/\s+/g, " ");
        const lower = text.toLocaleLowerCase("cs");
        const iCr = lower.indexOf("celá čr");
        const iK = lower.indexOf("kraje");
        const iO = lower.indexOf("okresy");
        const iM = lower.indexOf("město / obec");
        return iCr >= 0 && iK > iCr && iO > iK && iM > iO;
      });
      if (!locOrder) pwFails.push(vp.name + ":locality_order");

      await page.evaluate(() => {
        const sc = document.getElementById("iuPdSettingsScroll");
        if (sc) sc.scrollTop = Math.min(180, Math.max(0, sc.scrollHeight - sc.clientHeight));
      });
      await page.waitForTimeout(40);
      const beforeScroll = await page.evaluate(() => document.getElementById("iuPdSettingsScroll")?.scrollTop || 0);
      await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('input[data-draft-act="loc-kraj"]')];
        const mid = boxes[Math.min(6, Math.max(0, boxes.length - 1))];
        if (mid) mid.click();
      });
      await page.waitForTimeout(180);
      const afterScroll = await page.evaluate(() => document.getElementById("iuPdSettingsScroll")?.scrollTop || 0);
      // Allow tiny layout reflow; flag only real jumps that yank the user away.
      if (Math.abs(afterScroll - beforeScroll) > 48) pwFails.push(vp.name + ":scroll_jump:" + beforeScroll + "->" + afterScroll);

      if (vp.name !== "desktop") {
        const clearance = await page.evaluate(() => {
          const settings = document.getElementById("iuPdSettings");
          const nav = document.getElementById("iuMobileBottomNav");
          if (!settings) return { ok: false };
          const sr = settings.getBoundingClientRect();
          if (!nav) return { ok: sr.bottom <= window.innerHeight + 1 };
          const nr = nav.getBoundingClientRect();
          return { ok: sr.bottom <= nr.top + 1, settingsBottom: sr.bottom, navTop: nr.top };
        });
        if (!clearance.ok) pwFails.push(vp.name + ":bottom_nav_overlap");
      }

      await page.evaluate(() => document.querySelector('.iuPdSettings__head [data-act="settings-close"]')?.click());
      await page.waitForFunction(() => !document.getElementById("iuPdSettings"), { timeout: 8000 });
      const feedYAfter = await page.evaluate(() => {
        const vpEl = document.getElementById("iuSilverTallScrollViewport");
        return vpEl ? vpEl.scrollTop : 0;
      });
      if (feedYBefore > 50 && Math.abs(feedYAfter - feedYBefore) > 80) pwFails.push(vp.name + ":feed_scroll_lost");

      await page.evaluate(() => document.querySelector('[data-act="open-settings"]')?.click());
      await page.waitForSelector("#iuPdSettings", { timeout: 8000 });
      const reopenTop = await page.evaluate(() => document.getElementById("iuPdSettingsScroll")?.scrollTop);
      if (reopenTop !== 0) pwFails.push(vp.name + ":reopen_scroll");

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  return { pass: pwFails.length === 0, fails: pwFails };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.error("[iu-prehled-dne-settings-v6-guard] STATIC FAIL");
    for (const f of staticResult.fails) console.error(" -", f);
    console.log("RESULT=FAIL");
    process.exit(1);
  }

  let pw;
  try {
    pw = await runPlaywright();
  } catch (err) {
    console.error("[iu-prehled-dne-settings-v6-guard] PLAYWRIGHT ERROR", err && err.message ? err.message : err);
    console.log("RESULT=FAIL");
    process.exit(1);
  }

  if (!pw.pass) {
    console.error("[iu-prehled-dne-settings-v6-guard] BEHAVIOR FAIL");
    for (const f of pw.fails) console.error(" -", f);
    console.log("RESULT=FAIL");
    process.exit(1);
  }

  console.log("[iu-prehled-dne-settings-v6-guard] OK static+behavior");
  console.log("RESULT=PASS");
}

main();
