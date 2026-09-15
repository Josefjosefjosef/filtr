#!/usr/bin/env node
/**
 * Regression: unified top home section bars (mobile/tablet ≤1024).
 * - Quick⇄parcel switcher bar ~40px
 * - PD Dopravní⇄ČHMÚ switcher bar ~40px (+8 vs compact 32)
 * - Info (quick) stays brand blue; PD bar follows active quick-view color
 * - Flush join to attached card; PC (≥1025) bars hidden
 * Run: npm run iu-home-section-bar-guard
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8984", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function staticGate() {
  const index = read("projects/index.html");
  const ui = read("assets/iu-prehled-dne-ui-v1.js");
  const pdCss = read("assets/iu-prehled-dne-v1.css");
  const mobileCss = read("assets/iu-mobile-info-panel.css");

  must(/id="iuHomeSectionBarCss"/.test(index), "static:css_block");
  must(/\.iuHomeSectionBar\s*\{/.test(index), "static:shared_class");
  must(/--iu-home-section-bar-h:\s*32px/.test(index), "static:height_token_compact");
  must(!/--iu-home-section-bar-h:\s*42px/.test(index), "static:no_old_height_42");
  must(/--iu-home-section-bar-bg:\s*var\(--iu-brand-blue/.test(index), "static:blue_token");
  must(/--iu-home-section-bar-radius:\s*14px/.test(index), "static:radius_token");
  must(/data-iu-home-section-bar="quick-parcel-switcher"/.test(index), "static:bar_switcher");
  must(/data-iu-home-section-bar="muj-prehled-dne"/.test(index), "static:bar_pd");
  must(/data-iu-pd-quick-switcher="1"/.test(index), "static:pd_switcher_attr");
  must(/data-iu-pd-quick-active="chmu"/.test(index), "static:pd_default_chmu");
  must(/VÝSTRAHY ČHMÚ/.test(index), "static:label_pd_chmu");
  must(!/>MŮJ PŘEHLED DNE</.test(index), "static:no_muj_prehled_label");
  must(!/data-iu-home-section-bar="rychly-prehled"/.test(index), "static:no_standalone_quick_bar");
  must(!/data-iu-home-section-bar="sledovani-zasilek"/.test(index), "static:no_standalone_parcel_bar");
  must(/RYCHLÝ PŘEHLED/.test(index), "static:label_info");
  must(/SLEDOVÁNÍ ZÁSILEK/.test(index), "static:label_parcel_text");
  must(/iuHomeSectionBar--switcher/.test(index), "static:switcher_class");
  must(/iuHomeSectionBar--pdQuick/.test(index), "static:pd_switcher_class");
  must(/--iu-home-section-bar-h:\s*40px/.test(read("assets/iu-home-quick-parcel-switcher-v1.css")), "static:switcher_40");
  must(/iuHomeSectionBar--pdQuick[\s\S]{0,200}--iu-home-section-bar-h:\s*40px/.test(index), "static:pd_switcher_40");
  must(!/id="iuFeedNewsSplitParcel"/.test(index), "static:no_parcel_split");
  must(!/iuFeedNewsSplit--parcel/.test(index), "static:no_parcel_split_class");
  must(
    !/<span class="iuFeedNewsSplit__capsule">SLEDOVÁNÍ ZÁSILEK<\/span>/.test(index),
    "static:no_legacy_parcel_capsule"
  );
  must(!/body:not\(\.iu-home\)\s+\.iuHomeSectionBar/.test(index), "static:no_iu_home_gate");
  must(/function homeSectionBarHtml\(/.test(ui), "static:ui_helper");
  must(/function pdQuickSwitcherHtml\(/.test(ui), "static:ui_pd_switcher_helper");
  must(/pdQuickSwitcherHtml\(state\.feedQuickView\)/.test(ui), "static:ui_shell_pd_switcher");
  must(!/homeSectionBarHtml\("MŮJ PŘEHLED DNE",\s*"muj-prehled-dne"\)/.test(ui), "static:ui_no_legacy_pd_bar");
  must(/function settingsCtaInnerHtml\(/.test(ui), "static:cta_helper");
  must(/iuPdBtn__label">Nastavení<\/span>/.test(ui), "static:cta_label_nastaveni");
  must(/iuPdBtn__chevron"[^>]*>›<\/span>/.test(ui), "static:cta_chevron");
  must(!/prehled-dne-settings-cta"[^>]*>Můj přehled \/ Nastavení/.test(ui), "static:cta_no_legacy_label");
  must(!/prehled-dne-settings-cta"[^>]*>Můj přehled \/ Nastavení/.test(index), "static:index_cta_no_legacy");
  must(/data-act="open-settings"/.test(ui), "static:cta_open_settings");
  must(/\.iuPdBtn--settings\s+\.iuPdBtn__chevron\s*\{/.test(pdCss), "static:css_chevron");
  must(/min-height:\s*42px/.test(pdCss), "static:green_cta_height_unchanged");
  must(/iuHomeSectionUnit--info/.test(mobileCss), "static:mobile_unit_css");
  must(/@media \(min-width:\s*1025px\)[\s\S]*\.iuHomeSectionBar/.test(index), "static:pc_hide");
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

function parseRgb(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function nearBlue(rgb, tol = 28) {
  if (!rgb) return false;
  return Math.abs(rgb.r - 0) <= tol && Math.abs(rgb.g - 60) <= tol + 10 && rgb.b >= 200;
}

/** ČHMÚ sky #38bdf8 ≈ rgb(56,189,248) */
function nearChmuSky(rgb) {
  if (!rgb) return false;
  return rgb.r >= 30 && rgb.r <= 90 && rgb.g >= 160 && rgb.b >= 200;
}

/** Doprava orange #ea580c ≈ rgb(234,88,12) */
function nearTrafficOrange(rgb) {
  if (!rgb) return false;
  return rgb.r > 180 && rgb.g < 140 && rgb.b < 80;
}

async function measureBars(page) {
  return page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll(".iuHomeSectionBar"));
    const visible = bars.filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0 && r.width > 0;
    });
    const pick = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: String(el.textContent || "").replace(/\s+/g, " ").trim(),
        height: Math.round(r.height * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        bg: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        radiusTL: cs.borderTopLeftRadius,
        radiusTR: cs.borderTopRightRadius,
        radiusBL: cs.borderBottomLeftRadius,
        radiusBR: cs.borderBottomRightRadius,
        inScroll: !!(el.closest(".iuDesktopInfoPanel__scroll") || el.closest(".iuDesktopInfoPanel__track")),
        touchAction: cs.touchAction,
        pointerEvents: cs.pointerEvents,
        active: el.getAttribute("data-iu-pd-quick-active") || "",
      };
    };
    const infoBar = visible.find((el) => /RYCHLÝ PŘEHLED|SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || ""));
    const parcelBar = null;
    const pdBar =
      visible.find((el) => el.getAttribute("data-iu-pd-quick-switcher") === "1") ||
      visible.find((el) => /VÝSTRAHY ČHMÚ|DOPRAVNÍ INFORMACE/i.test(el.textContent || ""));
    const switcher = document.getElementById("iuHomeQuickParcelSwitcher");
    const panel =
      document.querySelector("#iuMobileInfoPanelMount .iuMobileInfoPanel") ||
      document.querySelector("#iuMobileInfoPanelMount .iuMobileInfoPanelReserve");
    const module = document.getElementById("iuHomeQuickParcelModule");
    const banner = document.querySelector('[data-testid="prehled-dne-homecard"]');
    const green =
      document.querySelector('[data-testid="prehled-dne-settings-cta"]') ||
      document.querySelector(".iuPd__hero .iuPdBtn--settings");
    const greenLabel = green ? green.querySelector(".iuPdBtn__label") : null;
    const greenChevron = green ? green.querySelector(".iuPdBtn__chevron") : null;
    const legacySplit = document.getElementById("iuFeedNewsSplitParcel");
    const legacyCapsule = Array.from(document.querySelectorAll(".iuFeedNewsSplit__capsule")).some((el) =>
      /SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || "")
    );
    const duplicateQuick = !!document.querySelector(".iuPrehledDne .iuPdQuickView--primary");
    const gap = (a, b) => {
      if (!a || !b) return null;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return Math.round((br.top - ar.bottom) * 1000) / 1000;
    };
    const widthDelta = (a, b) => {
      if (!a || !b) return null;
      return Math.round(Math.abs(a.getBoundingClientRect().width - b.getBoundingClientRect().width) * 100) / 100;
    };
    const greenCs = green ? getComputedStyle(green) : null;
    const chevronCs = greenChevron ? getComputedStyle(greenChevron) : null;
    const greenRect = green ? green.getBoundingClientRect() : null;
    const labelRect = greenLabel ? greenLabel.getBoundingClientRect() : null;
    const chevronRect = greenChevron ? greenChevron.getBoundingClientRect() : null;
    return {
      visibleCount: visible.length,
      info: infoBar ? pick(infoBar) : null,
      parcel: parcelBar ? pick(parcelBar) : null,
      pd: pdBar ? pick(pdBar) : null,
      switcher: switcher && visible.includes(switcher) ? pick(switcher) : switcher ? pick(switcher) : null,
      gapInfo: infoBar && panel ? gap(infoBar, panel) : null,
      gapPd: pdBar && banner ? gap(pdBar, banner) : null,
      modulePresent: !!module,
      widthInfo: infoBar && panel ? widthDelta(infoBar, panel) : null,
      widthPd: pdBar && banner ? widthDelta(pdBar, banner) : null,
      greenHeight: greenRect ? Math.round(greenRect.height * 100) / 100 : null,
      greenLabel: greenLabel ? String(greenLabel.textContent || "").trim() : null,
      greenChevron: greenChevron ? String(greenChevron.textContent || "").trim() : null,
      greenOpenSettings: !!(green && green.getAttribute("data-act") === "open-settings"),
      greenLegacyPhrase: !!(green && /Můj přehled\s*\/\s*Nastavení/i.test(green.textContent || "")),
      greenTextCentered:
        greenRect && labelRect
          ? Math.abs((labelRect.left + labelRect.right) / 2 - (greenRect.left + greenRect.right) / 2) <= 8
          : false,
      greenChevronRight:
        greenRect && chevronRect ? chevronRect.left > (greenRect.left + greenRect.right) / 2 : false,
      greenChevronWhite: !!(
        chevronCs &&
        (() => {
          const m = String(chevronCs.color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
          if (!m) return false;
          return Number(m[1]) >= 240 && Number(m[2]) >= 240 && Number(m[3]) >= 240;
        })()
      ),
      greenMinHeight: greenCs ? greenCs.minHeight : null,
      legacySplit: !!legacySplit,
      legacyCapsule,
      duplicateQuick,
    };
  });
}

async function runPlaywright() {
  const server = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: "mobile", width: 390, height: 844, expectParcel: true },
      { name: "tablet", width: 768, height: 1024, expectParcel: true },
      { name: "tablet-wide", width: 900, height: 1200, expectParcel: true },
      { name: "bp-1024", width: 1024, height: 900, expectParcel: false },
      { name: "pc", width: 1280, height: 900, expectParcel: false },
    ];
    try {
      for (const vp of viewports) {
        const context = await bootstrapGuardContext(browser, {
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.width <= 1024,
          hasTouch: vp.width <= 1024,
        });
        const page = await bootstrapGuardPage(context);
        await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 45000 });
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".iuHomeSectionBar").length >= 2 &&
            !!document.getElementById("iuHomeQuickParcelSwitcher") &&
            !!document.getElementById("iuSilverParcelWatch") &&
            !!document.querySelector('[data-testid="prehled-dne-homecard"]') &&
            !!document.querySelector('[data-testid="prehled-dne-settings-cta"][data-act="open-settings"]'),
          { timeout: 45000 }
        );
        await page.evaluate(() => {
          const mod = document.getElementById("iuHomeQuickParcelModule");
          if (mod && typeof mod.scrollIntoView === "function") {
            mod.scrollIntoView({ block: "center", inline: "nearest" });
          }
        });
        await page.waitForTimeout(700);

        const m = await measureBars(page);
        const prefix = vp.name;

        if (vp.width >= 1025) {
          must(m.visibleCount === 0, prefix + ":pc_bars_hidden:" + m.visibleCount);
          must(!m.legacySplit, prefix + ":pc_no_legacy_split");
          must(!m.legacyCapsule, prefix + ":pc_no_legacy_capsule");
          await context.close();
          continue;
        }

        must(!m.legacySplit, prefix + ":no_legacy_split");
        must(!m.legacyCapsule, prefix + ":no_legacy_capsule");
        must(m.modulePresent, prefix + ":module_present");
        must(!m.duplicateQuick, prefix + ":no_duplicate_quick_btns");

        must(!!m.info && !!m.pd, prefix + ":bars_info_pd");
        must(!m.parcel, prefix + ":no_standalone_parcel_bar");
        must(m.visibleCount === 2, prefix + ":bars_count:" + m.visibleCount);

        if (m.info && m.pd) {
          must(m.info.height >= 38 && m.info.height <= 48, prefix + ":switcher_h_40:" + m.info.height);
          must(m.pd.height >= 38 && m.pd.height <= 48, prefix + ":pd_h_40:" + m.pd.height);
          must(
            m.greenHeight != null && m.greenHeight >= 40 && m.greenHeight <= 46,
            prefix + ":green_h_unchanged:" + m.greenHeight
          );
          must(/VÝSTRAHY ČHMÚ/i.test(m.pd.text), prefix + ":pd_default_label:" + m.pd.text);
          must(m.pd.active === "chmu", prefix + ":pd_default_active:" + m.pd.active);
          must(/pan-y/i.test(m.pd.touchAction || ""), prefix + ":pd_touch_pan_y:" + m.pd.touchAction);
          must(m.pd.pointerEvents === "auto", prefix + ":pd_pointer_auto:" + m.pd.pointerEvents);

          must(nearBlue(parseRgb(m.info.bg)), prefix + ":bg_blue_info:" + m.info.bg);
          must(nearChmuSky(parseRgb(m.pd.bg)), prefix + ":bg_chmu_pd:" + m.pd.bg);
          must(m.info.fontSize === m.pd.fontSize, prefix + ":font_size");
          must(m.info.fontWeight === m.pd.fontWeight, prefix + ":font_weight");
          must(m.info.radiusTL === m.pd.radiusTL, prefix + ":radius_tl");
          must(m.info.radiusTR === m.pd.radiusTR, prefix + ":radius_tr");
          must(m.info.radiusBL === "0px" && m.pd.radiusBL === "0px", prefix + ":radius_bl_flat");
          must(m.info.radiusBR === "0px" && m.pd.radiusBR === "0px", prefix + ":radius_br_flat");
          must(parseFloat(m.info.radiusTL) > 0, prefix + ":radius_tl_round");

          must(m.gapInfo != null && Math.abs(m.gapInfo) <= 0.5, prefix + ":gap_info:" + m.gapInfo);
          must(m.gapPd != null && Math.abs(m.gapPd) <= 0.5, prefix + ":gap_pd:" + m.gapPd);
          must(m.widthInfo != null && m.widthInfo <= 2, prefix + ":width_info:" + m.widthInfo);
          must(m.widthPd != null && m.widthPd <= 2, prefix + ":width_pd:" + m.widthPd);
          must(!m.info.inScroll, prefix + ":info_bar_not_in_scroll");

          must(m.greenLabel === "Nastavení", prefix + ":cta_label:" + m.greenLabel);
          must(m.greenChevron === "›", prefix + ":cta_chevron:" + m.greenChevron);
          must(!m.greenLegacyPhrase, prefix + ":cta_no_legacy_phrase");
          must(m.greenTextCentered, prefix + ":cta_label_centered");
          must(m.greenChevronRight, prefix + ":cta_chevron_right");
          must(m.greenChevronWhite, prefix + ":cta_chevron_white");
          must(m.greenOpenSettings, prefix + ":cta_open_settings");
        }

        // Evening: info bar stays brand blue + white; PD keeps mode colors (ČHMÚ sky / traffic orange).
        if (vp.name === "mobile" || vp.name === "tablet") {
          await page.evaluate(() => {
            const root = document.documentElement;
            root.setAttribute("data-iu-daypart", "evening");
            root.setAttribute("data-iu-silver-welcome-paint", "evening");
            ["iu-time-morning", "iu-time-late-morning", "iu-time-afternoon", "iu-time-evening"].forEach((c) =>
              root.classList.remove(c)
            );
            root.classList.add("iu-time-evening");
          });
          await page.waitForTimeout(200);
          const night = await measureBars(page);
          if (night.info && night.pd) {
            must(nearBlue(parseRgb(night.info.bg)), prefix + ":evening_bg_blue:" + night.info.bg);
            must(nearChmuSky(parseRgb(night.pd.bg)), prefix + ":evening_pd_chmu:" + night.pd.bg);
            const infoRgb = parseRgb(night.info.color);
            must(
              infoRgb && infoRgb.r >= 240 && infoRgb.g >= 240 && infoRgb.b >= 240,
              prefix + ":evening_info_text_white"
            );
            must(night.gapInfo != null && Math.abs(night.gapInfo) <= 0.5, prefix + ":evening_gap_info:" + night.gapInfo);
            must(night.gapPd != null && Math.abs(night.gapPd) <= 0.5, prefix + ":evening_gap_pd:" + night.gapPd);

            await page.click('[data-iu-pd-quick-switcher="1"]');
            await page.waitForTimeout(250);
            const after = await measureBars(page);
            must(/DOPRAVNÍ INFORMACE/i.test(after.pd && after.pd.text), prefix + ":evening_tap_traffic_label");
            must(nearTrafficOrange(parseRgb(after.pd && after.pd.bg)), prefix + ":evening_tap_traffic_bg:" + (after.pd && after.pd.bg));
          } else {
            fails.push(prefix + ":evening_bars_missing");
          }
        }

        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  await runPlaywright();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  console.log("PASS iu-home-section-bar-guard");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
