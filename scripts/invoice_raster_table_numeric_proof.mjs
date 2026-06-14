#!/usr/bin/env node
/**
 * Raster invoice table numeric column overlap proof (high amount).
 * node scripts/invoice_raster_table_numeric_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8152);

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
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".ttf"
                ? "font/ttf"
                : "text/html";
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

function buildHighAmountState() {
  const longDesc =
    "Fakturuji Vám za poskytování fotografických služeb kde jsme vás fotili s vaším dítětem při módní přehlídce na této přehlídce se velmi často převlékali a my jsme vám pořídili vždy spoustu fotografií krásných které si můžete zobrazit na našich webových stránkách a věříme že budete velmi spokojeni";
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 12, 110 00 Praha",
      accountNumber: "123456789/0100",
    },
    supplierPo: {},
    buyerKind: "fo",
    buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 3, 602 00 Brno" },
    buyerPo: {},
    invoice: {
      number: "2026-HIGH-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      variableSymbol: "2026001",
      payment: "transfer",
      accountNumber: "123456789/0100",
      bankCode: "0100",
    },
    lines: [
      {
        id: "l1",
        name: "Konzultační služby",
        description:
          "Krátký popis první položky pro test stránkování tabulky s delším textem pro ověření zalamování popisu v levém sloupci bez ovlivnění číselných sloupců vpravo.",
        qty: "2",
        unit: "hod",
        unitPrice: "2500",
        vatRate: "21",
      },
      {
        id: "l2",
        name: "Fotografické služby",
        description: longDesc,
        qty: "1",
        unit: "ks",
        unitPrice: "1000000000",
        vatRate: "21",
      },
      {
        id: "l3",
        name: "Doprava a logistika",
        description:
          "Doprava materiálu na místo akce včetně zpětného svozu a kompletní logistické podpory během celého dne natáčení a fotografování na módní přehlídce.",
        qty: "1",
        unit: "ks",
        unitPrice: "12000",
        vatRate: "21",
      },
      {
        id: "l4",
        name: "Licence software",
        description: "Roční licence pro správu galerie fotografií včetně online náhledů pro klienty a rodinné album.",
        qty: "1",
        unit: "ks",
        unitPrice: "36000",
        vatRate: "21",
      },
      {
        id: "l5",
        name: "Retuš a postprodukce",
        description:
          "Profesionální retuš vybraných fotografií, barevné korekce, ořezy a finální export do tiskového a webového formátu pro zákazníka.",
        qty: "15",
        unit: "ks",
        unitPrice: "450",
        vatRate: "21",
      },
      {
        id: "l6",
        name: "Tisk fotografií premium",
        description:
          "Tisk fotografií na prémiový papír různých formátů včetně balení a přípravy pro osobní předání zákazníkovi po skončení akce.",
        qty: "20",
        unit: "ks",
        unitPrice: "120",
        vatRate: "21",
      },
      {
        id: "l7",
        name: "Pronájem vybavení",
        description:
          "Pronájem fotografického vybavení včetně světel, stativů, softboxů a záložní techniky pro celodenní pokrytí akce.",
        qty: "1",
        unit: "den",
        unitPrice: "8500",
        vatRate: "21",
      },
    ],
  };
}

async function run() {
  const appUrl = process.argv[2] || `http://127.0.0.1:${PORT}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => typeof window.iuInvoiceRenderRasterBundle === "function")) break;
    await page.waitForTimeout(300);
  }

  const r = await page.evaluate(async (stateJson) => {
    const st = JSON.parse(stateJson);
    const { computeTotals } = await import("/assets/iu-invoice-engine.js");
    const {
      renderInvoiceRasterBundle,
      auditRasterTableNumericColumns,
      getRasterTableColumnWidths,
      ensureInvoiceRasterFontReady,
    } = await import("/assets/iu-invoice-raster-renderer.js");
    const { buildInvoicePdfBlobFromData } = await import("/assets/iu-invoice-pdf-renderer.js");
    const totals = computeTotals(st);
    await ensureInvoiceRasterFontReady();
    const canvas = document.createElement("canvas");
    canvas.width = 794;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    const rows = st.lines.map((ln, index) => {
      const qty = ln.qty;
      const up = Number(ln.unitPrice);
      const vr = Number(ln.vatRate);
      const base = (Number(qty) || 0) * (Number.isFinite(up) ? up : 0);
      const gross = base * (1 + (Number.isFinite(vr) ? vr : 0) / 100);
      const fmt = (n) => {
        try {
          return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " Kč";
        } catch (_) {
          return String(n) + " Kč";
        }
      };
      return {
        qty: String(qty || ""),
        unit: String(ln.unit || "ks"),
        price: fmt(up),
        vat: String(vr) + " %",
        total: fmt(gross),
      };
    });
    const widths = getRasterTableColumnWidths(true);
    const audit = auditRasterTableNumericColumns(ctx, true, rows);
    const bundle = await renderInvoiceRasterBundle(st, totals, { scale: 2 });
    const pdfOut = await buildInvoicePdfBlobFromData(st, totals, "high-amount.pdf", { rasterBundle: bundle });
    const proof = window._iuInvoiceRasterProof || bundle.proof || {};
    return {
      widths,
      audit,
      pageCount: bundle.pageCount,
      pdfPageCount: proof.pdfPageCount || bundle.pageCount,
      sumGross: totals.sumGross,
      proof,
      pdfSize: pdfOut.blob.size,
    };
  }, JSON.stringify(buildHighAmountState()));

  await browser.close();
  if (server) server.close();

  const p = r.proof || {};
  const a = r.audit || {};
  const w = r.widths || {};
  const report = {
    QTY_COL_WIDTH: w.QTY_COL_WIDTH,
    UNIT_COL_WIDTH: w.UNIT_COL_WIDTH,
    PRICE_COL_WIDTH: w.PRICE_COL_WIDTH,
    VAT_COL_WIDTH: w.VAT_COL_WIDTH,
    TOTAL_COL_WIDTH: w.TOTAL_COL_WIDTH,
    DESCRIPTION_COL_WIDTH: w.DESCRIPTION_COL_WIDTH,
    NUMERIC_COLUMN_OVERLAP_REPRODUCED: a.TABLE_TEXT_OVERFLOWS === "YES" ? "YES" : "NO",
    OVERLAP_COLUMN: a.PRICE_COLUMN_OVERLAP === "YES" ? "price" : a.TOTAL_COLUMN_OVERLAP === "YES" ? "total" : a.UNIT_COLUMN_OVERLAP === "YES" ? "unit" : a.VAT_COLUMN_OVERLAP === "YES" ? "vat" : "none",
    OVERLAP_REASON: a.TABLE_TEXT_OVERFLOWS === "YES" ? "TEXT_FIT_MISSING" : "none",
    HIGH_AMOUNT_PASS: a.HIGH_AMOUNT_PASS,
    PRICE_COLUMN_OVERLAP: a.PRICE_COLUMN_OVERLAP,
    TOTAL_COLUMN_OVERLAP: a.TOTAL_COLUMN_OVERLAP,
    UNIT_COLUMN_OVERLAP: a.UNIT_COLUMN_OVERLAP,
    VAT_COLUMN_OVERLAP: a.VAT_COLUMN_OVERLAP,
    TABLE_TEXT_CLIPPED: a.TABLE_TEXT_CLIPPED,
    TABLE_TEXT_OVERFLOWS: a.TABLE_TEXT_OVERFLOWS,
    AMOUNT_FULLY_VISIBLE: a.AMOUNT_FULLY_VISIBLE,
    TOTAL_FULLY_VISIBLE: a.TOTAL_FULLY_VISIBLE,
    PDF_PAGE_COUNT: r.pdfPageCount,
    SUM_GROSS: r.sumGross,
    PREVIEW_USES_SAME_RASTER_AS_PDF: p.PREVIEW_USES_SAME_RASTER_AS_PDF ? "YES" : "NO",
    PDF_USES_SAME_RASTER_AS_PREVIEW: p.PDF_USES_SAME_RASTER_AS_PREVIEW ? "YES" : "NO",
    HTML_PREVIEW_CAPTURE_USED_FOR_PDF: p.HTML_PREVIEW_CAPTURE_USED_FOR_PDF ? "YES" : "NO",
    SECOND_RENDER_PATH_EXISTS: p.SECOND_RENDER_PATH_EXISTS ? "YES" : "NO",
    PDF_IS_A4: p.PDF_IS_A4 ? "YES" : "NO",
    PDF_SUPPORTS_MULTIPAGE_A4: p.PDF_SUPPORTS_MULTIPAGE_A4 ? "YES" : "NO",
    HIGH_AMOUNT_TABLE_GATE: a.HIGH_AMOUNT_PASS === "YES" && r.pdfPageCount >= 2 ? "PASS" : "FAIL",
  };

  printBlocks("invoice_raster_table_numeric_proof", report);

  if (report.HIGH_AMOUNT_TABLE_GATE !== "PASS") {
    console.error("STOP invoice_raster_table_numeric_proof");
    process.exit(1);
  }
  console.log("PROOF_PASS invoice_raster_table_numeric");
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
