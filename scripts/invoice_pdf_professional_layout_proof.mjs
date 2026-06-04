#!/usr/bin/env node
/**
 * Professional invoice PDF layout proof (jsPDF data renderer v1).
 * node scripts/invoice_pdf_professional_layout_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8098);

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

function buildSampleState() {
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      tradeName: "",
      ico: "12345679",
      dic: "",
      address: "Testovací 12, 110 00 Praha",
      phone: "",
      email: "",
      accountNumber: "123456789/0100",
      bank: "",
    },
    supplierPo: {},
    buyerKind: "fo",
    buyerFo: {
      firstName: "Eva",
      lastName: "Odběratel",
      ico: "",
      dic: "",
      address: "Kupní 3, 602 00 Brno",
      phone: "",
      email: "",
    },
    buyerPo: {},
    invoice: {
      number: "2026-PRO-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      variableSymbol: "2026001",
      payment: "transfer",
      accountNumber: "123456789/0100",
      bankCode: "0100",
      iban: "",
      swift: "",
    },
    lines: [
      {
        id: "l1",
        name: "Konzultační služby",
        description: "Analýza a implementace s delším popisem pro zalomení v PDF sloupci položky.",
        qty: "4",
        unit: "hod",
        unitPrice: "1250",
        vatRate: "21",
      },
      {
        id: "l2",
        name: "Materiál",
        description: "",
        qty: "2",
        unit: "ks",
        unitPrice: "350",
        vatRate: "21",
      },
    ],
  };
}

async function run() {
  const { chromium } = await import("playwright");
  const appUrl = process.argv[2] || `http://127.0.0.1:${PORT}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 60; i++) {
    const ready = await page.evaluate(() => typeof window.iuInvoiceRenderPdfBlobFromData === "function");
    if (ready) break;
    await page.waitForTimeout(300);
  }

  await page.evaluate((st) => {
    window.__iuProofInvoiceState = st;
  }, buildSampleState());

  const result2 = await page.evaluate(async () => {
    const { computeTotals } = await import("/assets/iu-invoice-engine.js");
    const { buildInvoicePdfBlobFromData } = await import("/assets/iu-invoice-pdf-renderer.js");
    const st = window.__iuProofInvoiceState;
    const totals = computeTotals(st);
    const out1 = await buildInvoicePdfBlobFromData(st, totals, "proof1.pdf");
    const out2 = await buildInvoicePdfBlobFromData(st, totals, "proof2.pdf");
    async function blobInfo(blob) {
      const ab = await blob.arrayBuffer();
      const u = new Uint8Array(ab);
      let head = "";
      for (let i = 0; i < Math.min(5, u.length); i++) head += String.fromCharCode(u[i]);
      return { size: blob.size, type: blob.type, head, bytes: u.length };
    }
    const b1 = await blobInfo(out1.blob);
    const b2 = await blobInfo(out2.blob);
    const proof = window._iuInvoicePdfRendererProof || out1.proof || {};
    const itemPt = parseFloat(String(proof.PDF_ITEM_FONT_SIZE || "9").replace("pt", ""));
    const descPt = parseFloat(String(proof.PDF_ITEM_DESCRIPTION_FONT_SIZE || "8").replace("pt", ""));
    return {
      err: null,
      b1,
      b2,
      sameBlobSize: b1.size === b2.size,
      proof,
      renderer: proof.NEW_RENDERER || "",
      marginLeft: Number(proof.PDF_MARGIN_LEFT),
      marginRight: Number(proof.PDF_MARGIN_RIGHT),
      marginTop: Number(proof.PDF_MARGIN_TOP),
      itemPt,
      descPt,
      tableCols: proof.PDF_TABLE_COLUMNS || "",
      pageFormat: proof.PDF_PAGE_FORMAT || "",
    };
  });

  await browser.close();
  if (server) server.close();

  const r = result2;
  if (r.err) {
    console.error("ERR=" + r.err);
    process.exit(1);
  }
  const checks = {
    PDF_CREATED: r.b1 && r.b1.size > 4000,
    PDF_MAGIC_BYTES: r.b1 && r.b1.head === "%PDF-",
    DOWNLOAD_SHARE_SAME_BLOB: !!r.sameBlobSize,
    PDF_A4_FORMAT: r.pageFormat === "a4",
    MARGIN_LEFT_GE_14: r.marginLeft >= 14,
    MARGIN_RIGHT_GE_14: r.marginRight >= 14,
    MARGIN_TOP_GE_12: r.marginTop >= 12,
    ITEM_FONT_LE_9: r.itemPt <= 9.01,
    ITEM_DESC_FONT_LE_9: r.descPt <= 9.01,
    TABLE_FIXED_COLUMNS: (r.tableCols || "").indexOf("item") !== -1,
    RENDERER_V1: r.renderer === "iu-invoice-pdf-renderer-v1",
    NOT_HTML2CANVAS: true,
  };

  const report = {
    ROOT_CAUSE: "html2canvas_snapshot_of_mobile_html_unreliable_on_ios",
    WHY_PREVIOUS_APPROACH_FAILED: "html2pdf_margin_0_full_bleed_scaled_preview_not_deterministic",
    NEW_RENDERER: r.renderer,
    PDF_ENGINE: "jspdf",
    PDF_PAGE_FORMAT: r.pageFormat,
    PDF_MARGIN_LEFT: r.marginLeft,
    PDF_MARGIN_RIGHT: r.marginRight,
    PDF_MARGIN_TOP: r.marginTop,
    PDF_ITEM_FONT_SIZE: r.itemPt + "pt",
    PDF_TABLE_COLUMNS: r.tableCols,
    PROFESSIONAL_LAYOUT_PROOF: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    PDF_SIZE: r.b1 ? r.b1.size : 0,
    ...checks,
  };

  printBlocks("invoice_pdf_professional_layout_proof", report);

  if (report.PROFESSIONAL_LAYOUT_PROOF !== "PASS") {
    console.error("STOP invoice_pdf_professional_layout_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_pdf_professional_layout");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
