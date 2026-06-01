/**
 * Parcel card layout + reload stability guard (Playwright).
 *
 * Checks on mobile/tablet viewports:
 * - overflowX=false
 * - mainShell (input+button wrapper) fully visible, not clipped
 * - input, button, card visible
 * - CLS=0 after reload settle window
 * - silver hero stable after reload
 *
 * Env: IU_PARCEL_LAYOUT_GUARD_URL (default https://infouzel.cz/projects/?section=media)
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} from "./proofs/open_meteo_guard_stub.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOCAL_PORT = 8088;

const DEFAULT_URL = "https://infouzel.cz/projects/?section=media";
const CLS_CAP = 0.001;
const SILVER_SHIFT_CAP = 4;
const VIEWPORTS = [
  { w: 390, h: 844, label: "390x844" },
  { w: 768, h: 1024, label: "768x1024" },
];

function envUrl() {
  const u = String(process.env.IU_PARCEL_LAYOUT_GUARD_URL || DEFAULT_URL).trim();
  return u || DEFAULT_URL;
}

function serveFile(urlPath) {
  let filePath = path.join(ROOT, urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html");
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".json"
                ? "application/json"
                : ext === ".webp"
                  ? "image/webp"
                  : ext === ".ico"
                    ? "image/x-icon"
                    : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.on("error", (err) => {
      process.stderr.write(String(err && err.message ? err.message : err) + "\n");
      process.exit(1);
    });
    server.listen(LOCAL_PORT, "127.0.0.1", () => resolve(server));
  });
}

function resolveGuardUrl() {
  if (process.env.IU_PARCEL_LAYOUT_GUARD_LOCAL === "1") {
    return `http://127.0.0.1:${LOCAL_PORT}/projects/?section=media`;
  }
  const configured = envUrl();
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(configured)) {
    return configured;
  }
  return configured;
}

async function installHarness(context) {
  await context.addInitScript(() => {
    window.__iuParcelLayoutCls = 0;
    window.__iuSilverHeroShift = 0;
    window.__iuParcelLayoutReady = false;
    try {
      window.__iuParcelLayoutClsPO = new PerformanceObserver(function (list) {
        if (!window.__iuParcelLayoutReady) return;
        for (let i = 0; i < list.getEntries().length; i++) {
          const e = list.getEntries()[i];
          if (e.hadRecentInput || !e.value) continue;
          window.__iuParcelLayoutCls = (window.__iuParcelLayoutCls || 0) + e.value;
          if (!e.sources) continue;
          for (let j = 0; j < e.sources.length; j++) {
            const s = e.sources[j];
            try {
              const n = s.node;
              if (!n) continue;
              const id = n.id || "";
              const cls = typeof n.className === "string" ? n.className : "";
              if (
                id === "iuSilverHeroPremium" ||
                id === "iuSilverParcelWatch" ||
                cls.indexOf("iuSilverParcelWatch") >= 0
              ) {
                const prev = s.previousRect ? s.previousRect.height : 0;
                const curr = s.currentRect ? s.currentRect.height : 0;
                const d = Math.abs(curr - prev);
                if (d > window.__iuSilverHeroShift) window.__iuSilverHeroShift = d;
              }
            } catch (_) {}
          }
        }
      });
      window.__iuParcelLayoutClsPO.observe({ type: "layout-shift", buffered: false });
    } catch (_) {}
  });
}

function probeParcelLayout() {
  const docEl = document.documentElement;
  const body = document.body;
  const overflowX =
    (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
    (body && body.scrollWidth > body.clientWidth + 1);

  const watch = document.getElementById("iuSilverParcelWatch");
  const shell = document.querySelector(".iuSilverParcelWatch__mainShell");
  const inp = document.getElementById("iuSilverParcelWatchInput");
  const btn = document.getElementById("iuSilverParcelWatchSave");
  const hero = document.getElementById("iuSilverHeroPremium");

  function vis(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function fullyInside(child, parent, pad) {
    if (!child || !parent) return false;
    const c = child.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const slack = pad || 2;
    return (
      c.top >= p.top - slack &&
      c.left >= p.left - slack &&
      c.bottom <= p.bottom + slack &&
      c.right <= p.right + slack
    );
  }

  let shellClipped = false;
  let shellBgOk = false;
  if (shell) {
    const bg = getComputedStyle(shell).backgroundColor || "";
    shellBgOk =
      bg.indexOf("88, 100, 116") >= 0 ||
      bg.indexOf("88,100,116") >= 0 ||
      bg.indexOf("74, 85, 104") >= 0 ||
      bg.indexOf("74,85,104") >= 0;
    if (watch) {
      shellClipped = !fullyInside(shell, watch, 3);
    }
    if (shell === watch || (watch && !watch.contains(shell))) {
      shellClipped = true;
    }
    const sh = shell.getBoundingClientRect();
    const wh = watch ? watch.getBoundingClientRect() : null;
    if (wh && (sh.bottom > wh.bottom + 3 || sh.top < wh.top - 3)) shellClipped = true;
  }

  let inputBgOk = false;
  if (inp) {
    const ibg = getComputedStyle(inp).backgroundColor || "";
    inputBgOk =
      ibg.indexOf("238, 241, 245") >= 0 ||
      ibg.indexOf("238,241,245") >= 0;
  }

  let btnBlueOk = false;
  if (btn) {
    const bi = String(getComputedStyle(btn).backgroundImage || "");
    const bc = String(getComputedStyle(btn).backgroundColor || "");
    btnBlueOk =
      bi.indexOf("gradient") >= 0 ||
      bc.indexOf("30, 64, 175") >= 0 ||
      bc.indexOf("30,64,175") >= 0 ||
      bc.indexOf("37, 99, 235") >= 0;
  }

  return {
    overflowX,
    parcelCardVisible: vis(watch),
    inputVisible: vis(inp),
    buttonVisible: vis(btn),
    shellVisible: vis(shell),
    shellNotClipped: !shellClipped && fullyInside(inp, shell, 2) && fullyInside(btn, shell, 2),
    shellBgOk,
    inputBgOk,
    btnBlueOk,
    silverHeroFound: !!hero,
    cls: Number(window.__iuParcelLayoutCls || 0),
    silverShift: Number(window.__iuSilverHeroShift || 0),
  };
}

async function runViewport(page, w, h, label, guardUrl) {
  const isLocal = guardUrl.indexOf("127.0.0.1") >= 0 || guardUrl.indexOf("localhost") >= 0;
  if (!isLocal) {
    await installProofGuardNetworkStubs(page);
  }
  const ignorableTracker = createIgnorableResourceTracker();
  if (!isLocal) {
    ignorableTracker.attachToPage(page);
  }

  const rawConsoleErrors = [];
  let appErrors = 0;
  const onConsole = (msg) => {
    try {
      if (msg.type() === "error") rawConsoleErrors.push(String(msg.text()));
    } catch (_) {}
  };
  const onPageError = (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
      rawConsoleErrors.push(t);
    } catch (_) {}
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(guardUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("iuSilverTallScrollViewport");
      if (!el || !document.documentElement.contains(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    },
    { timeout: 45000 },
  );
  await page.waitForTimeout(600);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.waitForSelector("#iuSilverParcelWatchInput", { timeout: 45000 });
  await page.waitForFunction(
    () => !!(window.IU_SILVER_PARCEL_FACADE && window.IU_PARCEL_TRACKING_ENGINE),
    { timeout: 20000 },
  );
  await page.waitForTimeout(2800);

  await page.evaluate(() => {
    window.__iuParcelLayoutCls = 0;
    window.__iuSilverHeroShift = 0;
    window.__iuParcelLayoutReady = true;
  });
  await page.waitForTimeout(400);

  const cold = await page.evaluate(probeParcelLayout);

  await page.evaluate(() => {
    window.__iuParcelLayoutCls = 0;
    window.__iuSilverHeroShift = 0;
    window.__iuParcelLayoutReady = false;
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("iuSilverTallScrollViewport");
      if (!el || !document.documentElement.contains(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    },
    { timeout: 45000 },
  );
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.waitForSelector("#iuSilverParcelWatchInput", { timeout: 45000 });
  await page.waitForFunction(
    () => !!(window.IU_SILVER_PARCEL_FACADE && window.IU_PARCEL_TRACKING_ENGINE),
    { timeout: 20000 },
  );
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    window.__iuParcelLayoutCls = 0;
    window.__iuSilverHeroShift = 0;
    window.__iuParcelLayoutReady = true;
  });
  await page.waitForTimeout(400);

  const reload = await page.evaluate(probeParcelLayout);

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  const ignorableOpts = {
    hadRecentIgnorableFailure: ignorableTracker.hadRecentIgnorableFailure.bind(ignorableTracker),
  };
  const consoleErrors = rawConsoleErrors.filter(
    (t) => !isIgnorableGuardConsoleError(t, ignorableOpts),
  );

  const pass =
    !reload.overflowX &&
    reload.parcelCardVisible &&
    reload.inputVisible &&
    reload.buttonVisible &&
    reload.shellVisible &&
    reload.shellNotClipped &&
    reload.shellBgOk &&
    reload.inputBgOk &&
    reload.btnBlueOk &&
    reload.cls <= CLS_CAP &&
    reload.silverShift <= SILVER_SHIFT_CAP &&
    consoleErrors.length === 0 &&
    appErrors === 0;

  return {
    label,
    cold,
    reload,
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: appErrors,
    pass,
  };
}

async function main() {
  let localServer = null;
  const guardUrl = resolveGuardUrl();
  if (guardUrl.indexOf(`127.0.0.1:${LOCAL_PORT}`) >= 0) {
    localServer = await startLocalServer();
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await installHarness(ctx);

  const results = [];
  try {
    for (let i = 0; i < VIEWPORTS.length; i++) {
      const vp = VIEWPORTS[i];
      const pg = await ctx.newPage();
      try {
        results.push(await runViewport(pg, vp.w, vp.h, vp.label, guardUrl));
      } finally {
        await pg.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
    if (localServer) {
      await new Promise((resolve) => localServer.close(resolve));
    }
  }

  const finalPass = results.every((r) => r.pass);
  const rep = results.find((r) => r.label === "390x844") || results[0];

  process.stdout.write("=== IU_SILVER_PARCEL_LAYOUT_GUARD ===\n");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    process.stdout.write(`\n${r.label}:\n`);
    process.stdout.write("  pass: " + r.pass + "\n");
    process.stdout.write("  overflowX: " + r.reload.overflowX + "\n");
    process.stdout.write("  parcelCardVisible: " + r.reload.parcelCardVisible + "\n");
    process.stdout.write("  inputVisible: " + r.reload.inputVisible + "\n");
    process.stdout.write("  buttonVisible: " + r.reload.buttonVisible + "\n");
    process.stdout.write("  shellNotClipped: " + r.reload.shellNotClipped + "\n");
    process.stdout.write("  shellBgOk: " + r.reload.shellBgOk + "\n");
    process.stdout.write("  inputBgOk: " + r.reload.inputBgOk + "\n");
    process.stdout.write("  btnBlueOk: " + r.reload.btnBlueOk + "\n");
    process.stdout.write("  CLS: " + r.reload.cls + "\n");
    process.stdout.write("  silverShift: " + r.reload.silverShift + "\n");
    process.stdout.write("  consoleErrorsCount: " + r.consoleErrorsCount + "\n");
    process.stdout.write("  appErrorsCount: " + r.appErrorsCount + "\n");
  }
  process.stdout.write("\nFINAL_STATUS: " + (finalPass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_SILVER_PARCEL_LAYOUT_GUARD ===\n");

  process.stdout.write("\n=== PROD_PROOF ===\n");
  if (rep) {
    process.stdout.write("consoleErrorsCount=" + rep.consoleErrorsCount + "\n");
    process.stdout.write("appErrorsCount=" + rep.appErrorsCount + "\n");
    process.stdout.write("CLS=" + rep.reload.cls + "\n");
    process.stdout.write("overflowX=" + rep.reload.overflowX + "\n");
    process.stdout.write("parcelCardVisible=" + rep.reload.parcelCardVisible + "\n");
    process.stdout.write("inputVisible=" + rep.reload.inputVisible + "\n");
    process.stdout.write("buttonVisible=" + rep.reload.buttonVisible + "\n");
    process.stdout.write(
      "silverStableAfterReload=" +
        (rep.reload.silverShift <= SILVER_SHIFT_CAP && rep.reload.cls <= CLS_CAP) +
        "\n",
    );
  }
  process.stdout.write("=== END_PROD_PROOF ===\n");

  if (!finalPass) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
