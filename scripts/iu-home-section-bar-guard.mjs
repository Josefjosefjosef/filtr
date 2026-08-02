#!/usr/bin/env node
/**
 * Regression: unified top blue home section bars (mobile/tablet ≤1024).
 * - Three sections share .iuHomeSectionBar
 * - Equal height / blue / radii / typography
 * - Flush join (no gap) to attached card
 * - Info bar outside horizontal scroll
 * - Legacy SLEDOVÁNÍ ZÁSILEK capsule-between-lines removed
 * - PC (≥1025) bars hidden
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
  const mobileCss = read("assets/iu-mobile-info-panel.css");

  must(/id="iuHomeSectionBarCss"/.test(index), "static:css_block");
  must(/\.iuHomeSectionBar\s*\{/.test(index), "static:shared_class");
  must(/--iu-home-section-bar-h:\s*42px/.test(index), "static:height_token");
  must(/--iu-home-section-bar-bg:\s*var\(--iu-brand-blue/.test(index), "static:blue_token");
  must(/--iu-home-section-bar-radius:\s*14px/.test(index), "static:radius_token");
  must(/data-iu-home-section-bar="rychly-prehled"/.test(index), "static:bar_info");
  must(/data-iu-home-section-bar="sledovani-zasilek"/.test(index), "static:bar_parcel");
  must(/data-iu-home-section-bar="muj-prehled-dne"/.test(index), "static:bar_pd");
  must(/RYCHLÝ PŘEHLED/.test(index), "static:label_info");
  must(/SLEDOVÁNÍ ZÁSILEK/.test(index) && /iuHomeSectionBar/.test(index), "static:label_parcel_bar");
  must(/MŮJ PŘEHLED DNE/.test(index), "static:label_pd");
  must(!/id="iuFeedNewsSplitParcel"/.test(index), "static:no_parcel_split");
  must(!/iuFeedNewsSplit--parcel/.test(index), "static:no_parcel_split_class");
  must(
    !/<span class="iuFeedNewsSplit__capsule">SLEDOVÁNÍ ZÁSILEK<\/span>/.test(index),
    "static:no_legacy_parcel_capsule"
  );
  must(!/body:not\(\.iu-home\)\s+\.iuHomeSectionBar/.test(index), "static:no_iu_home_gate");
  must(/function homeSectionBarHtml\(/.test(ui), "static:ui_helper");
  must(/homeSectionBarHtml\("MŮJ PŘEHLED DNE"\)/.test(ui), "static:ui_shell_bar");
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
      };
    };
    const infoBar = visible.find((el) => /RYCHLÝ PŘEHLED/i.test(el.textContent || ""));
    const parcelBar = visible.find((el) => /SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || ""));
    const pdBar = visible.find((el) => /MŮJ PŘEHLED DNE/i.test(el.textContent || ""));
    const panel =
      document.querySelector("#iuMobileInfoPanelMount .iuMobileInfoPanel") ||
      document.querySelector("#iuMobileInfoPanelMount .iuMobileInfoPanelReserve");
    const parcel = document.getElementById("iuSilverParcelWatch");
    const banner = document.querySelector('[data-testid="prehled-dne-homecard"]');
    const green =
      document.querySelector('[data-testid="prehled-dne-settings-cta"]') ||
      document.querySelector(".iuPd__hero .iuPdBtn--settings");
    const legacySplit = document.getElementById("iuFeedNewsSplitParcel");
    const legacyCapsule = Array.from(document.querySelectorAll(".iuFeedNewsSplit__capsule")).some((el) =>
      /SLEDOVÁNÍ ZÁSILEK/i.test(el.textContent || "")
    );
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
    const parcelRect = parcel ? parcel.getBoundingClientRect() : null;
    const parcelBarRect = parcelBar ? parcelBar.getBoundingClientRect() : null;
    return {
      visibleCount: visible.length,
      info: infoBar ? pick(infoBar) : null,
      parcel: parcelBar ? pick(parcelBar) : null,
      pd: pdBar ? pick(pdBar) : null,
      gapInfo: infoBar && panel ? gap(infoBar, panel) : null,
      gapPd: pdBar && banner ? gap(pdBar, banner) : null,
      parcelContainsBar: !!(parcel && parcelBar && parcel.contains(parcelBar)),
      parcelBarTopFlush:
        parcelRect && parcelBarRect
          ? Math.round(Math.abs(parcelBarRect.top - parcelRect.top) * 1000) / 1000
          : null,
      widthInfo: infoBar && panel ? widthDelta(infoBar, panel) : null,
      widthParcel: parcelBar && parcel ? widthDelta(parcelBar, parcel) : null,
      widthPd: pdBar && banner ? widthDelta(pdBar, banner) : null,
      greenHeight: green ? Math.round(green.getBoundingClientRect().height * 100) / 100 : null,
      legacySplit: !!legacySplit,
      legacyCapsule,
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
    // Parcel card is display:none on ≥901 (desktop rail layout). Full 3-bar checks use ≤900.
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
            document.querySelectorAll(".iuHomeSectionBar").length >= 3 &&
            !!document.getElementById("iuSilverParcelWatch") &&
            !!document.querySelector('[data-testid="prehled-dne-homecard"]'),
          { timeout: 45000 }
        );
        await page.evaluate(() => {
          const parcel = document.getElementById("iuSilverParcelWatch");
          if (parcel && typeof parcel.scrollIntoView === "function") {
            parcel.scrollIntoView({ block: "center", inline: "nearest" });
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

        if (vp.expectParcel) {
          must(m.visibleCount === 3, prefix + ":bars_count:" + m.visibleCount);
          must(!!m.info && !!m.parcel && !!m.pd, prefix + ":bars_present");
        } else {
          // ≥901: parcel card hidden by existing desktop-rail CSS; info + PD bars must remain.
          must(!!m.info && !!m.pd, prefix + ":bars_info_pd");
          must(!m.parcel, prefix + ":parcel_hidden_with_card");
          must(m.visibleCount === 2, prefix + ":bars_count_no_parcel:" + m.visibleCount);
        }

        const active = vp.expectParcel
          ? [m.info, m.parcel, m.pd]
          : [m.info, m.pd];
        if (active.every(Boolean)) {
          const hs = active.map((b) => b.height);
          must(hs.every((h) => Math.abs(h - hs[0]) <= 1), prefix + ":height_equal:" + hs.join(","));
          must(
            m.greenHeight != null && Math.abs(active[0].height - m.greenHeight) <= 2,
            prefix + ":match_green_h:" + active[0].height + "/" + m.greenHeight
          );

          const bgs = active.map((b) => b.bg);
          must(bgs.every((b) => b === bgs[0]), prefix + ":bg_equal");
          must(nearBlue(parseRgb(active[0].bg)), prefix + ":bg_blue:" + active[0].bg);

          must(
            active.every((b) => b.fontSize === active[0].fontSize),
            prefix + ":font_size"
          );
          must(
            active.every((b) => b.fontWeight === active[0].fontWeight),
            prefix + ":font_weight"
          );
          must(
            active.every((b) => b.radiusTL === active[0].radiusTL),
            prefix + ":radius_tl"
          );
          must(
            active.every((b) => b.radiusTR === active[0].radiusTR),
            prefix + ":radius_tr"
          );
          must(
            active.every((b) => b.radiusBL === "0px"),
            prefix + ":radius_bl_flat"
          );
          must(
            active.every((b) => b.radiusBR === "0px"),
            prefix + ":radius_br_flat"
          );
          must(parseFloat(active[0].radiusTL) > 0, prefix + ":radius_tl_round");

          must(m.gapInfo != null && Math.abs(m.gapInfo) <= 0.5, prefix + ":gap_info:" + m.gapInfo);
          must(m.gapPd != null && Math.abs(m.gapPd) <= 0.5, prefix + ":gap_pd:" + m.gapPd);
          must(m.widthInfo != null && m.widthInfo <= 2, prefix + ":width_info:" + m.widthInfo);
          must(m.widthPd != null && m.widthPd <= 2, prefix + ":width_pd:" + m.widthPd);
          must(!m.info.inScroll, prefix + ":info_bar_not_in_scroll");

          if (vp.expectParcel) {
            must(m.parcelContainsBar, prefix + ":parcel_contains_bar");
            must(
              m.parcelBarTopFlush != null && m.parcelBarTopFlush <= 1.5,
              prefix + ":parcel_top_flush:" + m.parcelBarTopFlush
            );
            must(m.widthParcel != null && m.widthParcel <= 2, prefix + ":width_parcel:" + m.widthParcel);
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
  console.log("FAIL exception:" + String(err && err.message ? err.message : err));
  process.exit(1);
});
