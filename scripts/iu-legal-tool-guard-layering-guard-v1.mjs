#!/usr/bin/env node
/**
 * Guard: mobile/tablet legal tool-guard dialog stacks above #iuMobileBottomNav (z-index 10200).
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const TOOL_GUARD = path.join(REPO, "assets", "iu-tool-guard.js");
const APP_JS = path.join(REPO, "assets", "app.js");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8946", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const MODULE_BUST = "legal-docs-tool-guard-layering-v1-20260711";
const SAMPLE_DOC = { id: "kupni-movita", category: "smlouvy" };

function staticGate() {
  const toolGuard = fs.readFileSync(TOOL_GUARD, "utf8");
  const appJs = fs.readFileSync(APP_JS, "utf8");
  const checks = [
    {
      id: "tool_guard_mobile_zindex_backdrop",
      pass: /@media \(max-width:1024px\)[\s\S]*?\.iu-tool-guard-backdrop\{z-index:10250!important/.test(toolGuard),
    },
    {
      id: "tool_guard_mobile_zindex_terms",
      pass: /@media \(max-width:1024px\)[\s\S]*?\.iu-tool-guard-termsOverlay\{z-index:10260!important/.test(toolGuard),
    },
    {
      id: "app_legal_module_cache_bust",
      pass: appJs.includes(`iu-legal-documents-module.js?v=${MODULE_BUST}`),
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

async function bootLegal(page) {
  await page.evaluate(async () => {
    if (typeof window.iuEnsureLegalDocsOverlayBoot === "function") {
      await window.iuEnsureLegalDocsOverlayBoot();
    }
    if (typeof window.iuEnsureOverlayCss === "function") {
      await window.iuEnsureOverlayCss("iu-legal-documents-overlay.css");
    }
    if (typeof window.iuToolPrivacyBoot === "function") {
      window.iuToolPrivacyBoot();
    }
  });
}

async function openDocument(page, doc) {
  await bootLegal(page);
  await page.evaluate(() => {
    if (typeof window.iuLegalDocsOpenSurface === "function") window.iuLegalDocsOpenSurface();
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuLegalDocsPanel");
      return panel && !panel.hasAttribute("hidden") && panel.classList.contains("iu-legal-overlay-panel--hub");
    },
    null,
    { timeout: 30000 },
  );
  await page.click(`[data-iu-legal-cat="${doc.category}"]`);
  await page.waitForFunction(
    () => document.getElementById("iuLegalDocsPanel")?.classList.contains("iu-legal-overlay-panel--category"),
    null,
    { timeout: 30000 },
  );
  await page.click(`[data-iu-legal-open-doc="${doc.id}"]`);
  await page.waitForFunction(
    () => document.getElementById("iuLegalDocsPanel")?.classList.contains("iu-legal-overlay-panel--detail"),
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(300);
}

async function measureLayering(page) {
  return page.evaluate(() => {
    const backdrop = document.querySelector(".iu-tool-guard-backdrop");
    const nav = document.getElementById("iuMobileBottomNav");
    const confirmBtn = backdrop?.querySelector(".iu-tool-guard-btn--primary");
    const termsLink = backdrop?.querySelector(".iu-tool-guard-dialog__termsLink");
    const cancelBtn = backdrop?.querySelector(".iu-tool-guard-btn:not(.iu-tool-guard-btn--primary)");
    if (!backdrop || !nav || !confirmBtn || !cancelBtn) {
      return { ok: false, reason: "missing_nodes" };
    }
    const bz = parseInt(getComputedStyle(backdrop).zIndex, 10) || 0;
    const nz = parseInt(getComputedStyle(nav).zIndex, 10) || 0;
    const hitTop = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      return !!(top && (el === top || el.contains(top) || backdrop.contains(top)));
    };
    return {
      ok: bz > nz && hitTop(confirmBtn) && hitTop(cancelBtn) && (!termsLink || hitTop(termsLink)),
      backdropZ: bz,
      navZ: nz,
    };
  });
}

async function runPlaywright() {
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
      const mime =
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
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
  const mobile = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await mobilePage.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await mobilePage.evaluate(() => {
    try {
      localStorage.removeItem("iu:legal-confirm:contracts:v1");
      sessionStorage.removeItem("iu:legal-confirm:contracts:v1");
    } catch (_) {}
    document.body.classList.add("iu-mobileGateOverlayOpen");
  });
  await openDocument(mobilePage, SAMPLE_DOC);
  await mobilePage.click("[data-iu-legal-preview-open]");
  await mobilePage.waitForSelector(".iu-tool-guard-backdrop", { timeout: 15000 });
  const mobileLayer = await measureLayering(mobilePage);

  const terms = await mobilePage.evaluate(() => {
    const link = document.querySelector(".iu-tool-guard-dialog__termsLink");
    if (!link) return { ok: false, reason: "terms_link_missing" };
    link.click();
    return { ok: true };
  });
  await mobilePage.waitForSelector(".iu-tool-guard-termsOverlay", { timeout: 10000 });
  const termsLayer = await mobilePage.evaluate(() => {
    const overlay = document.querySelector(".iu-tool-guard-termsOverlay");
    const nav = document.getElementById("iuMobileBottomNav");
    if (!overlay || !nav) return { ok: false, reason: "terms_nodes_missing" };
    const oz = parseInt(getComputedStyle(overlay).zIndex, 10) || 0;
    const nz = parseInt(getComputedStyle(nav).zIndex, 10) || 0;
    return { ok: oz > nz, termsZ: oz, navZ: nz };
  });

  const once = await mobilePage.evaluate(async () => {
    const backdrop = document.querySelector(".iu-tool-guard-backdrop");
    if (backdrop) {
      const close = backdrop.querySelector(".iu-tool-guard-termsPanel .iu-tool-guard-btn--primary");
      if (close) close.click();
    }
    await new Promise((r) => setTimeout(r, 200));
    const confirm = document.querySelector(".iu-tool-guard-backdrop .iu-tool-guard-btn--primary");
    if (!confirm) return { ok: false, reason: "confirm_missing" };
    confirm.click();
    await new Promise((r) => setTimeout(r, 300));
    const stored = localStorage.getItem("iu:legal-confirm:contracts:v1");
    const previewBtn = document.querySelector("[data-iu-legal-preview-open]");
    if (!previewBtn) return { ok: false, reason: "preview_btn_missing" };
    previewBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    const again = !!document.querySelector(".iu-tool-guard-backdrop");
    return { ok: stored === "accepted" && !again, stored, again };
  });

  const tablet = await bootstrapGuardContext(browser, { viewport: { width: 834, height: 1194 } });
  const tabletPage = await tablet.newPage();
  await tabletPage.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await tabletPage.waitForTimeout(1500);
  await tabletPage.evaluate(() => {
    try {
      localStorage.removeItem("iu:legal-confirm:contracts:v1");
      sessionStorage.removeItem("iu:legal-confirm:contracts:v1");
    } catch (_) {}
    document.body.classList.add("iu-mobileGateOverlayOpen", "iu-legal-docs-overlay-open");
  });
  await openDocument(tabletPage, { id: "plna-moc-zasilka", category: "plne_moci" });
  await tabletPage.click("[data-iu-legal-share-pdf]");
  await tabletPage.waitForSelector(".iu-tool-guard-backdrop", { timeout: 15000 });
  const tabletLayer = await measureLayering(tabletPage);

  await mobile.close();
  await tablet.close();
  await browser.close();
  server.close();

  const pass =
    mobileLayer.ok &&
    termsLayer.ok &&
    once.ok &&
    tabletLayer.ok;

  return {
    pass,
    mobile: mobileLayer,
    terms: termsLayer,
    once,
    tablet: tabletLayer,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_LEGAL_TOOL_GUARD_LAYERING_GUARD_FAIL");
    console.log(JSON.stringify({ phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const pw = await runPlaywright();
  const pass = !!pw.pass;
  console.log("IU_LEGAL_TOOL_GUARD_LAYERING_GUARD_" + (pass ? "PASS" : "FAIL"));
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, playwright: pw }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
