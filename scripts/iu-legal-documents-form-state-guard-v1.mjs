#!/usr/bin/env node
/**
 * Vzory smluv a plné moci — guard: readFormState nesmí nechat skryté party panely přepsat vyplněné údaje.
 * Playwright: vyplní všechna viditelná pole u každého dokumentu, ověří náhled + PDF obsah.
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { IU_LEGAL_DOCUMENTS } from "../assets/iu-legal-documents-registry.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const MODULE = path.join(REPO, "assets", "iu-legal-documents-module.js");
const APP = path.join(REPO, "assets", "app.js");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CACHE_BUST = "legal-docs-form-state-hidden-panel-v1-20260713";
const LEGAL_CONFIRM_KEY = "iu:legal-confirm:contracts:v1";

function staticGate() {
  const moduleJs = fs.readFileSync(MODULE, "utf8");
  const appJs = fs.readFileSync(APP, "utf8");
  const checks = [
    {
      id: "read_form_state_skips_hidden_party_panels",
      pass:
        /function readFormState\(root, doc\)[\s\S]*closest\("\[data-iu-legal-pg\]"\)/.test(moduleJs) &&
        /partyFields && partyFields\.hidden\)\s*return/.test(moduleJs),
    },
    {
      id: "app_cache_bust",
      pass: appJs.includes(`iu-legal-documents-module.js?v=${CACHE_BUST}`),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails };
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

async function openHub(page) {
  await bootLegal(page);
  await page.evaluate(() => {
    if (typeof window.iuLegalDocsOpenSurface === "function") {
      window.iuLegalDocsOpenSurface();
    }
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuLegalDocsPanel");
      return panel && !panel.hasAttribute("hidden") && panel.classList.contains("iu-legal-overlay-panel--hub");
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(200);
}

async function openDocument(page, doc) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await openHub(page);
      const cat = page.locator(`[data-iu-legal-cat="${doc.category}"]`);
      await cat.waitFor({ state: "visible", timeout: 30000 });
      await cat.click();
      await page.waitForFunction(
        () => {
          const panel = document.getElementById("iuLegalDocsPanel");
          return panel && panel.classList.contains("iu-legal-overlay-panel--category");
        },
        null,
        { timeout: 30000 },
      );
      const openDoc = page.locator(`[data-iu-legal-open-doc="${doc.id}"]`);
      await openDoc.waitFor({ state: "visible", timeout: 30000 });
      await openDoc.click();
      await page.waitForFunction(
        () => document.querySelector("[data-iu-legal-detail-root]") != null,
        null,
        { timeout: 30000 },
      );
      await page.waitForTimeout(250);
      return;
    } catch (err) {
      lastErr = err;
      await gotoProjectsStable(page).catch(() => {});
    }
  }
  throw lastErr || new Error(`openDocument failed: ${doc.id}`);
}

async function fillVisibleFields(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-iu-legal-detail-root]");
    if (!root) return { filled: [], error: "detail_root_missing" };
    const filled = [];
    root.querySelectorAll("[data-iu-legal-path]").forEach((el) => {
      const partyFields = el.closest("[data-iu-legal-pg]");
      if (partyFields && partyFields.hidden) return;
      if (el.tagName === "SELECT") return;
      const path = el.getAttribute("data-iu-legal-path") || "";
      if (!path) return;
      const val = `IUFS_${path.replace(/\./g, "_")}`;
      el.value = val;
      filled.push(val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return { filled, error: null };
  });
}

async function waitForPreviewMarkers(page, marker) {
  await page.waitForFunction(
    (m) => {
      const ta = document.querySelector("[data-iu-legal-preview-text]");
      return ta && String(ta.value || "").includes(m);
    },
    marker,
    { timeout: 8000 },
  );
}

async function readPreviewHtml(page, markers) {
  return page.evaluate(async (needles) => {
    const ta = document.querySelector("[data-iu-legal-preview-text]");
    const preview = String((ta && ta.value) || "");
    const missingPreview = needles.filter((n) => !preview.includes(n));
    let html = "";
    try {
      const mod = await import("/assets/iu-legal-documents-pdf-renderer.js");
      const titleEl = document.getElementById("iuLegalDocsTitle");
      const title = titleEl ? String(titleEl.textContent || "").trim() : "Test";
      html = mod.buildLegalDocumentPreviewHtml(title, preview);
    } catch (err) {
      return {
        preview,
        missingPreview,
        html: "",
        htmlError: String(err && err.message ? err.message : err),
      };
    }
    const missingHtml = needles.filter((n) => !html.includes(n));
    return { preview, missingPreview, html, missingHtml, htmlError: null };
  }, markers);
}

async function readPdfExport(page) {
  return page.evaluate(async () => {
    const ta = document.querySelector("[data-iu-legal-preview-text]");
    const preview = String((ta && ta.value) || "");
    try {
      const mod = await import("/assets/iu-legal-documents-pdf-renderer.js");
      const titleEl = document.getElementById("iuLegalDocsTitle");
      const title = titleEl ? String(titleEl.textContent || "").trim() : "Test";
      const filled = await mod.exportLegalDocumentPdfBlob(title, preview);
      const empty = await mod.exportLegalDocumentPdfBlob(title, "Prázdný test");
      const pdfSize = filled.blob ? filled.blob.size : 0;
      const pdfEmptySize = empty.blob ? empty.blob.size : 0;
      const pdfOk = pdfSize > 800 && pdfSize > pdfEmptySize + 200;
      return { pdfOk, pdfSize, pdfEmptySize, pdfError: null };
    } catch (err) {
      return {
        pdfOk: false,
        pdfSize: 0,
        pdfEmptySize: 0,
        pdfError: String(err && err.message ? err.message : err),
      };
    }
  });
}

/** Tolerate SPA/hash redirects that interrupt the initial goto (Playwright race). */
async function gotoProjectsStable(page) {
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (!msg.includes("interrupted by another navigation")) throw err;
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
  }
  if (!String(page.url() || "").includes("/projects")) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  }
}

async function testDocument(page, doc) {
  const fails = [];
  await gotoProjectsStable(page);
  await openDocument(page, doc);

  const fill = await fillVisibleFields(page);
  if (fill.error) {
    fails.push(`${doc.id}: ${fill.error}`);
    return fails;
  }
  if (!fill.filled.length) {
    fails.push(`${doc.id}: no visible fields filled`);
    return fails;
  }

  const leadMarker = fill.filled[0];
  try {
    await waitForPreviewMarkers(page, leadMarker);
  } catch (_) {
    fails.push(`${doc.id}: preview textarea did not update with ${leadMarker}`);
    return fails;
  }

  const subset = fill.filled.slice(0, Math.min(fill.filled.length, 12));
  const previewResult = await readPreviewHtml(page, subset);
  for (const m of previewResult.missingPreview) {
    fails.push(`${doc.id}: preview missing marker ${m}`);
  }
  if (previewResult.htmlError) {
    fails.push(`${doc.id}: preview html failed ${previewResult.htmlError}`);
  } else {
    for (const m of previewResult.missingHtml) {
      fails.push(`${doc.id}: preview html missing marker ${m}`);
    }
  }

  const pdfResult = await readPdfExport(page);
  if (pdfResult.pdfError) {
    fails.push(`${doc.id}: pdf export failed ${pdfResult.pdfError}`);
  } else if (!pdfResult.pdfOk) {
    fails.push(`${doc.id}: pdf export too small filled=${pdfResult.pdfSize} empty=${pdfResult.pdfEmptySize}`);
  }

  return fails;
}

async function testZivnostPanel(page) {
  const doc = { id: "kupni-movita", category: "smlouvy" };
  const fails = [];
  await gotoProjectsStable(page);
  await openDocument(page, doc);
  await page.selectOption('[data-iu-legal-party-type="partyA"]', "zivnost");
  await page.waitForTimeout(200);

  const marker = "IUFS_ZIV_12345678";
  await page.fill('[data-iu-legal-pg="partyA"][data-pg="zivnost"] [data-iu-legal-path="partyA.firstName"]', "Podnik");
  await page.fill('[data-iu-legal-pg="partyA"][data-pg="zivnost"] [data-iu-legal-path="partyA.lastName"]', "Test");
  await page.fill('[data-iu-legal-pg="partyA"][data-pg="zivnost"] [data-iu-legal-path="partyA.ico"]', marker);
  await page.locator('[data-iu-legal-pg="partyA"][data-pg="zivnost"] [data-iu-legal-path="partyA.ico"]').dispatchEvent("input");
  await page.locator('[data-iu-legal-pg="partyA"][data-pg="zivnost"] [data-iu-legal-path="partyA.ico"]').dispatchEvent("change");

  try {
    await waitForPreviewMarkers(page, marker);
  } catch (_) {
    fails.push(`kupni-movita/zivnost: preview missing ico ${marker}`);
    return fails;
  }

  const previewResult = await readPreviewHtml(page, [marker, "Podnik", "Test"]);
  if (previewResult.missingPreview.length) {
    fails.push(`kupni-movita/zivnost: preview missing ${previewResult.missingPreview.join(",")}`);
  }
  if (previewResult.htmlError) {
    fails.push(`kupni-movita/zivnost: preview html failed ${previewResult.htmlError}`);
  } else if (previewResult.missingHtml.length) {
    fails.push(`kupni-movita/zivnost: preview html missing ${previewResult.missingHtml.join(",")}`);
  }
  const pdfResult = await readPdfExport(page);
  if (pdfResult.pdfError) {
    fails.push(`kupni-movita/zivnost: pdf export failed ${pdfResult.pdfError}`);
  } else if (!pdfResult.pdfOk) {
    fails.push(`kupni-movita/zivnost: pdf export too small filled=${pdfResult.pdfSize} empty=${pdfResult.pdfEmptySize}`);
  }
  return fails;
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_LEGAL_DOCUMENTS_FORM_STATE_GUARD_STATIC_FAIL");
    staticResult.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_LEGAL_DOCUMENTS_FORM_STATE_GUARD_STATIC_PASS");

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript((key) => {
    try {
      localStorage.setItem(key, "accepted");
    } catch (_) {}
  }, LEGAL_CONFIRM_KEY);
  const page = await context.newPage();
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const fails = [];
  try {
    for (const doc of IU_LEGAL_DOCUMENTS) {
      try {
        fails.push(...(await testDocument(page, doc)));
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        if (/Execution context was destroyed/i.test(msg)) {
          try {
            fails.push(...(await testDocument(page, doc)));
            continue;
          } catch (err2) {
            fails.push(`${doc.id}: ${String(err2 && err2.message ? err2.message : err2)}`);
            continue;
          }
        }
        fails.push(`${doc.id}: ${msg}`);
      }
    }
    try {
      fails.push(...(await testZivnostPanel(page)));
    } catch (err) {
      fails.push(`kupni-movita/zivnost: ${String(err && err.message ? err.message : err)}`);
    }
  } catch (err) {
    fails.push(String(err && err.message ? err.message : err));
  }

  await browser.close();
  server.kill("SIGTERM");

  if (fails.length) {
    console.log("IU_LEGAL_DOCUMENTS_FORM_STATE_GUARD_FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log(JSON.stringify({ pass: true, docs: IU_LEGAL_DOCUMENTS.length, cacheBust: CACHE_BUST }));
  console.log("IU_LEGAL_DOCUMENTS_FORM_STATE_GUARD_PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
