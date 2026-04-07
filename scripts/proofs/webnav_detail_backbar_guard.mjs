#!/usr/bin/env node
/**
 * Regression: „Navigace po webu“ → detail nástroje → fixed full-width „Zpět“ → návrat do gridu (ne homepage).
 * Run: node scripts/proofs/webnav_detail_backbar_guard.mjs
 *
 * Pozn.: emulace v Playwright nemusí mít stejné safe-area / dynamic browser chrome jako fyzické zařízení.
 * Guard proto kontroluje svislé zarovnání lišty k #topbarWrap.getBoundingClientRect().bottom (stejný model jako produkční JS).
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

  await page.evaluate(() => {
    try {
      if (typeof window.iuWebNavDetailBackBarHostSync === "function") window.iuWebNavDetailBackBarHostSync();
    } catch (_) {}
    try {
      if (typeof window.iuWebNavDetailBackBarTopSync === "function") window.iuWebNavDetailBackBarTopSync();
    } catch (_) {}
  });
  await page.evaluate(
    () =>
      new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      })
  );

  /* Stejný model jako iuWebNavDetailBackBarTopSync: viditelný topbar → jeho spodek; jinak safe-area (topbar je na ≤1024px často display:none). */
  let aligned = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    aligned = await page.evaluate(() => {
      function iuGuardTargetTopPx() {
        var tb = document.getElementById("topbarWrap");
        if (tb) {
          var cs = window.getComputedStyle(tb);
          var tr = tb.getBoundingClientRect();
          if (cs.display !== "none" && cs.visibility !== "hidden" && tr.height > 4 && tr.width > 4) {
            return tr.bottom;
          }
        }
        var p = document.createElement("div");
        p.style.cssText =
          "position:fixed;left:0;top:0;width:0;height:0;margin:0;border:0;padding:0;visibility:hidden;pointer-events:none;z-index:-1;padding-top:env(safe-area-inset-top,0px);";
        document.documentElement.appendChild(p);
        var s = parseFloat(window.getComputedStyle(p).paddingTop) || 0;
        document.documentElement.removeChild(p);
        return s;
      }
      const bar = document.getElementById("iuMobileMainBackBar");
      if (!bar || bar.hidden) return false;
      try {
        if (typeof window.iuWebNavDetailBackBarTopSync === "function") window.iuWebNavDetailBackBarTopSync();
      } catch (_) {}
      const targetTop = iuGuardTargetTopPx();
      const d = Math.abs(bar.getBoundingClientRect().top - targetTop);
      return d <= 12;
    });
    if (aligned) break;
    await page.waitForTimeout(120);
  }
  if (!aligned) {
    const dump = await page.evaluate(() => {
      const bar = document.getElementById("iuMobileMainBackBar");
      const tb = document.getElementById("topbarWrap");
      const br = bar ? bar.getBoundingClientRect() : null;
      const tr = tb ? tb.getBoundingClientRect() : null;
      var target = 0;
      var usedTopbar = false;
      if (tb) {
        var cs = window.getComputedStyle(tb);
        if (cs.display !== "none" && cs.visibility !== "hidden" && tr && tr.height > 4 && tr.width > 4) {
          target = tr.bottom;
          usedTopbar = true;
        }
      }
      if (!usedTopbar) {
        var p2 = document.createElement("div");
        p2.style.cssText =
          "position:fixed;left:0;top:0;width:0;height:0;margin:0;border:0;padding:0;visibility:hidden;pointer-events:none;z-index:-1;padding-top:env(safe-area-inset-top,0px);";
        document.documentElement.appendChild(p2);
        target = parseFloat(window.getComputedStyle(p2).paddingTop) || 0;
        document.documentElement.removeChild(p2);
      }
      return {
        barHidden: bar ? bar.hidden : null,
        barParent: bar && bar.parentElement ? bar.parentElement.tagName : null,
        cssVarTop: getComputedStyle(document.documentElement).getPropertyValue("--iuWebNavDetailMainBackTop").trim(),
        barTop: br ? br.top : null,
        topbarBottom: tr ? tr.bottom : null,
        targetTopUsed: target,
        delta: br ? Math.abs(br.top - target) : null,
        topbarHeight: tr ? tr.height : null,
        topbarDisplay: tb ? getComputedStyle(tb).display : null,
      };
    });
    fail(label + ": topbar/backbar align timeout " + JSON.stringify(dump));
  }

  const snap = await page.evaluate(() => {
    const bar = document.getElementById("iuMobileMainBackBar");
    const tb = document.getElementById("topbarWrap");
    const lc = document.getElementById("leftContent");
    if (!bar || bar.hidden) return { ok: false, reason: "no_bar" };
    const br = bar.getBoundingClientRect();
    const tr = tb ? tb.getBoundingClientRect() : null;
    var targetTopPx = 0;
    var usedTopbarSnap = false;
    if (tb) {
      var csTb = window.getComputedStyle(tb);
      if (csTb.display !== "none" && csTb.visibility !== "hidden" && tr && tr.height > 4 && tr.width > 4) {
        targetTopPx = tr.bottom;
        usedTopbarSnap = true;
      }
    }
    if (!usedTopbarSnap) {
      var pr = document.createElement("div");
      pr.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;margin:0;border:0;padding:0;visibility:hidden;pointer-events:none;z-index:-1;padding-top:env(safe-area-inset-top,0px);";
      document.documentElement.appendChild(pr);
      targetTopPx = parseFloat(window.getComputedStyle(pr).paddingTop) || 0;
      document.documentElement.removeChild(pr);
    }
    const deltaTop = Math.abs(br.top - targetTopPx);
    const cs = window.getComputedStyle(bar);
    const vw = window.innerWidth;
    const txt = String(bar.textContent || "").trim();
    const alignOk = cs.textAlign === "right" || cs.justifyContent === "flex-end";
    const cssVarTop = window.getComputedStyle(document.documentElement).getPropertyValue("--iuWebNavDetailMainBackTop").trim();
    const lcPad = lc ? parseFloat(window.getComputedStyle(lc).paddingTop) || 0 : 0;
    return {
      okHost: bar.parentElement === document.body,
      parentTag: bar.parentElement ? bar.parentElement.tagName : "",
      okTopAlign: deltaTop <= 12,
      okDom:
        cs.position === "fixed" &&
        br.width >= vw * 0.92 &&
        txt === "Zpět" &&
        alignOk,
      barTop: br.top,
      topbarBottom: tr ? tr.bottom : null,
      targetTopPx,
      usedTopbarForTop: usedTopbarSnap,
      deltaTop,
      cssVarTop,
      innerWidth: vw,
      barWidth: br.width,
      position: cs.position,
      topComputed: cs.top,
      left: cs.left,
      right: cs.right,
      justifyContent: cs.justifyContent,
      textAlign: cs.textAlign,
      zIndex: cs.zIndex,
      pointerEvents: cs.pointerEvents,
      leftContentPaddingTop: lcPad,
    };
  });

  if (!snap.okHost || snap.parentTag !== "BODY") {
    fail(label + ": back bar host " + JSON.stringify(snap));
  }
  if (!snap.okTopAlign) {
    fail(label + ": back bar vertical align (topbar bottom or safe-area) " + JSON.stringify(snap));
  }
  if (!snap.okDom) {
    fail(label + ": back bar dom probe " + JSON.stringify(snap));
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

  return snap;
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

          const diag = await runFlow(page, base, eng.id + "/" + vp.label, consoleErrors);
          summary.engines[eng.id].viewports[vp.label] = { pass: true, diag };
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
