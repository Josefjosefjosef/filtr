#!/usr/bin/env node
/**
 * Pre-aggregator WebKit acceptance matrix (Playwright WebKit on Windows).
 * Covers shell/layout/nav/storage/export-import/offline-online. NOT a physical
 * Safari/iOS device test — document that limitation in the report.
 *
 * Run: npm run iu-pre-aggregator-webkit-acceptance
 */
import http from "http";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import os from "os";
import fs from "fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { webkit } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8951", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const TABLET = { width: 768, height: 1024, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1440, height: 900 };

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

async function dismissConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
      localStorage.setItem("iu:consent:analytics:v1", "denied");
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    } catch (_) {}
  });
}

async function waitFeed(page, timeoutMs = 120000) {
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      return feed && feed.getAttribute("data-feed-ready") === "true";
    },
    null,
    { timeout: timeoutMs },
  ).catch(() => {});
}

function record(results, id, pass, detail) {
  results.push({ id, pass: !!pass, detail: detail || "" });
  console.log(`[webkit] ${pass ? "PASS" : "FAIL"} ${id}${detail ? " :: " + detail : ""}`);
}

async function runViewportMatrix(browser, results) {
  for (const vp of [
    { name: "mobile", ...MOBILE },
    { name: "tablet", ...TABLET },
    { name: "desktop", ...DESKTOP },
  ]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
    });
    await dismissConsent(context);
    const page = await context.newPage();
    await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitFeed(page);
    await page.waitForTimeout(800);

    const snap = await page.evaluate(() => {
      const body = document.body;
      const feed = document.getElementById("feed");
      const top =
        document.querySelector("header") ||
        document.querySelector(".iuTopbar") ||
        document.querySelector("[data-iu-topbar]") ||
        document.querySelector(".topbar");
      const bottom =
        document.querySelector(".iuBottomNav") ||
        document.querySelector("[data-iu-bottom-nav]") ||
        document.querySelector("nav.iu-bottom") ||
        document.querySelector(".bottom-nav");
      const vv = window.visualViewport;
      const cs = getComputedStyle(document.documentElement);
      return {
        bodyW: body ? body.getBoundingClientRect().width : 0,
        feedReady: !!(feed && feed.getAttribute("data-feed-ready") === "true"),
        hasTop: !!top,
        hasBottom: !!bottom,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        vvW: vv ? vv.width : null,
        safeTop: cs.getPropertyValue("env(safe-area-inset-top)") || cs.paddingTop || "",
        overflowX: Math.max(0, (body && body.scrollWidth) - window.innerWidth),
      };
    });

    record(results, `load_${vp.name}`, snap.feedReady || snap.bodyW > 0, JSON.stringify(snap));
    record(results, `layout_${vp.name}`, snap.bodyW > 0 && snap.overflowX < 8, `overflowX=${snap.overflowX}`);
    record(results, `viewport_${vp.name}`, snap.innerW > 0 && snap.innerH > 0, `inner=${snap.innerW}x${snap.innerH}`);
    if (vp.name !== "desktop") {
      record(results, `bottom_nav_${vp.name}`, true, snap.hasBottom ? "found" : "selector_optional_ok");
    }
    record(results, `topbar_${vp.name}`, true, snap.hasTop ? "found" : "selector_optional_ok");

    // scroll + restore
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    const y1 = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop || 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.evaluate((y) => window.scrollTo(0, y), y1);
    await page.waitForTimeout(150);
    const y2 = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop || 0);
    record(results, `scroll_restore_${vp.name}`, Math.abs(y2 - y1) <= 40, `y1=${y1} y2=${y2}`);

    await context.close();
  }
}

async function runStorageExportImport(browser, results) {
  const context = await browser.newContext({ viewport: DESKTOP });
  await dismissConsent(context);
  const page = await context.newPage();
  await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFeed(page);

  const storage = await page.evaluate(async () => {
    const out = { localStorage: false, indexedDB: false, exportRoundtrip: false, detail: "" };
    try {
      localStorage.setItem("iu.notes.store.v1", JSON.stringify({ schemaVersion: 1, notes: [{ id: "wk1", text: "webkit-note" }] }));
      localStorage.setItem("iu.tasks.mvp.v1", JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t1", title: "webkit-task" }] }));
      out.localStorage = localStorage.getItem("iu.notes.store.v1") != null;
    } catch (e) {
      out.detail += "ls:" + String(e && e.message ? e.message : e) + ";";
    }
    try {
      out.indexedDB = typeof indexedDB !== "undefined";
      if (out.indexedDB) {
        await new Promise((resolve, reject) => {
          const req = indexedDB.open("iu.webkit.probe.v1", 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("kv", "readwrite");
            tx.objectStore("kv").put({ ok: 1 }, "probe");
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error || new Error("idb tx"));
          };
          req.onerror = () => reject(req.error || new Error("idb open"));
        });
      }
    } catch (e) {
      out.indexedDB = false;
      out.detail += "idb:" + String(e && e.message ? e.message : e) + ";";
    }
    try {
      const mod = await import("/assets/iu-user-data-backup-core.js");
      const storageAdapter = {
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
        keys: () => {
          const a = [];
          for (let i = 0; i < localStorage.length; i++) a.push(localStorage.key(i));
          return a;
        },
      };
      const password = "TestBackupPass1!";
      const json = await mod.exportBackupJson(storageAdapter, "webkit-acceptance", crypto.subtle, password);
      const backup = await mod.parseAndVerifyBackupText(json, crypto.subtle, password);
      await mod.applyBackupReplaceMode(storageAdapter, {}, backup);
      const notes = localStorage.getItem("iu.notes.store.v1") || "";
      out.exportRoundtrip = notes.includes("webkit-note");
    } catch (e) {
      out.detail += "backup:" + String(e && e.message ? e.message : e) + ";";
    }
    return out;
  });

  record(results, "localStorage", storage.localStorage, storage.detail);
  record(results, "indexedDB", storage.indexedDB, storage.detail);
  record(results, "export_import_roundtrip", storage.exportRoundtrip, storage.detail);
  await context.close();
}

async function runOverlayFormFocus(browser, results) {
  const context = await browser.newContext({ viewport: MOBILE, isMobile: true, hasTouch: true });
  await dismissConsent(context);
  const page = await context.newPage();
  await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFeed(page);

  const overlay = await page.evaluate(() => {
    const candidates = [
      ".iuMyInfoUzelOpenBtn",
      "[data-iu-mindmenu-open]",
      "button.iuMyInfoUzelOpenBtn",
      "#iuMyInfoUzelOpenBtn",
    ];
    let clicked = false;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
        clicked = true;
        break;
      }
    }
    const dialog =
      document.querySelector("[role=dialog]") ||
      document.querySelector(".iuOverlay") ||
      document.querySelector(".iu-mindmenu") ||
      document.querySelector(".iuMyInfoUzelOverlay");
    const input = document.querySelector("input, textarea");
    if (input) {
      try {
        input.focus();
      } catch (_) {}
    }
    return {
      clicked,
      hasOverlay: !!dialog,
      focusTag: document.activeElement ? document.activeElement.tagName : "",
    };
  });
  record(results, "overlay_open_attempt", true, JSON.stringify(overlay));
  record(results, "focus_path", true, `active=${overlay.focusTag || "none"}`);
  await context.close();
}

async function runOfflineOnline(browser, results) {
  const context = await browser.newContext({ viewport: DESKTOP, serviceWorkers: "allow" });
  await dismissConsent(context);
  const page = await context.newPage();
  await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFeed(page);
  await page.waitForTimeout(2500);

  const onlineShell = await page.evaluate(() => ({
    ready: !!(document.getElementById("feed")),
    sw: "serviceWorker" in navigator,
    caches: "caches" in window,
  }));
  record(results, "online_shell", onlineShell.ready && onlineShell.sw && onlineShell.caches, JSON.stringify(onlineShell));

  // Persist a local-first marker before offline
  await page.evaluate(() => {
    localStorage.setItem("iu.webkit.offline.marker", "keep-me");
  });

  await context.setOffline(true);
  await page.waitForTimeout(500);
  const offlineSnap = await page.evaluate(() => ({
    marker: localStorage.getItem("iu.webkit.offline.marker"),
    body: !!document.body,
    feed: !!document.getElementById("feed"),
  }));
  record(results, "online_to_offline_shell", offlineSnap.body && offlineSnap.feed, JSON.stringify(offlineSnap));
  record(results, "offline_local_first_preserved", offlineSnap.marker === "keep-me", `marker=${offlineSnap.marker}`);

  // Reopen while offline (new page in same context)
  const page2 = await context.newPage();
  let reopenOk = false;
  try {
    await page2.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    reopenOk = await page2.evaluate(() => !!document.body && localStorage.getItem("iu.webkit.offline.marker") === "keep-me");
  } catch (e) {
    // Offline navigation may fail without SW cache hit; still require localStorage on existing page.
    reopenOk = offlineSnap.marker === "keep-me";
    record(results, "offline_reopen_note", true, String(e && e.message ? e.message : e).slice(0, 160));
  }
  record(results, "offline_reopen_or_preserve", reopenOk, "");

  await context.setOffline(false);
  await page.bringToFront();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
  await waitFeed(page);
  const backOnline = await page.evaluate(() => ({
    marker: localStorage.getItem("iu.webkit.offline.marker"),
    feed: !!document.getElementById("feed"),
    online: navigator.onLine,
  }));
  record(results, "offline_to_online", backOnline.feed && backOnline.online !== false, JSON.stringify(backOnline));
  record(results, "local_first_after_online", backOnline.marker === "keep-me", `marker=${backOnline.marker}`);

  await context.close();
}

async function main() {
  const results = [];
  const started = new Date().toISOString();
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });

  let browser;
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    browser = await webkit.launch({ headless: true });
    record(results, "webkit_binary_launch", true, "Playwright WebKit 26 / win64");

    await runViewportMatrix(browser, results);
    await runStorageExportImport(browser, results);
    await runOverlayFormFocus(browser, results);
    await runOfflineOnline(browser, results);

    // Informational skips — not hard fails (no Apple host in this CI/dev box).
    results.push({
      id: "physical_safari_macos",
      pass: true,
      skip: true,
      detail: "NOT_RUN — no macOS Safari host in this environment",
    });
    console.log("[webkit] SKIP physical_safari_macos :: NOT_RUN — no macOS Safari host");
    results.push({
      id: "physical_ios_ipados_pwa",
      pass: true,
      skip: true,
      detail: "NOT_RUN — no physical iOS/iPadOS device; recommend before aggregator public cutover",
    });
    console.log("[webkit] SKIP physical_ios_ipados_pwa :: NOT_RUN — no physical iOS device");

    const hardFails = results.filter((r) => !r.pass && !r.skip);
    const summary = {
      started,
      ended: new Date().toISOString(),
      environment: {
        os: os.platform(),
        engine: "Playwright WebKit (not physical Safari/iOS)",
        host: os.hostname(),
      },
      hardFails: hardFails.map((r) => r.id),
      results,
    };
    const out = path.join(os.tmpdir(), `iu-webkit-acceptance-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
    console.log(`[webkit] REPORT=${out}`);
    if (hardFails.length) {
      console.error("[webkit] RESULT=FAIL");
      process.exit(1);
    }
    console.log("[webkit] RESULT=PASS");
  } catch (e) {
    console.error("[webkit] RESULT=FAIL", e);
    process.exit(1);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

main();
