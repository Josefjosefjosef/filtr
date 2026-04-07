#!/usr/bin/env node
/**
 * Regression: „Navigace po webu“ → detail nástroje → fixed full-width „Zpět“ → návrat do gridu (ne homepage).
 * Run: node scripts/proofs/webnav_detail_backbar_guard.mjs
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, webkit, firefox } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

/** Mobil + tablet portrait 768×1024: plný webnav overlay flow (rail v #iuMobileGatePanelNav). */
const VIEWPORTS_FLOW = [
  { w: 390, h: 844, label: "390x844" },
  { w: 768, h: 1024, label: "768x1024" },
];

const GUARD_ENGINES = [
  { id: "chromium", launch: () => chromium.launch({ headless: true }) },
  { id: "webkit", launch: () => webkit.launch({ headless: true }) },
  { id: "firefox", launch: () => firefox.launch({ headless: true }) },
];

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
      const relToRoot = path.relative(rootResolved, fp);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
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

/** WebKit (Playwright) can log spurious console errors for fetch(namedays.json) with custom Accept header; stub keeps harness noise-free. */
async function installNamedayStubRoute(page) {
  await page.route(
    (url) => url.pathname.endsWith("/namedays.json"),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: "{}",
      });
    }
  );
}

async function openWebNavOverlay(page) {
  await page.waitForSelector("#iuMobileGateTabNav", { timeout: 60000 });
  await page.click("#iuMobileGateTabNav");
  await page.waitForFunction(
    () => document.body.classList.contains("iu-mobileGateOverlayOpen"),
    null,
    { timeout: 20000 }
  );
}

async function openMapyDetail(page, label) {
  const inPanel = await page.evaluate(() =>
    Boolean(document.querySelector('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="mapy"]'))
  );
  if (!inPanel) {
    fail(label + ": expected Mapy link inside #iuMobileGatePanelNav");
  }
  await page.click('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="mapy"]');
  await page.waitForFunction(
    () =>
      document.body.classList.contains("iu-mobileMainVisible") &&
      document.body.classList.contains("iu-webnavDetailFromGate"),
    null,
    { timeout: 20000 }
  );
}

async function waitBackOnGrid(page) {
  await page.waitForFunction(
    () =>
      !document.body.classList.contains("iu-mobileMainVisible") &&
      document.body.classList.contains("iu-mobileGateOverlayOpen") &&
      !document.body.classList.contains("iu-webnavDetailFromGate"),
    null,
    { timeout: 20000 }
  );
}

async function assertGridOk(page, label, tag) {
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
  if (after.gate !== "nav" || after.panelNavHidden || !after.gridLink) {
    fail(label + " " + tag + ": grid assert " + JSON.stringify(after));
  }
}

async function runFlow(page, baseUrl, label, consoleErrors) {
  await installNamedayStubRoute(page);
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });

  await openWebNavOverlay(page);
  await openMapyDetail(page, label);

  const hostProbe = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    if (!bar || bar.hidden) return { ok: false };
    const r = bar.getBoundingClientRect();
    return {
      ok: bar.parentElement === document.body,
      parentTag: bar.parentElement ? bar.parentElement.tagName : "",
      top: r.top,
      width: r.width,
      innerWidth: window.innerWidth,
    };
  });
  if (!hostProbe.ok || hostProbe.parentTag !== "BODY") {
    fail(label + ": back bar must be reparented to body, got " + JSON.stringify(hostProbe));
  }
  if (typeof hostProbe.top === "number" && hostProbe.top > 80) {
    fail(label + ": back bar top-lock fail top=" + hostProbe.top);
  }

  const domProbe = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    if (!bar || bar.hidden) return { ok: false, reason: "no_bar" };
    const cs = window.getComputedStyle(bar);
    const r = bar.getBoundingClientRect();
    const vw = window.innerWidth;
    const txt = String(bar.textContent || "").trim();
    const alignOk = cs.textAlign === "right" || cs.justifyContent === "flex-end";
    return {
      ok: cs.position === "fixed" && r.width >= vw * 0.92 && txt === "Zpět" && alignOk,
      pos: cs.position,
      w: r.width,
      vw,
      txt,
      textAlign: cs.textAlign,
      justifyContent: cs.justifyContent,
    };
  });

  if (!domProbe.ok) {
    fail(label + ": back bar probe " + JSON.stringify(domProbe));
  }

  const clickFracs = [0.08, 0.5, 0.92];
  for (let i = 0; i < clickFracs.length; i++) {
    const fr = clickFracs[i];
    const barBox = await page.evaluate(() => {
      const bar = document.getElementById("iuMobileMainBackBar");
      return bar ? bar.getBoundingClientRect() : null;
    });
    if (!barBox) fail(label + ": barBox pass " + i);
    const x = barBox.left + barBox.width * fr;
    const y = barBox.top + barBox.height / 2;
    await page.mouse.click(x, y);
    await waitBackOnGrid(page);
    await assertGridOk(page, label, "clickFrac=" + fr);
    if (i < clickFracs.length - 1) {
      await openMapyDetail(page, label);
    }
  }

  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflowX) fail(label + ": overflowX");

  const appErr = await page.evaluate(() => {
    try {
      const s = localStorage.getItem("iu:lastError");
      return s && String(s).trim() ? String(s).slice(0, 200) : "";
    } catch {
      return "(localStorage)";
    }
  });
  if (appErr) fail(label + ": appErrors iu:lastError=" + appErr);

  if (consoleErrors.length) fail(label + ": console errors: " + consoleErrors.join(" | "));
}

async function runDesktopUnchanged(page, baseUrl) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installNamedayStubRoute(page);
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
  const summary = { engines: {}, skippedEngines: [] };

  try {
    for (const eng of GUARD_ENGINES) {
      let browser = null;
      try {
        browser = await eng.launch();
      } catch (e) {
        summary.skippedEngines.push(eng.id + ":" + String(e && e.message ? e.message : e));
        continue;
      }
      summary.engines[eng.id] = { viewports: {} };
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

          await runFlow(page, base, eng.id + "/" + vp.label, consoleErrors);
          summary.engines[eng.id].viewports[vp.label] = "PASS";
          await context.close();
        }

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
        if (deskErr.length) fail(eng.id + " desktop: console errors " + deskErr.join(" | "));
        summary.engines[eng.id].desktop = "PASS";
        await ctxD.close();
      } finally {
        await browser.close();
      }
    }

    if (Object.keys(summary.engines).length === 0) {
      fail("no browser engines launched (install: npx playwright install)");
    }

    console.log("[WEBNAV_DETAIL_BACKBAR_GUARD PASS]");
    console.log(JSON.stringify(summary));
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
