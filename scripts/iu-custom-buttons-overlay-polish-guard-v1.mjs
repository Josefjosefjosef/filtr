#!/usr/bin/env node
/**
 * Guard: custom buttons overlay — empty name/url placeholders + mobile/tablet back/home close.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const INDEX = path.join(REPO, "projects", "index.html");
const APP = path.join(REPO, "assets", "app.js");
const FEED = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8901", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
  { name: "PC", width: 1280, height: 900 },
];

function staticGate() {
  const index = fs.readFileSync(INDEX, "utf8");
  const app = [
    fs.readFileSync(APP, "utf8"),
    fs.existsSync(FEED) ? fs.readFileSync(FEED, "utf8") : "",
  ].join("\n");
  const checks = [
    {
      id: "name_input_no_email_placeholder",
      pass: /id="iuCustomButtonsName"[^>]*required/.test(index) && !/id="iuCustomButtonsName"[^>]*placeholder="Nastavit e-mail"/.test(index),
    },
    {
      id: "url_input_no_email_placeholder",
      pass: /id="iuCustomButtonsUrl"[^>]*required/.test(index) && !/id="iuCustomButtonsUrl"[^>]*placeholder="Nastavit e-mail"/.test(index),
    },
    {
      id: "mailbox_email_placeholder_preserved",
      pass: app.includes('IU_MM_EDIT_INPUT_PLACEHOLDER = "Nastavit e-mail"'),
    },
    {
      id: "init_does_not_assign_email_placeholder",
      pass: !/if \(cbName\) cbName\.placeholder = mmPh/.test(app),
    },
    {
      id: "bottom_back_closes_custom_buttons",
      pass: /function closeTopMostOpenOverlayForBottomBack\(\)[\s\S]*iuCustomButtonsPanel[\s\S]*iuCustomButtonsOverlayClose/.test(app),
    },
    {
      id: "force_close_calls_custom_buttons",
      pass: /function iuForceCloseAllOverlays\(\)[\s\S]*iuCustomButtonsOverlayClose/.test(app),
    },
    {
      id: "force_close_removes_body_class",
      pass: /function iuForceCloseAllOverlays\(\)[\s\S]*iu-custom-buttons-overlay-open/.test(app),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
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

async function openCustomButtonsOverlay(page) {
  await page.evaluate(() => {
    const tab = document.getElementById("iuMobileGateTabTools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!tab) return;
    if (panel && !panel.hidden) return;
    tab.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('[data-iu-action="custom-buttons"]')?.click());
  await page.waitForTimeout(800);
}

async function readOverlayState(page) {
  return page.evaluate(() => {
    const name = document.getElementById("iuCustomButtonsName");
    const url = document.getElementById("iuCustomButtonsUrl");
    const panel = document.getElementById("iuCustomButtonsPanel");
    const backdrop = document.getElementById("iuCustomButtonsBackdrop");
    return {
      namePlaceholder: name ? name.getAttribute("placeholder") || "" : null,
      urlPlaceholder: url ? url.getAttribute("placeholder") || "" : null,
      panelOpen: !!(panel && !panel.hidden && panel.dataset.open === "1"),
      backdropOpen: !!(backdrop && !backdrop.hidden),
      bodyClass: document.body.classList.contains("iu-custom-buttons-overlay-open"),
    };
  });
}

async function runViewport(browser, vp) {
  const isMobileTablet = vp.name === "MOBILE" || vp.name === "TABLET";
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: isMobileTablet,
    hasTouch: isMobileTablet,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(1500);

  if (isMobileTablet) {
    await openCustomButtonsOverlay(page);
  } else {
    await page.evaluate(async () => {
      if (typeof window.iuCustomButtonsOverlayOpen === "function") window.iuCustomButtonsOverlayOpen();
    });
    await page.waitForTimeout(800);
  }

  const openState = await readOverlayState(page);
  const placeholdersOk =
    openState.panelOpen &&
    (openState.namePlaceholder === "" || openState.namePlaceholder === null) &&
    (openState.urlPlaceholder === "" || openState.urlPlaceholder === null);

  let backOk = true;
  let homeOk = true;

  if (isMobileTablet) {
    /* Touch keyboard-hide may conceal #iuMobileBottomNav while an overlay input is focused. */
    await page.evaluate(() => {
      try {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function") ae.blur();
      } catch (_) {}
      try {
        document.documentElement.classList.remove("iu-keyboard-open");
        if (document.body) document.body.classList.remove("iu-keyboard-open");
      } catch (_) {}
    });
    await page.waitForTimeout(220);
    await page.waitForSelector('#iuMobileBottomNav[class*="iu-mobileBottomNav"]', { state: "visible", timeout: 5000 });
    await page.click('[data-iu-bottom-nav="back"]');
    await page.waitForTimeout(500);
    const afterBack = await readOverlayState(page);
    backOk = !afterBack.panelOpen && !afterBack.backdropOpen && !afterBack.bodyClass;

    await openCustomButtonsOverlay(page);
    await page.evaluate(() => {
      try {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function") ae.blur();
      } catch (_) {}
      try {
        document.documentElement.classList.remove("iu-keyboard-open");
        if (document.body) document.body.classList.remove("iu-keyboard-open");
      } catch (_) {}
    });
    await page.waitForTimeout(220);
    await page.waitForSelector('#iuMobileBottomNav', { state: "visible", timeout: 5000 });
    await page.click('[data-iu-bottom-nav="home"]');
    await page.waitForTimeout(700);
    const afterHome = await readOverlayState(page);
    homeOk = !afterHome.panelOpen && !afterHome.backdropOpen && !afterHome.bodyClass;
  } else {
    await page.click("#iuCustomButtonsClose");
    await page.waitForTimeout(400);
    const afterClose = await readOverlayState(page);
    backOk = !afterClose.panelOpen && !afterClose.backdropOpen && !afterClose.bodyClass;
    homeOk = true;
  }

  await context.close();
  return {
    viewport: vp.name,
    openState,
    placeholdersOk,
    backOk,
    homeOk,
    pass: placeholdersOk && backOk && homeOk,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(fp).toLowerCase();
      const mime =
        ext === ".css" ? "text/css; charset=utf-8" :
        ext === ".js" ? "text/javascript; charset=utf-8" :
        ext === ".html" ? "text/html; charset=utf-8" :
        "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp));
  }
  await browser.close();
  server.close();

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
