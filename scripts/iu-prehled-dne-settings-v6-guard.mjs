#!/usr/bin/env node
/**
 * Regression guard: Přehled dne settings (autosave, Doprava/ČHMÚ feed-filter structure).
 * Static contract + Playwright behavioral checks (local static server).
 * Updated for feed filter redesign (traffic/CHMU main + detail panels).
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
const FEED_FILTER = path.join(ROOT, "assets", "iu-feed-filter-v1.js");
const FEED_SETTINGS = path.join(ROOT, "assets", "iu-prehled-dne-feed-settings-v1.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8967", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media`;
const CACHE_BUST = "evening-theme-settings-v1-20260818";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const core = fs.readFileSync(CORE, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const feedFilter = fs.readFileSync(FEED_FILTER, "utf8");
  const feedSettings = fs.readFileSync(FEED_SETTINGS, "utf8");

  must(/data-iu-ui=\"v6-clean\"/.test(ui), "ui:v6_marker");
  must(/data-act=\"open-settings\"/.test(ui), "ui:open_settings");
  must(/data-act=\"settings-close\"/.test(ui), "ui:settings_close");
  must(/Zavřít/.test(ui), "ui:close_label");
  must(!/settings-save/.test(ui), "ui:no_settings_save");
  must(!/Uložit nastavení/.test(ui), "ui:no_save_label");
  must(!/settings-cancel/.test(ui), "ui:no_settings_cancel");
  must(!/>\s*Zrušit\s*</.test(ui) && !/">Zrušit</.test(ui), "ui:no_cancel_label");
  must(/activeSection/.test(ui), "ui:single_section_state");
  must(/persistDraft|setPrefs\(snapshot\)/.test(ui), "ui:autosave");
  must(/feedDomDirty/.test(ui), "ui:defer_feed_while_settings");
  must(/keepSettingsDom/.test(ui), "ui:checkbox_keep_dom");
  must(
    /feed-quick-view[\s\S]{0,900}setAttribute\("aria-disabled"/.test(ui),
    "ui:quick_view_disabled_sync"
  );
  must(/function openSettings[\s\S]{0,900}mountSettingsOverlay\(\)/.test(ui), "ui:open_overlay_without_feed_paint");
  must(/let _prefsMem/.test(core), "core:prefs_mem_cache");
  must(/iuPdBtn--settings/.test(ui), "ui:green_btn_class");
  must(/resetSettingsScroll/.test(ui), "ui:open_scroll_reset");
  must(/document\.body\.appendChild|mountSettingsOverlay/.test(ui), "ui:settings_body_portal");
  must(/loadInfoSystemShellData/.test(ui) && /data-iu-pd-shell-ready/.test(ui), "ui:shell_first_boot");
  must(/loadInfoSystemShellData/.test(core) && /loadInfoSystemFeedOnly/.test(core), "core:shell_feed_split");
  must(/iuPrehledDne__axis/.test(ui) && /iuPrehledDne__dot/.test(ui), "ui:timeline_axis_markup");
  must(/sectionColor|iu-pd-dot/.test(ui), "ui:timeline_dot_color");
  must(/iuPrehledDne__timeline/.test(ui), "ui:timeline_list");

  // New feed-filter contract
  must(/iu-feed-filter-v1\.js/.test(ui), "ui:imports_feed_filter");
  must(/iu-prehled-dne-feed-settings-v1\.js/.test(ui), "ui:imports_feed_settings");
  must(/feed-main-toggle/.test(feedSettings) && /feed-open-detail/.test(feedSettings), "settings:main_rows");
  must(/Dopravní informace/.test(feedSettings) && /Výstrahy ČHMÚ/.test(feedSettings), "settings:main_labels");
  must(/trafficEnabled/.test(feedFilter) && /chmuEnabled/.test(feedFilter), "filter:master_toggles");
  must(/matchesTrafficDetailFilter/.test(feedFilter), "filter:detail_matcher");
  must(/quickViewBarHtml|feed-quick-view/.test(feedSettings + ui), "ui:quick_view");
  must(/emptyFeedStateHtml|iu-feed-empty/.test(feedSettings + ui), "ui:empty_state");
  must(/feedMainHtml|data-iu-pd-feed-main/.test(feedSettings + ui), "ui:feed_main_surface");

  must(/\.iuPdBtn--settings/.test(css), "css:green_btn");
  must(/iuPrehledDne__axis::before/.test(css) && /\.iuPrehledDne__dot\b/.test(css), "css:timeline_axis");
  must(/\.iuPdCard__actions[\s\S]*justify-content:\s*flex-end/.test(css), "css:actions_right");
  must(/--iu-pd-traffic/.test(css) && /--iu-pd-chmu/.test(css), "css:feed_filter_tokens");
  must(/iuPdFeedMainRow/.test(css) && /iuPdQuickView/.test(css), "css:feed_filter_classes");

  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  must(/iu-prehled-dne-/.test(sw) && /network-first/i.test(sw), "sw:prehled_network_first");
  must(
    /2026-08-18-perf-stage3-feed-split-v1|2026-08-18-evening-theme-settings-v1|2026-08-17-feed-filter-redesign-v1|2026-08-16-impassable-lane-exit-primary-v1|2026-08-16-closure-accident-diversion-exit-v1|2026-08-15-multi-road-closure-named-event-v1|2026-08-09-heavy-feed-shell-first-v1/.test(
      sw
    ),
    "sw:cache_version_bump"
  );

  // Evening dark main page + light Settings isolation (mobile/tablet paint)
  must(
    /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdQuickView__btn\b/.test(css) &&
      /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdQuickView__btn\.is-on\.iuPdQuickView__btn--traffic/.test(
        css
      ) &&
      /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdQuickView__btn\.is-on\.iuPdQuickView__btn--chmu/.test(
        css
      ),
    "css:evening_quick_view_pills"
  );
  must(
    /html\.iu-time-evening\s+\.iuPdSettings\s*\{[\s\S]*?--iu-pd-text:\s*rgba\(15,\s*30,\s*45/.test(css) &&
      /color-scheme:\s*light/.test(css),
    "css:evening_settings_light_tokens"
  );
  must(
    /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdToggle/.test(css) &&
      !/html\.iu-time-evening\s+\.iuPdToggle\s*,/.test(css.replace(/\s+/g, " ")),
    "css:evening_controls_scoped_to_main"
  );
  must(!/html\.iu-time-evening\s+\.iuPdSettings__panel\s*\{[^}]*#111827/.test(css), "css:no_dark_settings_panel");
  must(/#16a34a|#15803d/.test(css), "css:green_color");
  must(/iu-pd-settings-open/.test(css), "css:body_lock");
  must(/--bottom-nav-height/.test(css), "css:bottom_nav");
  must(/overscroll-behavior:\s*contain/.test(css), "css:overscroll");
  must(!/\.iuPdSettings__foot/.test(css), "css:no_sticky_foot");

  must(/function setPrefs[\s\S]*return true/.test(core), "core:setPrefs_returns_bool");
  must(/feedFilter/.test(core), "core:preserves_feedFilter");

  must(index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "index:css_cache_bust");
  must(index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "index:js_cache_bust");
  must(/infouzel-prehled-dne-banner\.png/.test(ui), "ui:banner_asset");
  must(/data-iu-pd-banner=\"1\"/.test(ui), "ui:banner_marker");
  must(/infouzel-prehled-dne-banner\.png/.test(index), "index:banner_asset");
  must(/class=\"iu-info-system-cutover\"/.test(index), "index:cutover_class_first_byte");
  must(/__iuInfoSystemCutoverEarlyBoot/.test(index), "index:cutover_early_boot");
  must(/\.iuPd__bannerImg/.test(css) && /aspect-ratio:\s*1661\s*\/\s*616/.test(css), "css:banner_aspect");
  must(/#iuFeedNewsSplitPostHomeCards/.test(css) && /#iuSilverFinanceHomeCard/.test(css), "css:cutover_hides_finance_homecard");

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
      await page.waitForFunction(
        () => {
          const root = document.getElementById("iuPrehledDneRoot");
          return !!(root && root.getAttribute("data-iu-pd-shell-ready") === "1");
        },
        { timeout: 45000 }
      );

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

      if (vp.name === "mobile" || vp.name === "tablet") {
        const eveningPills = await page.evaluate(() => {
          const html = document.documentElement;
          ["iu-time-morning", "iu-time-late-morning", "iu-time-afternoon", "iu-time-evening"].forEach((c) =>
            html.classList.remove(c)
          );
          html.classList.add("iu-time-evening");

          const nearWhite = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return false;
            return Number(m[1]) > 235 && Number(m[2]) > 235 && Number(m[3]) > 235;
          };
          const luminance = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return -1;
            return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
          };

          const inactive = [...document.querySelectorAll(".iuPdQuickView__btn")].filter(
            (b) => !b.classList.contains("is-on")
          );
          const inactiveBgs = inactive.map((b) => getComputedStyle(b).backgroundColor);
          const inactiveOk = inactive.length > 0 && inactiveBgs.every((bg) => !nearWhite(bg));

          const traffic = document.querySelector(".iuPdQuickView__btn--traffic");
          if (traffic) traffic.click();
          const trafficLive = document.querySelector(".iuPdQuickView__btn--traffic");
          const trafficBg = trafficLive ? getComputedStyle(trafficLive).backgroundColor : "";
          const trafficOn = trafficLive && trafficLive.classList.contains("is-on");
          const trafficOrange =
            trafficOn &&
            (() => {
              const m = String(trafficBg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
              if (!m) return false;
              return Number(m[1]) > 180 && Number(m[2]) < 140 && Number(m[3]) < 80;
            })();

          const chmu = document.querySelector(".iuPdQuickView__btn--chmu");
          if (chmu) chmu.click();
          const chmuLive = document.querySelector(".iuPdQuickView__btn--chmu");
          const chmuBg = chmuLive ? getComputedStyle(chmuLive).backgroundColor : "";
          const chmuOn = chmuLive && chmuLive.classList.contains("is-on");
          const chmuBlue =
            chmuOn &&
            (() => {
              const m = String(chmuBg).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
              if (!m) return false;
              return Number(m[3]) > Number(m[1]) && Number(m[3]) > 140;
            })();

          const allBtn = document.querySelector(".iuPdQuickView__btn--all");
          if (allBtn) allBtn.click();

          return {
            inactiveOk,
            inactiveBgs,
            trafficOrange,
            trafficBg,
            chmuBlue,
            chmuBg,
            inactiveLumOk: inactiveBgs.every((bg) => {
              const L = luminance(bg);
              return L >= 0 && L < 0.85;
            }),
          };
        });
        if (!eveningPills.inactiveOk || !eveningPills.inactiveLumOk) {
          pwFails.push(vp.name + ":evening_inactive_quick_view_not_white");
        }
        if (!eveningPills.trafficOrange) pwFails.push(vp.name + ":evening_traffic_active_orange");
        if (!eveningPills.chmuBlue) pwFails.push(vp.name + ":evening_chmu_active_blue");
      }

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
        const main = document.querySelector("[data-iu-pd-feed-main]");
        const text = (main && main.innerText) || "";
        const gears = document.querySelectorAll('[data-act="feed-open-detail"]').length;
        const toggles = document.querySelectorAll('[data-act="feed-main-toggle"]').length;
        const hasTemata = /Témata/.test(text);
        const hasZdroje = /Zdroje a instituce/.test(text);
        const hasTraffic = /Dopravní informace/.test(text);
        const hasChmu = /Výstrahy ČHMÚ/.test(text);
        const save = !!document.querySelector('#iuPdSettings [data-act="settings-save"]');
        const cancel = [...document.querySelectorAll("#iuPdSettings button")].some(
          (b) => (b.textContent || "").trim() === "Zrušit"
        );
        return {
          scrollTop: scroll ? scroll.scrollTop : -1,
          title: h2 ? (h2.textContent || "").trim() : "",
          gears,
          toggles,
          hasTemata,
          hasZdroje,
          hasTraffic,
          hasChmu,
          save,
          cancel,
          main: !!main,
          bodyChild: !!(
            document.getElementById("iuPdSettings") &&
            document.getElementById("iuPdSettings").parentElement === document.body
          ),
        };
      });

      if (openState.scrollTop !== 0) pwFails.push(vp.name + ":open_scroll_top");
      if (openState.title !== "Můj přehled / Nastavení") pwFails.push(vp.name + ":title");
      if (!openState.main) pwFails.push(vp.name + ":feed_main_missing");
      if (!openState.hasTraffic || !openState.hasChmu) pwFails.push(vp.name + ":main_labels");
      if (openState.hasTemata || openState.hasZdroje) pwFails.push(vp.name + ":legacy_rails_visible");
      if (openState.gears < 2 || openState.toggles < 2) pwFails.push(vp.name + ":gear_toggle_count");
      if (openState.save) pwFails.push(vp.name + ":save_present");
      if (openState.cancel) pwFails.push(vp.name + ":cancel_present");
      if (!openState.bodyChild) pwFails.push(vp.name + ":settings_not_on_body");

      if (vp.name === "mobile" || vp.name === "tablet") {
        const settingsLight = await page.evaluate(() => {
          const html = document.documentElement;
          html.classList.add("iu-time-evening");
          const root = document.getElementById("iuPdSettings");
          const panel = document.querySelector(".iuPdSettings__panel");
          const label = document.querySelector(".iuPdFeedMainRow__label");
          const nearWhite = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return false;
            return Number(m[1]) > 235 && Number(m[2]) > 235 && Number(m[3]) > 235;
          };
          const luminance = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return -1;
            return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
          };
          const textColor = label ? getComputedStyle(label).color : "";
          const panelBg = panel ? getComputedStyle(panel).backgroundColor : "";
          const token = root ? getComputedStyle(root).getPropertyValue("--iu-pd-text").trim() : "";
          return {
            textColor,
            panelBg,
            token,
            panelLight: nearWhite(panelBg) || luminance(panelBg) > 0.9,
            textDark: !nearWhite(textColor) && luminance(textColor) < 0.45,
            tokenLight: /15,\s*30,\s*45|rgba\(15/.test(token),
          };
        });
        if (!settingsLight.panelLight) pwFails.push(vp.name + ":settings_panel_not_light");
        if (!settingsLight.textDark) pwFails.push(vp.name + ":settings_label_not_dark");
        if (!settingsLight.tokenLight) pwFails.push(vp.name + ":settings_token_not_light");

        await page.evaluate(() =>
          document.querySelector('[data-act="feed-open-detail"][data-kind="traffic"]')?.click()
        );
        await page.waitForSelector('[data-iu-feed-detail="traffic"]', { timeout: 8000 });
        const trafficReadable = await page.evaluate(() => {
          const head = [...document.querySelectorAll(".iuPdFeedSub__head")].find((el) =>
            /Kraje/i.test(el.textContent || "")
          );
          const check = document.querySelector(".iuPdFeedCheck");
          const nearWhite = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return false;
            return Number(m[1]) > 235 && Number(m[2]) > 235 && Number(m[3]) > 235;
          };
          const luminance = (cssColor) => {
            const m = String(cssColor || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
            if (!m) return -1;
            return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
          };
          const headColor = head ? getComputedStyle(head).color : "";
          const checkColor = check ? getComputedStyle(check).color : "";
          return {
            headOk: !!head && !nearWhite(headColor) && luminance(headColor) < 0.55,
            checkOk: !!check && !nearWhite(checkColor) && luminance(checkColor) < 0.45,
            headColor,
            checkColor,
          };
        });
        if (!trafficReadable.headOk) pwFails.push(vp.name + ":traffic_kraje_unreadable");
        if (!trafficReadable.checkOk) pwFails.push(vp.name + ":traffic_check_unreadable");
        await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
        await page.waitForSelector("[data-iu-pd-feed-main]", { timeout: 8000 });
      }

      await page.evaluate(() =>
        document.querySelector('[data-act="feed-open-detail"][data-kind="traffic"]')?.click()
      );
      await page.waitForSelector('[data-iu-feed-detail="traffic"]', { timeout: 8000 });
      const trafficDetail = await page.evaluate(() => {
        const text = document.querySelector('[data-iu-feed-detail="traffic"]')?.innerText || "";
        return {
          area: /Oblast/.test(text),
          roads: /Silnice/.test(text),
          events: /Události/.test(text),
          parking: /Parkovišt/.test(text),
        };
      });
      if (!trafficDetail.area || !trafficDetail.roads || !trafficDetail.events || !trafficDetail.parking) {
        pwFails.push(vp.name + ":traffic_four_sections");
      }

      await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
      await page.waitForSelector("[data-iu-pd-feed-main]", { timeout: 8000 });

      await page.evaluate(() => document.querySelector('[data-act="feed-open-detail"][data-kind="chmu"]')?.click());
      await page.waitForSelector('[data-iu-feed-detail="chmu"]', { timeout: 8000 });
      const chmuDetail = await page.evaluate(() => {
        const text = document.querySelector('[data-iu-feed-detail="chmu"]')?.innerText || "";
        return {
          area: /Oblast/.test(text),
          noRoads: !/Silnice/.test(text),
          hasCr: /Celá ČR/.test(text),
        };
      });
      if (!chmuDetail.area || !chmuDetail.noRoads || !chmuDetail.hasCr) pwFails.push(vp.name + ":chmu_area_only");

      // Autosave: toggle CHMU off
      await page.evaluate(() => document.querySelector('[data-act="back-section"]')?.click());
      await page.waitForSelector("[data-iu-pd-feed-main]", { timeout: 8000 });
      await page.evaluate(() => {
        const el = document.querySelector('[data-act="feed-main-toggle"][data-kind="chmu"]');
        if (el && el.checked) el.click();
      });
      await page.waitForTimeout(200);
      const prefsAfter = await page.evaluate(() => {
        try {
          const raw = localStorage.getItem("iu.infoEvents.prefs.v1");
          const p = raw ? JSON.parse(raw) : null;
          return !!(p && p.feedFilter && p.feedFilter.chmuEnabled === false);
        } catch (_) {
          return false;
        }
      });
      if (!prefsAfter) pwFails.push(vp.name + ":autosave_feedFilter");

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
      await page.waitForFunction(() => {
        const chmuBtn = document.querySelector('[data-act="feed-quick-view"][data-view="chmu"]');
        return !!(chmuBtn && (chmuBtn.disabled || chmuBtn.getAttribute("aria-disabled") === "true"));
      }, { timeout: 5000 });

      const quick = await page.evaluate(() => {
        const bar = document.querySelector("[data-iu-feed-quick]");
        const chmuBtn = document.querySelector('[data-act="feed-quick-view"][data-view="chmu"]');
        return {
          bar: !!bar,
          chmuDisabled: !!(chmuBtn && (chmuBtn.disabled || chmuBtn.getAttribute("aria-disabled") === "true")),
        };
      });
      if (!quick.bar) pwFails.push(vp.name + ":quick_bar");
      if (!quick.chmuDisabled) pwFails.push(vp.name + ":quick_chmu_disabled_after_off");

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

  console.log("[iu-prehled-dne-settings-v6-guard] PASS");
  console.log("RESULT=PASS");
}

main().catch((err) => {
  console.error(err);
  console.log("RESULT=FAIL");
  process.exit(1);
});
