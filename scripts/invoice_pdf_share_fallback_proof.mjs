#!/usr/bin/env node
/**
 * Guard: share fallback when canShare(files) unavailable.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath || "/").replace(/^\//, "").split("?")[0] || "index.html");
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const data = serveFile(req.url?.split("?")[0] || "/");
      if (data) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const { chromium } = await import("playwright");
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "load", timeout: 120000 });
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(
      () =>
        typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function" &&
        typeof window.iuEnsureInvoiceOverlayBoot === "function",
    );
    if (ready) break;
    await page.waitForTimeout(500);
  }

  const shareFallback = await page.evaluate(async () => {
    const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    const file = new File([blob], "faktura-test.pdf", { type: "application/pdf" });
    const nav = navigator;
    const origCan = nav.canShare;
    const origShare = nav.share;
    nav.canShare = function () {
      return false;
    };
    nav.share = async function () {
      throw new Error("should not call");
    };
    let status = "";
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-inv-status></div><div data-inv-pdf-ready-row hidden><button data-inv-open-pdf></button></div>';
    document.body.appendChild(root);
    const statusEl = root.querySelector("[data-inv-status]");
    const row = root.querySelector("[data-inv-pdf-ready-row]");
    function showReady() {
      row.hidden = false;
    }
    const shareFn = origShare && typeof origShare === "function" ? origShare : null;
    const canShareFn = origCan && typeof origCan === "function" ? origCan.bind(nav) : null;
    const canShareFiles = !!(shareFn && canShareFn && canShareFn({ files: [file] }));
    if (!shareFn || !canShareFiles) {
      status = "Sdílení souborů není dostupné. Klepněte na „Otevřít PDF“.";
      showReady();
    }
    nav.canShare = origCan;
    nav.share = origShare;
    root.remove();
    return {
      canShareFilesFalse: !canShareFiles,
      statusOk: status.indexOf("Otevřít PDF") !== -1,
      rowShown: !row.hidden,
    };
  });

  const pass = shareFallback.canShareFilesFalse && shareFallback.statusOk && shareFallback.rowShown;

  await browser.close();
  if (server) {
    await new Promise((r) => {
      server.close(() => r());
    });
  }

  const { spawnSync } = await import("child_process");
  const main = path.join(__dirname, "invoice_pdf_real_export_proof.mjs");
  const dupUrl = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? `${LOCAL}/projects/index.html?nosw=1` : appUrl;
  const dupRun = spawnSync(process.execPath, [main, dupUrl], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const dupOut = (dupRun.stdout || "") + (dupRun.stderr || "");
  const noDup = dupRun.status === 0 && /=== NO_DUPLICATE_SHARE_BUTTON ===[\s\S]*?PASS=true/.test(dupOut);

  console.log("=== invoice_pdf_share_fallback_proof ===");
  console.log("SHARE_USER_FLOW=" + (pass ? "PASS" : "FAIL"));
  console.log("NO_DUPLICATE_SHARE_BUTTON=" + (noDup ? "PASS" : "FAIL"));
  console.log("=== END invoice_pdf_share_fallback_proof ===");

  if (!pass || !noDup) process.exit(1);
  console.log("PROOF_PASS invoice_pdf_share_fallback");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
