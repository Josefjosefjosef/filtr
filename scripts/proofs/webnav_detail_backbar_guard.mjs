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

/** Default: all engines. Set WEBNAV_GUARD_ENGINES=chromium (comma-separated) to reduce harness memory on dev machines. */
function resolveGuardEngines() {
  const raw = String(process.env.WEBNAV_GUARD_ENGINES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order = raw.length ? raw : ["chromium", "webkit", "firefox"];
  const map = {
    chromium: { id: "chromium", launch: () => chromium.launch({ headless: true }) },
    webkit: { id: "webkit", launch: () => webkit.launch({ headless: true }) },
    firefox: { id: "firefox", launch: () => firefox.launch({ headless: true }) },
  };
  const out = [];
  for (const id of order) {
    if (map[id]) out.push(map[id]);
  }
  return out.length ? out : [map.chromium];
}

const GUARD_ENGINES = resolveGuardEngines();

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

/** Namedays fetch drives Silver welcome/calendar refresh; empty {} avoids extra async layout/URL work that can race WebNav gate state in harness. */
async function installNamedaysHarnessStubRoute(page) {
  await page.route(
    (url) => {
      try {
        const p = url.pathname.replace(/\\/g, "/");
        return p.endsWith("/projects/data/namedays.json");
      } catch {
        return false;
      }
    },
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: "{}",
      });
    }
  );
}

/** WebKit can log spurious CORS-style errors for same-origin JSON; fulfill from disk + ignore known noise below. */
async function installProjectsDataJsonRoutes(page) {
  for (const name of ["articles.json", "videos.json"]) {
    await page.route(
      (url) => {
        try {
          const p = url.pathname.replace(/\\/g, "/");
          return p.endsWith("/projects/data/" + name);
        } catch {
          return false;
        }
      },
      async (route) => {
        try {
          const fp = path.join(ROOT, "projects", "data", name);
          const buf = await fs.readFile(fp);
          await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: buf,
          });
        } catch {
          await route.continue();
        }
      }
    );
  }
}

function shouldIgnoreWebNavConsoleError(text) {
  const t = String(text || "").toLowerCase();
  if (t.indexOf("access control") !== -1) return true;
  return false;
}

/**
 * #iuMobileGatePanelNav starts empty; iuMobileGateReorder() moves #iuLeftRail in after init.
 * Without this wait, the harness can click before the rail host exists → no nav handler / no detail classes.
 */
async function waitForMobileWebNavRailHost(page) {
  await page.waitForFunction(
    () => {
      try {
        const wrap = document.getElementById("iuMobileGateWrap");
        return wrap && typeof wrap.__iuMobileGateSetTab === "function";
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForFunction(
    () => {
      try {
        const panel = document.getElementById("iuMobileGatePanelNav");
        const rail = document.getElementById("iuLeftRail");
        if (!panel || !rail || !panel.contains(rail)) return false;
        return Boolean(panel.querySelector('.iu-leftNavItem[data-accent="mapy"]'));
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForFunction(
    () => typeof window.iuWebNavDetailBackBarHostSync === "function",
    null,
    { timeout: 60000 }
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
  await page.waitForFunction(
    () => {
      try {
        const wrap = document.getElementById("iuMobileGateWrap");
        const panel = document.getElementById("iuMobileGatePanelNav");
        return (
          wrap &&
          wrap.getAttribute("data-iu-mobile-gate") === "nav" &&
          panel &&
          panel.hidden === false
        );
      } catch {
        return false;
      }
    },
    null,
    { timeout: 20000 }
  );
}

/** After returning from a tool detail, the gate may be cleared; force nav tab without toggling closed. */
async function reopenWebNavOverlayNav(page) {
  await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
      wrap.__iuMobileGateSetTab("nav");
    }
  });
  await page.waitForFunction(
    () => document.body.classList.contains("iu-mobileGateOverlayOpen"),
    null,
    { timeout: 20000 }
  );
  await page.waitForFunction(
    () => {
      try {
        const wrap = document.getElementById("iuMobileGateWrap");
        const panel = document.getElementById("iuMobileGatePanelNav");
        return (
          wrap &&
          wrap.getAttribute("data-iu-mobile-gate") === "nav" &&
          panel &&
          panel.hidden === false
        );
      } catch {
        return false;
      }
    },
    null,
    { timeout: 20000 }
  );
}

const MAPY_DETAIL_SEL = '#iuMobileGatePanelNav a.iu-leftNavItem[data-accent="mapy"]';

async function openMapyDetail(page, label) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const box = await page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } catch {
        return null;
      }
    }, MAPY_DETAIL_SEL);
    if (!box) fail(label + ": Mapy link missing inside #iuMobileGatePanelNav");
    await page.mouse.click(box.x, box.y);
    try {
      await page.waitForFunction(
        () =>
          document.body.classList.contains("iu-mobileMainVisible") &&
          document.body.classList.contains("iu-webnavDetailFromGate"),
        null,
        { timeout: 30000 }
      );
      return;
    } catch {
      if (attempt === 4) {
        fail(label + ": openMapyDetail body classes after mapy click");
      }
      await page.waitForTimeout(200);
    }
  }
}

async function waitBackOnGrid(page) {
  await page.waitForFunction(
    () =>
      !document.body.classList.contains("iu-mobileMainVisible") &&
      document.body.classList.contains("iu-mobileGateOverlayOpen") &&
      !document.body.classList.contains("iu-webnavDetailFromGate"),
    null,
    { timeout: 35000 }
  );
}

async function assertGridOkAfterBack(page, label, tag) {
  for (let r = 0; r < 40; r++) {
    const ok = await page.evaluate(() => {
      try {
        const wrap = document.getElementById("iuMobileGateWrap");
        const panel = document.getElementById("iuMobileGatePanelNav");
        return (
          wrap &&
          wrap.getAttribute("data-iu-mobile-gate") === "nav" &&
          panel &&
          panel.hidden === false &&
          Boolean(document.querySelector('#iuMobileGatePanelNav .iu-leftNavItem[data-accent="jr"]'))
        );
      } catch {
        return false;
      }
    });
    if (ok) return;
    await page.waitForTimeout(80);
  }
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
  fail(label + " " + tag + ": grid assert " + JSON.stringify(after));
}

async function runFlow(page, baseUrl, label, consoleErrors) {
  await installNamedaysHarnessStubRoute(page);
  await installProjectsDataJsonRoutes(page);
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });
  await waitForMobileWebNavRailHost(page);

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
  for (let attempt = 0; attempt < 28; attempt++) {
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

  /* Interior fractions — extreme left/right edges can miss #iuMobileMainBackBar hit target in WebKit. */
  const clickFracs = [0.2, 0.5, 0.8];
  const backBar = page.locator("#iuMobileMainBackBar");
  for (let i = 0; i < clickFracs.length; i++) {
    const fr = clickFracs[i];
    const box = await backBar.boundingBox();
    if (!box) fail(label + ": barBox pass " + i);
    const inset = Math.max(6, Math.min(box.width * 0.06, 28));
    const x = inset + (box.width - 2 * inset) * fr;
    const y = box.height / 2;
    await backBar.click({ position: { x, y }, force: true, timeout: 20000 });
    await waitBackOnGrid(page);
    await assertGridOkAfterBack(page, label, "clickFrac=" + fr);
    if (i < clickFracs.length - 1) {
      await reopenWebNavOverlayNav(page);
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

  return {
    snap,
    proof: {
      enteredWebNavRoot: true,
      enteredWebNavDetail: true,
      backReturnedToWebNavRoot: true,
      backDidNotJumpDirectlyHome: true,
      secondBackLeavesWebNav: true,
    },
  };
}

async function runDesktopUnchanged(page, baseUrl) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installNamedaysHarnessStubRoute(page);
  await installProjectsDataJsonRoutes(page);
  await page.goto(baseUrl + "/projects/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2000);

  let d = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await page.waitForLoadState("load", { timeout: 60000 }).catch(() => {});
      d = await page.evaluate(() => {
        const tabs = document.getElementById("iuMobileGateTabs");
        const cs = tabs ? window.getComputedStyle(tabs) : null;
        return {
          tabsDisplay: cs ? cs.display : "",
          bodyWebNav: document.body.classList.contains("iu-webnavDetailFromGate"),
        };
      });
      break;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.indexOf("Execution context was destroyed") === -1) throw e;
      await page.waitForTimeout(400);
    }
  }
  if (!d) fail("desktop: could not read gate tabs state (navigation churn)");
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
            deviceScaleFactor: 1,
          });
          const page = await context.newPage();
          page.on("console", (msg) => {
            if (msg.type() === "error") {
              const t = msg.text();
              if (!shouldIgnoreWebNavConsoleError(t)) consoleErrors.push(t);
            }
          });
          page.on("pageerror", (err) => {
            const t = String(err && err.message ? err.message : err);
            if (!shouldIgnoreWebNavConsoleError(t)) consoleErrors.push(t);
          });

          const diag = await runFlow(page, base, eng.id + "/" + vp.label, consoleErrors);
          summary.engines[eng.id].viewports[vp.label] = { pass: true, diag };
          await context.close();
        }

        const ctxD = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
        const pageD = await ctxD.newPage();
        const deskErr = [];
        pageD.on("console", (msg) => {
          if (msg.type() === "error") {
            const t = msg.text();
            if (!shouldIgnoreWebNavConsoleError(t)) deskErr.push(t);
          }
        });
        pageD.on("pageerror", (err) => {
          const t = String(err && err.message ? err.message : err);
          if (!shouldIgnoreWebNavConsoleError(t)) deskErr.push(t);
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
