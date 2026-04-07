#!/usr/bin/env node
/**
 * Regression: „Navigace po webu“ → detail nástroje → fixed full-width „Zpět“ → návrat do gridu (ne homepage).
 * Run: node scripts/proofs/webnav_detail_backbar_guard.mjs
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

/** 768x700: v rámci (max-width:900) a poměru stran > 1/1 je rail v panelu (768x1024 portrait ho nechává v #newsList). */
const VIEWPORTS_FLOW = [
  { w: 390, h: 844, label: "390x844" },
  { w: 768, h: 700, label: "768x700_tablet_rail_in_panel" },
];

const VIEWPORT_LAYOUT_768 = { w: 768, h: 1024, label: "768x1024_layout_probe" };

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function stripCspFromHtml(buf) {
  const s = buf.toString("utf8");
  return Buffer.from(s.replace(/<meta\s[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, ""), "utf8");
}

function startStaticServer() {
  const rootResolved = path.resolve(ROOT);
  const server = http.createServer(async (req, res) => {
    try {
      let u = (req.url || "/").split("?")[0];
      if (u === "/" || u === "") u = "/projects/index.html";
      let rel = decodeURIComponent(u.replace(/^\//, "")).replace(/\\/g, "/");
      if (rel.endsWith("/")) rel += "index.html";
      const fp = path.resolve(rootResolved, rel);
      if (!fp.startsWith(rootResolved)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      let buf = await fs.readFile(fp);
      if (/\.html?$/i.test(fp)) buf = stripCspFromHtml(buf);
      res.setHeader("Content-Type", mime(fp));
      res.statusCode = 200;
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
  });
}

function fail(msg) {
  console.error("[WEBNAV_DETAIL_BACKBAR_GUARD FAIL]", msg);
  process.exit(1);
}

async function runFlow(page, baseUrl, label, consoleErrors) {
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });

  await page.waitForSelector("#iuMobileGateTabNav", { timeout: 60000 });
  await page.click("#iuMobileGateTabNav");
  await page.waitForFunction(
    () => document.body.classList.contains("iu-mobileGateOverlayOpen"),
    null,
    { timeout: 20000 }
  );

  const inPanel = await page.evaluate(() =>
    Boolean(document.querySelector('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="mapy"]'))
  );
  if (!inPanel) {
    fail(label + ": expected Mapy link inside #iuMobileGatePanelNav (viewport may keep rail out of panel)");
  }

  await page.click('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="mapy"]');
  await page.waitForFunction(
    () =>
      document.body.classList.contains("iu-mobileMainVisible") &&
      document.body.classList.contains("iu-webnavDetailFromGate"),
    null,
    { timeout: 20000 }
  );

  const domProbe = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    const wrap = document.getElementById("iuMobileGateWrap");
    if (!bar || bar.hidden) return { ok: false, reason: "no_bar" };
    const cs = window.getComputedStyle(bar);
    const pos = cs.position;
    const w = bar.getBoundingClientRect().width;
    const vw = window.innerWidth;
    const txt = String(bar.textContent || "").trim();
    const alignOk = cs.textAlign === "right" || cs.justifyContent === "flex-end";
    return {
      ok: pos === "fixed" && w >= vw * 0.92 && txt === "Zpět" && alignOk,
      pos,
      w,
      vw,
      txt,
      textAlign: cs.textAlign,
      justifyContent: cs.justifyContent,
      gateTab: wrap ? wrap.getAttribute("data-iu-mobile-gate") : null,
    };
  });

  if (!domProbe.ok) {
    fail(label + ": back bar probe " + JSON.stringify(domProbe));
  }

  const barBox = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    return bar ? bar.getBoundingClientRect() : null;
  });
  if (!barBox) fail(label + ": barBox");
  await page.mouse.click(barBox.left + 6, barBox.top + barBox.height / 2);

  await page.waitForFunction(
    () =>
      !document.body.classList.contains("iu-mobileMainVisible") &&
      document.body.classList.contains("iu-mobileGateOverlayOpen") &&
      !document.body.classList.contains("iu-webnavDetailFromGate"),
    null,
    { timeout: 20000 }
  );

  const after = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    return {
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") : null,
      panelNavHidden: (() => {
        const p = document.getElementById("iuMobileGatePanelNav");
        return p ? p.hidden : true;
      })(),
      gridLink: Boolean(document.querySelector('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="jr"]')),
    };
  });

  if (after.gate !== "nav" || after.panelNavHidden) {
    fail(label + ": expected return to webnav grid, got " + JSON.stringify(after));
  }
  if (!after.gridLink) {
    fail(label + ": grid link missing after back");
  }

  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflowX) fail(label + ": overflowX");

  if (consoleErrors.length) fail(label + ": console errors: " + consoleErrors.join(" | "));
}

async function runLayout768(page, baseUrl, consoleErrors) {
  await page.setViewportSize({ width: VIEWPORT_LAYOUT_768.w, height: VIEWPORT_LAYOUT_768.h });
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    document.body.classList.add("iu-mobileMainVisible", "iu-webnavDetailFromGate");
    const b = document.getElementById("iuMobileMainBackBar");
    if (b) b.hidden = false;
  });

  const probe = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    if (!bar) return { ok: false };
    const cs = window.getComputedStyle(bar);
    const r = bar.getBoundingClientRect();
    return {
      ok: cs.position === "fixed" && r.width >= window.innerWidth * 0.92,
      position: cs.position,
      width: r.width,
      innerWidth: window.innerWidth,
    };
  });

  if (!probe.ok) fail("768x1024_layout_probe: " + JSON.stringify(probe));
  if (consoleErrors.length) fail("768x1024_layout: console " + consoleErrors.join(" | "));
}

async function runDesktopUnchanged(page, baseUrl) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2000);

  const d = await page.evaluate(() => {
    const tabs = document.getElementById("iuMobileGateTabs");
    const cs = tabs ? window.getComputedStyle(tabs) : null;
    return {
      tabsDisplay: cs ? cs.display : "",
      bodyWebNav: document.body.classList.contains("iu-webnavDetailFromGate"),
    };
  });
  if (d.bodyWebNav) fail("desktop: unexpected iu-webnavDetailFromGate");
  if (d.tabsDisplay !== "none") fail("desktop: expected #iuMobileGateTabs display none, got " + d.tabsDisplay);
}

async function main() {
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });

  try {
    for (const vp of VIEWPORTS_FLOW) {
      const consoleErrors = [];
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => {
        consoleErrors.push(String(err && err.message ? err.message : err));
      });

      await runFlow(page, base, vp.label, consoleErrors);
      await context.close();
    }

    const console768 = [];
    const ctx768 = await browser.newContext({
      viewport: { width: VIEWPORT_LAYOUT_768.w, height: VIEWPORT_LAYOUT_768.h },
      serviceWorkers: "block",
    });
    const page768 = await ctx768.newPage();
    page768.on("console", (msg) => {
      if (msg.type() === "error") console768.push(msg.text());
    });
    page768.on("pageerror", (err) => {
      console768.push(String(err && err.message ? err.message : err));
    });
    await runLayout768(page768, base, console768);
    await ctx768.close();

    const ctxD = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
    const pageD = await ctxD.newPage();
    const deskErr = [];
    pageD.on("console", (msg) => {
      if (msg.type() === "error") deskErr.push(msg.text());
    });
    pageD.on("pageerror", (err) => {
      deskErr.push(String(err && err.message ? err.message : err));
    });
    await runDesktopUnchanged(pageD, base);
    if (deskErr.length) fail("desktop: console errors " + deskErr.join(" | "));
    await ctxD.close();

    console.log("[WEBNAV_DETAIL_BACKBAR_GUARD PASS]");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
