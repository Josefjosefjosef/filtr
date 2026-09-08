#!/usr/bin/env node
/**
 * iCentrum desktop panel size — large PC modal; mobile/tablet unchanged.
 * Run: npm run iu-icentrum-desktop-panel-size-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const CACHE = "pc-mindmenu-privacy-stack-v1-20260908";
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-info-center.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");

  must(new RegExp("iu-info-center\\.css\\?v=" + CACHE).test(index), "static:css_cache");
  must(/@media\s*\(\s*min-width:\s*1025px\s*\)/.test(css), "static:desktop_mq");
  must(/88vw/.test(css), "static:width_88vw");
  must(/1600px/.test(css), "static:max_width_cap");
  must(/100dvh\s*-\s*32px/.test(css), "static:height_dvh");
  must(/auto-fill,\s*minmax\(280px/.test(css), "static:grid_autofill");
  /* Mobile fullscreen contract still present */
  must(/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]{0,800}width:\s*100vw/.test(css), "static:mobile_100vw");
  must(/Informační centrum/.test(index), "static:title");
  must(/iuTopbarInfoOverlayClose/.test(index), "static:close_btn");
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
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function openIcentrum(page) {
  await page.waitForFunction(
    () =>
      !!document.getElementById("iuTopbarInfoOverlayTpl") ||
      !!document.getElementById("iuTopbarInfoOverlay"),
    { timeout: 120000 }
  );
  await page.evaluate(() => {
    const existing = document.getElementById("iuTopbarInfoOverlay");
    if (!existing) {
      const tpl = document.getElementById("iuTopbarInfoOverlayTpl");
      if (tpl && tpl.content) {
        tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
        tpl.parentNode.removeChild(tpl);
        document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
      }
    }
    if (typeof window.iuInfoCenterOpenSection === "function") {
      window.iuInfoCenterOpenSection("menu");
      return;
    }
    const overlay = document.getElementById("iuTopbarInfoOverlay");
    if (overlay) {
      overlay.hidden = false;
      overlay.removeAttribute("aria-hidden");
      overlay.setAttribute("data-iu-info-view", "menu");
    }
    const menu = document.getElementById("iuInfoCenterMenu");
    if (menu) menu.hidden = false;
  });
  await page.waitForFunction(
    () => {
      const o = document.getElementById("iuTopbarInfoOverlay");
      return o && !o.hidden;
    },
    { timeout: 30000 }
  );
  await page.waitForTimeout(350);
}

async function measure(page, label, expectDesktop) {
  const m = await page.evaluate((expectDesktop) => {
    const overlay = document.getElementById("iuTopbarInfoOverlay");
    const panel = overlay && overlay.querySelector(".iuTopbarInfoOverlay__panel");
    const close = document.getElementById("iuTopbarInfoOverlayClose");
    const title = document.getElementById("iuTopbarInfoOverlayTitle");
    const body = overlay && overlay.querySelector(".iuInfoCenter__body");
    const menu = document.getElementById("iuInfoCenterMenu");
    if (!overlay || !panel || !close) return { ok: false, reason: "missing" };
    const pr = panel.getBoundingClientRect();
    const cr = close.getBoundingClientRect();
    const pcs = getComputedStyle(panel);
    const bcs = body ? getComputedStyle(body) : null;
    const mcs = menu ? getComputedStyle(menu) : null;
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const panelOverflowX = panel.scrollWidth > panel.clientWidth + 2;
    return {
      ok: true,
      vw: window.innerWidth,
      vh: window.innerHeight,
      panelW: pr.width,
      panelH: pr.height,
      panelTop: pr.top,
      panelBottom: pr.bottom,
      widthRatio: pr.width / window.innerWidth,
      heightRatio: pr.height / window.innerHeight,
      closeVisible: cr.width > 0 && cr.height > 0 && cr.top >= 0 && cr.bottom <= window.innerHeight + 1,
      title: title ? String(title.textContent || "").trim() : "",
      overflowX,
      panelOverflowX,
      bodyOverflowY: bcs ? bcs.overflowY : null,
      menuOverflowY: mcs ? mcs.overflowY : null,
      borderRadius: pcs.borderRadius,
      expectDesktop,
    };
  }, expectDesktop);

  must(m.ok, label + ":probe_ok");
  if (!m.ok) return m;
  must(m.title === "Informační centrum", label + ":title");
  must(m.closeVisible, label + ":close_visible");
  must(!m.overflowX, label + ":no_doc_h_overflow");
  must(!m.panelOverflowX, label + ":no_panel_h_overflow");
  must(m.panelBottom <= m.vh + 2, label + ":within_viewport_bottom");
  must(m.panelTop >= -1, label + ":within_viewport_top");

  if (expectDesktop) {
    must(m.widthRatio >= 0.82 && m.widthRatio <= 0.94, label + ":width_ratio_85_90");
    must(m.heightRatio >= 0.85, label + ":height_ratio_large");
    must(m.panelW <= 1600 + 2, label + ":max_width_cap");
    must(/auto|scroll/.test(String(m.menuOverflowY)), label + ":menu_scroll");
  } else if (m.vw <= 480) {
    /* Phone: width tracks container (min(680px,100%) → ~full) */
    must(m.widthRatio >= 0.95, label + ":phone_near_full_width");
  } else {
    /* Tablet ≤1024: preserve prior capped width (~680), must NOT get desktop 88vw shell */
    must(m.panelW <= 700, label + ":tablet_not_desktop_wide");
    must(m.widthRatio < 0.95, label + ":tablet_not_full_bleed_desktop");
  }
  return m;
}

async function runtimeGate() {
  const PORT = parseInt(process.env.IU_GUARD_PORT || "8973", 10);
  const srv = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 25000);
    const browser = await chromium.launch({ headless: true });
    const deskCases = [
      { label: "desk_1366", w: 1366, h: 768 },
      { label: "desk_1440", w: 1440, h: 900 },
      { label: "desk_1920", w: 1920, h: 1080 },
      { label: "desk_1280", w: 1280, h: 800 },
    ];
    for (const c of deskCases) {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: c.w, height: c.h } });
      const page = await bootstrapGuardPage(ctx);
      await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await openIcentrum(page);
      await measure(page, c.label, true);
      await ctx.close();
    }

    const mobileCases = [
      { label: "mobile_390", w: 390, h: 844 },
      { label: "tablet_768", w: 768, h: 1024 },
    ];
    for (const c of mobileCases) {
      const ctx = await bootstrapGuardContext(browser, {
        viewport: { width: c.w, height: c.h },
        hasTouch: true,
      });
      const page = await bootstrapGuardPage(ctx);
      await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await openIcentrum(page);
      await measure(page, c.label, false);
      await ctx.close();
    }

    await browser.close();
  } finally {
    try {
      srv.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "static", fails }, null, 2));
    process.exit(1);
  }
  await runtimeGate();
  if (fails.length) {
    console.error(JSON.stringify({ result: "FAIL", phase: "runtime", fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      result: "PASS",
      IU_ICENTRUM_DESKTOP_PANEL_SIZE_GUARD: "PASS",
      CACHE,
    })
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
