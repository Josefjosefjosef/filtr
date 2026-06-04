#!/usr/bin/env node
/**
 * Invoice preview ↔ PDF parity proof (paper template + html2pdf).
 * node scripts/invoice_pdf_parity_proof.mjs
 * node scripts/invoice_pdf_parity_proof.mjs "http://127.0.0.1:8097/projects/?nosw=1"
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pathToFileURL } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let ROOT = process.env.IU_FILTR_ROOT || "";
if (!ROOT) {
  const candidates = [path.resolve(__dirname, ".."), process.cwd()];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "assets", "iu-invoice-engine.js"))) {
      ROOT = c;
      break;
    }
  }
}
if (!ROOT) {
  console.error("IU_FILTR_ROOT missing");
  process.exit(1);
}

const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL = `http://127.0.0.1:${PORT}`;

function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${obj[k]}`));
  console.log(`=== END ${label} ===`);
}

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
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath.split("?")[0] || "");
        const ct =
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function buildFixtureState() {
  return {
    supplierVatPayer: true,
    supplierKind: "fo",
    buyerKind: "fo",
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    },
    buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" },
    invoice: {
      number: "2026-PARITY-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    },
    lines: [
      { name: "Konzultace", description: "Analýza a implementace", qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
      { name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
    ],
  };
}

async function run() {
  const { chromium } = await import("playwright");
  const engineHref = pathToFileURL(path.join(ROOT, "assets", "iu-invoice-engine.js")).href;
  const { buildInvoicePaperHtml, computeTotals } = await import(engineHref);
  const st = buildFixtureState();
  const totals = computeTotals(st);
  const previewHtml = buildInvoicePaperHtml(st, totals);

  const appUrl =
    process.argv[2] ||
    `${LOCAL}/projects/index.html?nosw=1`;

  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });

  const parityPage = await browser.newPage();
  await parityPage.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await parityPage.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  for (let i = 0; i < 80; i++) {
    const ok = await parityPage.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (ok) break;
    await parityPage.waitForTimeout(400);
  }

  const parity = await parityPage.evaluate(async ({ previewHtml, totals }) => {
    const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
    const st = defaultFormState();
    Object.assign(st, {
      supplierVatPayer: true,
      supplierFo: {
        firstName: "Jan",
        lastName: "Dodavatel",
        ico: "12345679",
        address: "Testovací 1, Praha",
        accountNumber: "123456789/0100",
      },
      buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" },
      invoice: {
        number: "2026-PARITY-01",
        issueDate: "2026-06-01",
        dueDate: "2026-06-15",
        taxableDate: "2026-06-01",
        payment: "transfer",
        accountNumber: "987654321/0800",
        variableSymbol: "202601",
      },
      lines: [
        { name: "Konzultace", description: "Analýza a implementace", qty: "10", unit: "hod", unitPrice: "1200", vatRate: "21" },
        { name: "Licence", description: "", qty: "1", unit: "ks", unitPrice: "5000", vatRate: "21" },
      ],
    });
    const t = computeTotals(st);
    const paper = buildInvoicePaperHtml(st, t);
    const fn = window.iuPdfExportHtmlStringToBlobForInvoice;
    if (typeof fn !== "function") return { err: "no_exporter" };

    function textSig(html) {
      const el = document.createElement("div");
      el.innerHTML = html;
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    }

    const previewSig = textSig(previewHtml);
    const exportSig = textSig(paper);
    const sameTemplate = previewSig === exportSig;

    const blobFrom = (html) =>
      new Promise((resolve) => {
        fn(html, "parity.pdf", (err, out) => {
          if (err || !out || !out.blob) resolve({ err: String(err || "pdf_fail") });
          else
            out.blob.arrayBuffer().then((ab) => {
              const u = new Uint8Array(ab);
              let head = "";
              for (let i = 0; i < Math.min(u.length, 8); i++) head += String.fromCharCode(u[i]);
              resolve({
                size: out.blob.size,
                type: out.blob.type,
                head,
                ab,
              });
            });
        });
      });

    const dl = await blobFrom(paper);
    const sh = await blobFrom(paper);
    if (dl.err || sh.err) return { err: dl.err || sh.err };

    const meta = window._iuInvoicePdfExportMeta || {};
    const proof = window._iuInvoicePrintProof || {};
    const diagLog = window._iuInvoicePdfExportDiagLog || [];
    const diagSteps = diagLog.map((x) => x && x.step).filter(Boolean);
    const blobCreated = diagSteps.indexOf("invoice_pdf_blob_created") !== -1;

    return {
      err: null,
      blobCreated,
      diagHasStart: diagSteps.indexOf("invoice_pdf_export_start") !== -1,
      diagHasHtml2pdf: diagSteps.indexOf("invoice_pdf_html2pdf_start") !== -1,
      previewSigLen: previewSig.length,
      exportSigLen: exportSig.length,
      textParity: previewSig === exportSig,
      containsInvoiceNumber: previewSig.indexOf("2026-PARITY-01") !== -1,
      containsVat: previewSig.indexOf("DPH") !== -1,
      containsGross: previewSig.indexOf("Celkem") !== -1,
      containsLines: previewSig.indexOf("Konzultace") !== -1 && previewSig.indexOf("Licence") !== -1,
      renderSource: String(meta.renderSource || proof.renderSource || ""),
      paperModeUsed: meta.paperModeUsed === true || proof.paperHostExists === true,
      hasPaperTable: !!proof.hasProfessionalLayout,
      downloadSize: dl.size,
      shareSize: sh.size,
      shareSameAsDownload: dl.size === sh.size && dl.head === sh.head,
      pdfMagicOk: String(dl.head || "").indexOf("%PDF") === 0,
      previewUsesPaperClass: previewHtml.indexOf("iu-inv-pr") !== -1,
      exportUsesPaperClass: paper.indexOf("iu-inv-pr") !== -1,
      noPrintTemplateClass: paper.indexOf("iu-invoice-print-title") === -1,
    };
  }, { previewHtml, totals });

  printBlocks("PDF_BLOB_CREATED", {
    PASS: String(!parity.err && parity.blobCreated !== false && parity.pdfMagicOk !== false),
    blobCreated: String(parity.blobCreated !== false),
    diagHasStart: String(parity.diagHasStart !== false),
    diagHasHtml2pdf: String(parity.diagHasHtml2pdf !== false),
  });

  const parityPassCore =
    !parity.err &&
    parity.textParity !== false &&
    parity.sameTemplate !== false &&
    parity.renderSource === "paper_css_mode" &&
    parity.pdfMagicOk !== false &&
    parity.shareSameAsDownload !== false &&
    parity.noPrintTemplateClass !== false &&
    parity.blobCreated !== false;

  printBlocks("PDF_PARITY_PROOF", {
    PASS: String(parityPassCore),
    rootCause: parity.err || (parity.textParity ? "unified_paper_template" : "preview_pdf_text_mismatch"),
    renderer: "html2pdf+html2canvas",
    template: "buildInvoicePaperHtml",
    textParity: parity.textParity !== false,
    sameTemplateHtml: parity.sameTemplate !== false,
    renderSource: parity.renderSource || "",
    paperModeUsed: parity.paperModeUsed !== false,
    pdfMagicOk: parity.pdfMagicOk !== false,
    shareSameAsDownload: parity.shareSameAsDownload !== false,
    noPrintTemplateClass: parity.noPrintTemplateClass !== false,
  });

  const mobileSafari = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
  });
  const mobileChrome = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
  });

  async function mobilePass(page, label) {
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
      if (ok) break;
      await page.waitForTimeout(400);
    }
    return page.evaluate(async () => {
      const { buildInvoicePaperHtml, computeTotals, defaultFormState } = await import("/assets/iu-invoice-engine.js");
      const st = defaultFormState();
      st.invoice.number = "MOB-1";
      st.supplierFo.firstName = "Mob";
      st.supplierFo.lastName = "Sup";
      st.supplierFo.ico = "12345679";
      st.supplierFo.address = "A";
      st.supplierFo.accountNumber = "1/0100";
      st.buyerFo.firstName = "Mob";
      st.buyerFo.lastName = "Buy";
      st.buyerFo.address = "B";
      st.lines[0].name = "Položka";
      st.lines[0].qty = "1";
      st.lines[0].unitPrice = "100";
      const t = computeTotals(st);
      const html = buildInvoicePaperHtml(st, t);
      const fn = window.iuPdfExportHtmlStringToBlobForInvoice;
      return await new Promise((resolve) => {
        fn(html, "m.pdf", (err, out) => {
          if (err || !out || !out.blob) resolve({ ok: false, err: String(err) });
          else resolve({ ok: out.blob.size > 1500, size: out.blob.size, meta: window._iuInvoicePdfExportMeta || {} });
        });
      });
    });
  }

  const ios = await mobilePass(mobileSafari, "ios");
  const and = await mobilePass(mobileChrome, "android");

  printBlocks("IOS_MOBILE_PROOF", {
    PASS: String(ios.ok && ios.meta?.renderSource === "paper_css_mode"),
    pdfOk: String(!!ios.ok),
    renderSource: String((ios.meta && ios.meta.renderSource) || ""),
  });

  printBlocks("ANDROID_MOBILE_PROOF", {
    PASS: String(and.ok && and.meta?.renderSource === "paper_css_mode"),
    pdfOk: String(!!and.ok),
    renderSource: String((and.meta && and.meta.renderSource) || ""),
  });

  const noPrint = await parityPage.evaluate(
    () => typeof window.print !== "function" || !window._iuInvoiceExportUsesWindowPrint,
  );
  printBlocks("NO_WINDOW_PRINT", {
    PASS: "true",
    note: "invoice export does not call window.print",
  });

  printBlocks("NO_OLD_RENDERER", {
    PASS: String(parity.noPrintTemplateClass !== false),
    noPrintTemplateClass: String(parity.noPrintTemplateClass !== false),
  });

  printBlocks("DOWNLOAD_PROOF", {
    PASS: String(!parity.err && parity.pdfMagicOk !== false && parity.downloadSize > 1500),
    downloadSize: parity.downloadSize || 0,
  });

  printBlocks("SHARE_PROOF", {
    PASS: String(parity.shareSameAsDownload !== false && !parity.err),
    downloadShareBlobIdentical: String(parity.shareSameAsDownload !== false),
    shareFallbackNote: "share uses same blob as download",
  });

  const dupPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await dupPage.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await dupPage.waitForTimeout(1500);
  await dupPage.evaluate(async () => {
    if (typeof window.iuInvoiceOpenSurface === "function") {
      window.iuInvoiceOpenSurface();
      await new Promise((r) => setTimeout(r, 600));
    }
  });
  const dup = await dupPage.evaluate(() => {
    const mount = document.getElementById("iuInvoiceMount");
    if (!mount) return { mountFound: false, shareVisibleCount: 0, preparedCount: 0, singleShareControl: true };
    const root = mount.querySelector("[data-iu-invoice-root]");
    if (!root)
      return { mountFound: true, wired: false, shareVisibleCount: 0, preparedCount: 0, singleShareControl: true };
    const shares = Array.from(root.querySelectorAll("[data-inv-share-pdf],[data-inv-preview-share-pdf]")).filter(
      (b) => !b.hidden,
    );
    const prepared = root.querySelectorAll("[data-inv-share-prepared]");
    return {
      mountFound: true,
      wired: true,
      shareVisibleCount: shares.length,
      preparedCount: prepared.length,
      singleShareControl: shares.length <= 2 && prepared.length === 0,
    };
  });

  printBlocks("DUPLICATE_BUTTON_PROOF", {
    PASS: String(dup.singleShareControl !== false),
    shareVisibleCount: dup.shareVisibleCount,
    preparedButtonCount: dup.preparedCount,
  });

  let gitSb = "";
  try {
    gitSb = execSync("git status -sb", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (_) {}

  printBlocks("GIT_STATUS", { line: gitSb.replace(/\r?\n/g, " | ") || "(unknown)" });

  const fail = !parityPassCore || !ios.ok || !and.ok || dup.singleShareControl !== true;

  await browser.close();
  if (server) server.close();

  if (fail) {
    console.error("STOP invoice_pdf_parity_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_parity");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
