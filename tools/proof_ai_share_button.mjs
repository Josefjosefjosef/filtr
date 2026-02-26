#!/usr/bin/env node
/**
 * P0: AI Share button — 3 modes (A/B/C), CLS strict 0, D1 bundle gating, CLS step attribution.
 * Gate: CLS === 0 (numerically). DIAG: step, ts, rects at each step, topEntries with movedElements.
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
  const crlf = String(text).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  fs.writeFileSync(out, crlf, "utf8");
  return out;
}

function getRepoExpectedHash() {
  try {
    const html = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
    const m = html.match(/src="([^"]*app\.js[^"]*)"/);
    if (!m) return null;
    const src = m[1];
    const v = src.match(/[?&]v=([^&]+)/) || src.match(/app\.([a-f0-9]+)\.js/);
    return v ? v[1] : null;
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
  await page.evaluate(() => { window.__iuClsStep = "after_ai_open"; });
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
}

async function runTestA(page, baseUrl) {
  await page.addInitScript(() => {
    window.__sharePayload = null;
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuClsStep = "init";
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 10) window.__proofClsEntries.push({
            value: e.value,
            hadRecentInput: e.hadRecentInput,
            step: window.__iuClsStep,
            ts: performance.now(),
            sources: e.sources,
          });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => { window.__iuClsStep = "after_goto"; });
  await page.waitForTimeout(2000);
  const rectsAfterGoto = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  await openAiCardAndWait(page);
  const rectsAfterAiOpen = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  await page.evaluate(() => { window.__iuClsStep = "after_share_click"; });
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  const count = await shareBtn.count();
  const payload = await page.evaluate(async () => {
    window.__sharePayload = null;
    window.__iuShareTestOverride = async (opts) => { window.__sharePayload = opts; };
    if (typeof window.__onShareAiTab === "function") await window.__onShareAiTab();
    return window.__sharePayload || null;
  });
  const bundleInfo = await page.evaluate(() => {
    const script = document.querySelector('script[src*="app.js"]');
    const src = script ? script.getAttribute("src") || "" : "";
    const v = src.match(/[?&]v=([^&]+)/) || src.match(/app\.([a-f0-9]+)\.js/);
    return { bundleUrl: src, bundleHash: v ? v[1] : "" };
  }).catch(() => ({}));
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const clsEntries = await page.evaluate(() => {
    return (window.__proofClsEntries || []).slice(0, 5).map((entry) => {
      const sourcesSummary = (entry.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        return tag + id + cls;
      }).join("; ");
      const movedElements = (entry.sources || []).slice(0, 2).map((s) => ({
        previousRect: s.previousRect ? { x: s.previousRect.x, y: s.previousRect.y, width: s.previousRect.width, height: s.previousRect.height } : null,
        currentRect: s.currentRect ? { x: s.currentRect.x, y: s.currentRect.y, width: s.currentRect.width, height: s.currentRect.height } : null,
      }));
      return { value: entry.value, hadRecentInput: entry.hadRecentInput, step: entry.step || "", ts: entry.ts != null ? entry.ts : 0, sourcesSummary, movedElements };
    });
  }).catch(() => []);
  const urlOk = payload && payload.url === SHARE_URL_EXPECTED;
  return {
    pass: !!(urlOk && count === 1),
    url: payload?.url,
    cls,
    rectsAfterGoto,
    rectsAfterAiOpen,
    clsEntries,
    bundleInfo,
    shareBtnCount: count,
  };
}

async function runTestB(page, baseUrl) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuClsStep = "init";
    try {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    } catch (_) { try { navigator.share = undefined; } catch (_) {} }
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 10) window.__proofClsEntries.push({
            value: e.value, hadRecentInput: e.hadRecentInput, step: window.__iuClsStep, ts: performance.now(), sources: e.sources,
          });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => { window.__iuClsStep = "after_goto"; });
  await page.waitForTimeout(2000);
  const rectsAfterGoto = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  await openAiCardAndWait(page);
  const rectsAfterAiOpen = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  await page.evaluate(() => { window.__iuClsStep = "after_share_click"; });
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if ((await shareBtn.count()) === 0) return { pass: false, copied: null, cls: 0, rectsAfterGoto, rectsAfterAiOpen, rectsAfterShareClick: null, rectsAfterWait: null, clsEntries: [], shareBtnCount: 0 };
  const result = await page.evaluate(async () => {
    window.__copiedText = null;
    window.__iuClipboardTestCapture = (t) => { window.__copiedText = t; };
    const shareBtnEl = document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (shareBtnEl) shareBtnEl.click();
    return null;
  });
  const rectsAfterShareClick = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  await page.evaluate(() => { window.__iuClsStep = "after_wait_300ms"; });
  await page.waitForTimeout(300);
  const rectsAfterWait = await page.evaluate(() => {
    const topbarDate = document.querySelector("#iuTopbarDate, .iuTopbarDate");
    const topbarSep = document.querySelector(".iuTopbarSep");
    const quickLinks = document.querySelector("section.iu-mmQuickLinks");
    const faIcon = document.querySelector("i.fa-solid");
    return {
      topbarDate: topbarDate ? topbarDate.getBoundingClientRect() : null,
      topbarSep: topbarSep ? topbarSep.getBoundingClientRect() : null,
      quickLinks: quickLinks ? quickLinks.getBoundingClientRect() : null,
      faIconSample: faIcon ? faIcon.getBoundingClientRect() : null,
    };
  }).catch(() => ({}));
  const copied = await page.evaluate(async () => {
    const fallback = document.getElementById("iuAiShareFallback");
    const copyItem = fallback ? Array.from(fallback.querySelectorAll("button")).find((el) => /Kopírovat odkaz/.test(el.textContent || "")) : null;
    if (copyItem) copyItem.click();
    await new Promise((r) => setTimeout(r, 200));
    return window.__copiedText || null;
  });
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const clsEntries = await page.evaluate(() => {
    return (window.__proofClsEntries || []).slice(0, 5).map((entry) => {
      const sourcesSummary = (entry.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        return tag + id + cls;
      }).join("; ");
      const movedElements = (entry.sources || []).slice(0, 2).map((s) => ({
        previousRect: s.previousRect ? { x: s.previousRect.x, y: s.previousRect.y, width: s.previousRect.width, height: s.previousRect.height } : null,
        currentRect: s.currentRect ? { x: s.currentRect.x, y: s.currentRect.y, width: s.currentRect.width, height: s.currentRect.height } : null,
      }));
      return { value: entry.value, hadRecentInput: entry.hadRecentInput, step: entry.step || "", ts: entry.ts != null ? entry.ts : 0, sourcesSummary, movedElements };
    });
  }).catch(() => []);
  return {
    pass: copied === SHARE_URL_EXPECTED,
    copied,
    cls,
    rectsAfterGoto,
    rectsAfterAiOpen,
    rectsAfterShareClick,
    rectsAfterWait,
    clsEntries,
    shareBtnCount: 1,
  };
}

async function runTestC(page, baseUrl) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    window.__iuClipboardTestCapture = (t) => { window.__copiedText = t; };
    window.__proofCls = 0;
    window.__proofClsEntries = [];
    window.__iuClsStep = "init";
    const err = new Error("blocked");
    err.name = "NotAllowedError";
    const shareReject = async () => { throw err; };
    try { Object.defineProperty(navigator, "share", { value: shareReject, configurable: true, writable: true }); } catch (_) { try { navigator.share = shareReject; } catch (_) {} }
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__proofCls += e.value;
          if (window.__proofClsEntries.length < 10) window.__proofClsEntries.push({
            value: e.value, hadRecentInput: e.hadRecentInput, step: window.__iuClsStep, ts: performance.now(), sources: e.sources,
          });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => { window.__iuClsStep = "after_goto"; });
  await page.waitForTimeout(2000);
  await openAiCardAndWait(page);
  await page.evaluate(() => { window.__iuClsStep = "after_share_click"; });
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  if ((await shareBtn.count()) === 0) return { pass: false, copied: null, cls: 0, clsEntries: [], shareBtnCount: 0 };
  await page.evaluate(async () => {
    const shareBtnEl = document.querySelector("#iuQuickFeed .iuAiShareBtn");
    if (shareBtnEl) shareBtnEl.click();
  });
  await page.evaluate(() => { window.__iuClsStep = "after_wait_300ms"; });
  await page.waitForTimeout(300);
  const copied = await page.evaluate(async () => {
    const fallback = document.getElementById("iuAiShareFallback");
    const copyItem = fallback ? Array.from(fallback.querySelectorAll("button")).find((el) => /Kopírovat odkaz/.test(el.textContent || "")) : null;
    if (copyItem) copyItem.click();
    await new Promise((r) => setTimeout(r, 200));
    return window.__copiedText || null;
  });
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const clsEntries = await page.evaluate(() => {
    return (window.__proofClsEntries || []).slice(0, 5).map((entry) => {
      const sourcesSummary = (entry.sources || []).slice(0, 3).map((s) => {
        if (!s.node) return "?";
        const tag = (s.node.tagName || "").toLowerCase();
        const id = s.node.id ? "#" + s.node.id : "";
        const cls = (s.node.className && typeof s.node.className === "string") ? "." + String(s.node.className).trim().split(/\s+/)[0] : "";
        return tag + id + cls;
      }).join("; ");
      const movedElements = (entry.sources || []).slice(0, 2).map((s) => ({
        previousRect: s.previousRect ? { x: s.previousRect.x, y: s.previousRect.y, width: s.previousRect.width, height: s.previousRect.height } : null,
        currentRect: s.currentRect ? { x: s.currentRect.x, y: s.currentRect.y, width: s.currentRect.width, height: s.currentRect.height } : null,
      }));
      return { value: entry.value, hadRecentInput: entry.hadRecentInput, step: entry.step || "", ts: entry.ts != null ? entry.ts : 0, sourcesSummary, movedElements };
    });
  }).catch(() => []);
  return {
    pass: copied === SHARE_URL_EXPECTED,
    copied,
    cls,
    clsEntries,
    shareBtnCount: 1,
  };
}

async function main() {
  let browser = null;
  let staticServer = null;
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  const consoleErrors = [];
  const pageErrors = [];
  const repoExpectedHash = getRepoExpectedHash();
  const lines = ["PROOF: AI Share button (3 modes, CLS strict 0, step attribution)"];

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

    const rectsB = resultB.rectsAfterGoto ? resultB : resultA;
    lines.push("diag_rects_after_goto=" + JSON.stringify(rectsB.rectsAfterGoto || {}));
    lines.push("diag_rects_after_ai_open=" + JSON.stringify(rectsB.rectsAfterAiOpen || {}));
    lines.push("diag_rects_after_share_click=" + JSON.stringify(resultB.rectsAfterShareClick || {}));
    lines.push("diag_rects_after_wait=" + JSON.stringify(resultB.rectsAfterWait || {}));
    lines.push("diag_bundleUrl=" + (resultA.bundleInfo?.bundleUrl || ""));
    lines.push("diag_bundleHash=" + (resultA.bundleInfo?.bundleHash || ""));

    const clsVal = (resultA.cls || 0) + (resultB.cls || 0) + (resultC.cls || 0);
    const allEntries = [...(resultA.clsEntries || []), ...(resultB.clsEntries || []), ...(resultC.clsEntries || [])];
    const topEntries = allEntries.slice(0, 5);
    lines.push("diag_cls=" + JSON.stringify({ value: clsVal, entriesCount: allEntries.length, topEntries }));

    lines.push("TestA_pass=" + (resultA.pass === true));
    lines.push("TestA_sharePayloadUrl=" + (resultA.url || ""));
    lines.push("TestB_pass=" + (resultB.pass === true));
    lines.push("TestB_copiedText=" + (resultB.copied || ""));
    lines.push("TestC_pass=" + (resultC.pass === true));
    lines.push("TestC_copiedText=" + (resultC.copied || ""));
    lines.push("diag_shareBtnCount=" + (resultA.shareBtnCount ?? 1));
    const criticalConsole = consoleErrors.filter((t) => !isNoiseConsoleError(t));
    lines.push("console.error=" + criticalConsole.length);
    lines.push("pageerror=" + pageErrors.length);
    lines.push("CLS=" + clsVal);

    const shareBtnOk = resultA.shareBtnCount === 1 && resultB.shareBtnCount === 1 && resultC.shareBtnCount === 1;
    const allPass = !!(
      resultA.pass && resultB.pass && resultC.pass &&
      clsVal === 0 &&
      shareBtnOk &&
      pageErrors.length === 0 && criticalConsole.length === 0
    );
    lines.push("allPass=" + allPass);

    const isProd = BASE_URL.includes("infouzel.cz");
    const prodBundleHash = (resultA.bundleInfo?.bundleHash || "").trim();
    const bundleMatch = !!(repoExpectedHash && prodBundleHash && String(prodBundleHash) === String(repoExpectedHash));

    if (isProd && !bundleMatch) {
      writeArtifact("PROD_PREDEPLOY_CHECK_AI_SHARE_BUTTON.txt", lines.join("\r\n"));
      console.log("Wrote PROD_PREDEPLOY_CHECK_AI_SHARE_BUTTON.txt (bundle hash mismatch)");
      console.log(lines.join("\r\n"));
      process.exitCode = 2;
      return;
    }

    const content = lines.join("\r\n");
    writeArtifact("PROOF_AI_SHARE_BUTTON.txt", content);
    if (isProd && bundleMatch) writeArtifact("AFTER_MERGE_PROOF_AI_SHARE_BUTTON_PROD.txt", content);
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
