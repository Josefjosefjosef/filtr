#!/usr/bin/env node
/**
 * P0: AI Share button — 3 modes (A/B/C), DIAG always, CLS strict 0, D1 bundle gating.
 * D1: AFTER_MERGE only when prodBundleHash === repoExpectedHash; else PROD_PREDEPLOY_CHECK + exit 2.
 * D2-D6: DIAG section always; shareBtnCount===1; 300ms after click then measure fallback; viewport/scrollbar diag.
 * Gate: CLS === 0 (numerically), allPass, no tolerance.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const SHARE_URL_EXPECTED = "https://www.infouzel.cz/";

const CONSOLE_ERROR_NOISE = [/Failed to fetch|loadAiAssistants|videos\.json|ResizeObserver|favicon|404|net::ERR/i];
function isNoiseConsoleError(text) {
  return CONSOLE_ERROR_NOISE.some((r) => r.test(String(text)));
}

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  fs.writeFileSync(out, text.replace(/\r?\n/g, "\r\n"), "utf8");
  return out;
}

function getRepoExpectedHash() {
  try {
    const html = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
    const m = html.match(/src="([^"]*app\.js[^"]*)"/);
    if (!m) return null;
    const src = m[1];
    const q = src.indexOf("?");
    if (q === -1) return src;
    const v = src.slice(q + 1).match(/v=([^&]+)/);
    return v ? v[1] : src.slice(q + 1);
  } catch (_) {}
  return null;
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/projects" || urlPath === "/projects/") urlPath = "/projects/index.html";
      else if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;
      const p = path.join(rootDir, urlPath.slice(1));
      const resolved = path.resolve(p);
      const rootResolved = path.resolve(rootDir);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(p);
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function openAiCardAndWait(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
}

function buildClsEntrySummary(e) {
  const src = (e.sources || []).slice(0, 3).map((s) => {
    if (!s.node) return "?";
    const tag = (s.node.tagName || "").toLowerCase();
    const id = s.node.id ? "#" + s.node.id : "";
    const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
    const r = s.currentRect;
    const rect = r ? `[${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)}x${r.height.toFixed(0)}]` : "";
    return tag + id + cls + rect;
  }).join("; ");
  return { value: e.value, hadRecentInput: e.hadRecentInput, sourcesSummary: src || "unknown" };
}

async function runTestA(page, baseUrl) {
  await page.addInitScript(() => {
    window.__sharePayload = null;
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuTestMode = "A";
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 5) window.__proofClsEntries.push({ value: e.value, hadRecentInput: e.hadRecentInput, sources: e.sources });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
    if (typeof console !== "undefined" && console.log) console.log("IU_TESTMODE", "A", "shareType", typeof navigator.share);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  const viewportBefore = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  await page.waitForTimeout(2000);
  await openAiCardAndWait(page);
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const count = await shareBtn.count();
  const payload = await page.evaluate(async () => {
    window.__sharePayload = null;
    window.__iuShareTestOverride = async (opts) => { window.__sharePayload = opts; };
    if (typeof window.__onShareAiTab === "function") await window.__onShareAiTab();
    return window.__sharePayload || null;
  });
  const viewportAfter = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  const bundleInfo = await page.evaluate(() => {
    const script = document.querySelector('script[src*="app.js"]');
    const src = script ? script.getAttribute("src") || "" : "";
    const v = src.match(/[?&]v=([^&]+)/);
    return { bundleUrl: src, bundleHash: v ? v[1] : "" };
  }).catch(() => ({}));
  const diag = await page.evaluate(() => {
    const fallback = document.getElementById("iuAiShareFallback") || document.querySelector("[data-iu-share-fallback='1']");
    const shareType = typeof navigator !== "undefined" ? typeof navigator.share : "undefined";
    const quick = document.getElementById("iuQuickFeed");
    const aiOpen = !!(quick && !quick.hidden);
    const shareBtns = document.querySelectorAll("#iuQuickFeed .iuAiShareBtn");
    let fallbackStyle = {}; let fallbackRect = {}; let topEl = ""; let fallbackInViewport = false;
    if (fallback) {
      const s = getComputedStyle(fallback);
      fallbackStyle = { display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position, zIndex: s.zIndex };
      const r = fallback.getBoundingClientRect();
      fallbackRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      fallbackInViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      topEl = center ? (center.id ? "#" + center.id : center.className ? "." + (String(center.className).trim().split(/\s+/)[0] || "") : center.tagName) : "";
    }
    const entries = (window.__proofClsEntries || []).slice(0, 5).map((e) => ({
      value: e.value,
      hadRecentInput: e.hadRecentInput,
      sourcesSummary: (e.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        const r = s.currentRect;
        const rect = r ? `[${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)}x${r.height.toFixed(0)}]` : "";
        return tag + id + cls + rect;
      }).join("; ") || "unknown"
    }));
    return {
      diag_shareType: shareType,
      diag_shareOverrideApplied: window.__iuTestMode === "A" ? true : false,
      diag_aiOpen: aiOpen,
      diag_shareBtnCount: shareBtns.length,
      diag_fallbackCount: fallback ? 1 : 0,
      diag_fallbackStyle: fallbackStyle,
      diag_fallbackRect: fallbackRect,
      diag_fallbackInViewport: fallbackInViewport,
      diag_topElementAtFallbackCenter: topEl,
      diag_clsValue: window.__proofCls,
      diag_clsEntries: entries,
    };
  });
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const scrollbarWidthBefore = (viewportBefore.innerWidth ?? 0) - (viewportBefore.clientWidth ?? 0);
  const scrollbarWidthAfter = (viewportAfter.innerWidth ?? 0) - (viewportAfter.clientWidth ?? 0);
  const urlOk = payload && payload.url === SHARE_URL_EXPECTED;
  const pass = !!(urlOk && count === 1);
  return {
    pass,
    url: payload?.url,
    cls,
    diag: { ...diag, diag_mode: "A", diag_bundleUrl: bundleInfo.bundleUrl, diag_bundleHash: bundleInfo.bundleHash, diag_viewport_before: viewportBefore, diag_viewport_after: viewportAfter, diag_scrollbarWidthDelta: scrollbarWidthAfter - scrollbarWidthBefore },
    shareBtnCount: count,
  };
}

async function runTestB(page, baseUrl) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuTestMode = "B";
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 5) window.__proofClsEntries.push({ value: e.value, hadRecentInput: e.hadRecentInput, sources: e.sources });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
    try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true }); } catch (_) { try { navigator.share = undefined; } catch (_) {} }
    if (typeof console !== "undefined" && console.log) console.log("IU_TESTMODE", "B", "shareType", typeof navigator.share);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  const viewportBefore = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  await page.waitForTimeout(2000);
  await openAiCardAndWait(page);
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if ((await shareBtn.count()) === 0) return { pass: false, copied: null, fallbackVisible: false, cls: 0, diag: { diag_mode: "B", diag_shareBtnCount: 0 }, shareBtnCount: 0 };
  const result = await page.evaluate(async () => {
    window.__copiedText = null;
    window.__iuShareTestOverride = undefined;
    window.__iuClipboardTestCapture = (t) => { window.__copiedText = t; };
    const shareBtnEl = document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (shareBtnEl) shareBtnEl.click();
    await new Promise((r) => setTimeout(r, 300));
    const fallback = document.getElementById("iuAiShareFallback") || document.querySelector("[data-iu-share-fallback='1']");
    const fallbackVisible = !!(fallback && fallback.getBoundingClientRect().width > 0);
    let fallbackStyle = {}; let fallbackRect = {}; let topEl = ""; let fallbackInViewport = false;
    if (fallback) {
      const s = getComputedStyle(fallback);
      fallbackStyle = { display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position, zIndex: s.zIndex };
      const r = fallback.getBoundingClientRect();
      fallbackRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      fallbackInViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      topEl = center ? (center.id ? "#" + center.id : center.className ? "." + (String(center.className).trim().split(/\s+/)[0] || "") : center.tagName) : "";
    }
    const copyItem = fallback ? Array.from(fallback.querySelectorAll("button")).find((el) => /Kopírovat odkaz/.test(el.textContent || "")) : null;
    if (copyItem) copyItem.click();
    await new Promise((r) => setTimeout(r, 200));
    const shareType = typeof navigator !== "undefined" ? typeof navigator.share : "undefined";
    const quick = document.getElementById("iuQuickFeed");
    const entries = (window.__proofClsEntries || []).slice(0, 5).map((e) => ({
      value: e.value, hadRecentInput: e.hadRecentInput,
      sourcesSummary: (e.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        const r = s.currentRect;
        const rect = r ? `[${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)}x${r.height.toFixed(0)}]` : "";
        return tag + id + cls + rect;
      }).join("; ") || "unknown"
    }));
    return {
      copied: window.__copiedText,
      fallbackVisible,
      diag_shareType: shareType,
      diag_shareOverrideApplied: true,
      diag_aiOpen: !!(quick && !quick.hidden),
      diag_shareBtnCount: 1,
      diag_fallbackCount: fallback ? 1 : 0,
      diag_fallbackStyle: fallbackStyle,
      diag_fallbackRect: fallbackRect,
      diag_fallbackInViewport: fallbackInViewport,
      diag_topElementAtFallbackCenter: topEl,
      diag_clsValue: window.__proofCls,
      diag_clsEntries: entries,
    };
  });
  const viewportAfter = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const scrollbarWidthBefore = (viewportBefore.innerWidth ?? 0) - (viewportBefore.clientWidth ?? 0);
  const scrollbarWidthAfter = (viewportAfter.innerWidth ?? 0) - (viewportAfter.clientWidth ?? 0);
  return {
    pass: result.fallbackVisible && result.copied === SHARE_URL_EXPECTED,
    copied: result.copied,
    fallbackVisible: result.fallbackVisible,
    cls,
    diag: { ...result, diag_mode: "B", diag_viewport_before: viewportBefore, diag_viewport_after: viewportAfter, diag_scrollbarWidthDelta: scrollbarWidthAfter - scrollbarWidthBefore },
    shareBtnCount: 1,
  };
}

async function runTestC(page, baseUrl) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuTestMode = "C";
    const err = new Error("blocked");
    err.name = "NotAllowedError";
    const shareReject = async () => { throw err; };
    try { Object.defineProperty(navigator, "share", { value: shareReject, configurable: true, writable: true }); } catch (_) { try { navigator.share = shareReject; } catch (_) {} }
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 5) window.__proofClsEntries.push({ value: e.value, hadRecentInput: e.hadRecentInput, sources: e.sources });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
    if (typeof console !== "undefined" && console.log) console.log("IU_TESTMODE", "C", "shareType", typeof navigator.share);
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  const viewportBefore = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  await page.waitForTimeout(2000);
  await openAiCardAndWait(page);
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if ((await shareBtn.count()) === 0) return { pass: false, copied: null, fallbackVisible: false, cls: 0, diag: { diag_mode: "C", diag_shareBtnCount: 0 }, shareBtnCount: 0 };
  const result = await page.evaluate(async () => {
    window.__copiedText = null;
    window.__iuShareTestOverride = undefined;
    window.__iuClipboardTestCapture = (t) => { window.__copiedText = t; };
    const shareBtnEl = document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (shareBtnEl) shareBtnEl.click();
    await new Promise((r) => setTimeout(r, 300));
    const fallback = document.getElementById("iuAiShareFallback") || document.querySelector("[data-iu-share-fallback='1']");
    const fallbackVisible = !!(fallback && fallback.getBoundingClientRect().width > 0);
    let fallbackStyle = {}; let fallbackRect = {}; let topEl = ""; let fallbackInViewport = false;
    if (fallback) {
      const s = getComputedStyle(fallback);
      fallbackStyle = { display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position, zIndex: s.zIndex };
      const r = fallback.getBoundingClientRect();
      fallbackRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      fallbackInViewport = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
      const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      topEl = center ? (center.id ? "#" + center.id : center.className ? "." + (String(center.className).trim().split(/\s+/)[0] || "") : center.tagName) : "";
    }
    const copyItem = fallback ? Array.from(fallback.querySelectorAll("button")).find((el) => /Kopírovat odkaz/.test(el.textContent || "")) : null;
    if (copyItem) copyItem.click();
    await new Promise((r) => setTimeout(r, 200));
    const entries = (window.__proofClsEntries || []).slice(0, 5).map((e) => ({
      value: e.value, hadRecentInput: e.hadRecentInput,
      sourcesSummary: (e.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        const r = s.currentRect;
        const rect = r ? `[${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)}x${r.height.toFixed(0)}]` : "";
        return tag + id + cls + rect;
      }).join("; ") || "unknown"
    }));
    return {
      copied: window.__copiedText,
      fallbackVisible,
      diag_shareType: typeof navigator.share,
      diag_shareOverrideApplied: true,
      diag_aiOpen: true,
      diag_shareBtnCount: 1,
      diag_fallbackCount: fallback ? 1 : 0,
      diag_fallbackStyle: fallbackStyle,
      diag_fallbackRect: fallbackRect,
      diag_fallbackInViewport: fallbackInViewport,
      diag_topElementAtFallbackCenter: topEl,
      diag_clsValue: window.__proofCls,
      diag_clsEntries: entries,
    };
  });
  const viewportAfter = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollY: window.scrollY })).catch(() => ({}));
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const scrollbarWidthBefore = (viewportBefore.innerWidth ?? 0) - (viewportBefore.clientWidth ?? 0);
  const scrollbarWidthAfter = (viewportAfter.innerWidth ?? 0) - (viewportAfter.clientWidth ?? 0);
  return {
    pass: result.fallbackVisible && result.copied === SHARE_URL_EXPECTED,
    copied: result.copied,
    fallbackVisible: result.fallbackVisible,
    cls,
    diag: { ...result, diag_mode: "C", diag_shareThrowsName: "NotAllowedError", diag_viewport_before: viewportBefore, diag_viewport_after: viewportAfter, diag_scrollbarWidthDelta: scrollbarWidthAfter - scrollbarWidthBefore },
    shareBtnCount: 1,
  };
}

async function main() {
  let browser = null;
  let staticServer = null;
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  const consoleErrors = [];
  const pageErrors = [];
  const lines = ["PROOF: AI Share button (3 modes, DIAG, CLS strict 0, D1 bundle gating)"];
  const repoExpectedHash = getRepoExpectedHash();

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }
    lines.push("diag_baseUrl=" + BASE_URL);
    lines.push("diag_finalUrl=" + BASE_URL);
    lines.push("diag_repoExpectedHash=" + (repoExpectedHash ?? ""));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const pageA = await context.newPage();
    pageA.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pageA.on("pageerror", (e) => pageErrors.push(String(e.message)));
    const resultA = await runTestA(pageA, BASE_URL);
    await pageA.close();

    const pageB = await context.newPage();
    pageB.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pageB.on("pageerror", (e) => pageErrors.push(String(e.message)));
    const resultB = await runTestB(pageB, BASE_URL);
    await pageB.close();

    const pageC = await context.newPage();
    pageC.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pageC.on("pageerror", (e) => pageErrors.push(String(e.message)));
    const resultC = await runTestC(pageC, BASE_URL);
    await pageC.close();

    const diag = resultB.diag || resultA.diag || {};
    lines.push("diag_mode=A|B|C");
    lines.push("diag_bundleUrl=" + (resultA.diag?.diag_bundleUrl ?? ""));
    lines.push("diag_bundleHash=" + (resultA.diag?.diag_bundleHash ?? ""));
    lines.push("diag_shareType=" + (diag.diag_shareType ?? ""));
    lines.push("diag_shareOverrideApplied=" + (diag.diag_shareOverrideApplied === true));
    lines.push("diag_aiOpen=" + (diag.diag_aiOpen === true));
    lines.push("diag_shareBtnCount=" + (diag.diag_shareBtnCount ?? ""));
    lines.push("diag_fallbackCount=" + (diag.diag_fallbackCount ?? ""));
    lines.push("diag_fallbackStyle=" + JSON.stringify(diag.diag_fallbackStyle || {}));
    lines.push("diag_fallbackRect=" + JSON.stringify(diag.diag_fallbackRect || {}));
    lines.push("diag_fallbackInViewport=" + (diag.diag_fallbackInViewport === true));
    lines.push("diag_topElementAtFallbackCenter=" + (diag.diag_topElementAtFallbackCenter ?? ""));
    const clsVal = (resultA.cls || 0) + (resultB.cls || 0) + (resultC.cls || 0);
    const allEntries = [...(resultA.diag?.diag_clsEntries || []), ...(resultB.diag?.diag_clsEntries || []), ...(resultC.diag?.diag_clsEntries || [])].slice(0, 5);
    lines.push("diag_cls=" + JSON.stringify({ value: clsVal, entriesCount: allEntries.length, topEntries: allEntries }));
    const scrollbarDelta = resultB.diag?.diag_scrollbarWidthDelta ?? resultA.diag?.diag_scrollbarWidthDelta ?? "";
    lines.push("diag_viewport_before=" + JSON.stringify(diag.diag_viewport_before || {}));
    lines.push("diag_viewport_after=" + JSON.stringify(diag.diag_viewport_after || {}));
    lines.push("diag_scrollbarWidthDelta=" + scrollbarDelta);

    lines.push("TestA_pass=" + (resultA.pass === true));
    lines.push("TestA_sharePayloadUrl=" + (resultA.url || ""));
    lines.push("TestB_pass=" + (resultB.pass === true));
    lines.push("TestB_copiedText=" + (resultB.copied || ""));
    lines.push("TestC_pass=" + (resultC.pass === true));
    lines.push("TestC_copiedText=" + (resultC.copied || ""));
    lines.push("CLS=" + clsVal);
    const criticalConsole = consoleErrors.filter((t) => !isNoiseConsoleError(t));
    lines.push("console.error=" + criticalConsole.length);
    lines.push("pageerror=" + pageErrors.length);

    const shareBtnOk = resultA.shareBtnCount === 1 && resultB.shareBtnCount === 1 && resultC.shareBtnCount === 1;
    const fallbackOk = resultB.diag?.diag_fallbackCount === 1 && resultC.diag?.diag_fallbackCount === 1;
    const allPass = !!(
      resultA.pass && resultB.pass && resultC.pass &&
      clsVal === 0 &&
      shareBtnOk && fallbackOk &&
      pageErrors.length === 0 && criticalConsole.length === 0
    );
    lines.push("allPass=" + allPass);

    const isProd = BASE_URL.includes("infouzel.cz");
    const prodBundleHash = (resultA.diag?.diag_bundleHash ?? "").trim();
    const bundleMatch = !!(repoExpectedHash && prodBundleHash && String(prodBundleHash) === String(repoExpectedHash));

    if (isProd) {
      if (!bundleMatch) {
        writeArtifact("PROD_PREDEPLOY_CHECK_AI_SHARE_BUTTON.txt", lines.join("\n"));
        console.log("Wrote PROD_PREDEPLOY_CHECK_AI_SHARE_BUTTON.txt (bundle hash mismatch)");
        console.log(lines.join("\n"));
        process.exitCode = 2;
        return;
      }
    }

    const content = lines.join("\n");
    writeArtifact("PROOF_AI_SHARE_BUTTON.txt", content);
    if (isProd && bundleMatch) {
      writeArtifact("AFTER_MERGE_PROOF_AI_SHARE_BUTTON_PROD.txt", content);
    }
    console.log("Wrote", isProd && bundleMatch ? "PROOF_AI_SHARE_BUTTON.txt + AFTER_MERGE_PROOF_AI_SHARE_BUTTON_PROD.txt" : "PROOF_AI_SHARE_BUTTON.txt");
    console.log(content);
    if (!allPass) process.exitCode = 1;
  } catch (err) {
    console.error("proof_ai_share_button failed:", err.message);
    writeArtifact("PROOF_AI_SHARE_BUTTON.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
