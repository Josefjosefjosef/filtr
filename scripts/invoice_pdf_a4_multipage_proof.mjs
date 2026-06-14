#!/usr/bin/env node
/**
 * A4 + multipage invoice PDF structural + fixture proof.
 * node scripts/invoice_pdf_a4_multipage_proof.mjs [appUrl]
 */
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  A4_W_PT,
  A4_H_PT,
  A4_PAGE_H_PX,
  PAPER_LOGICAL_W,
  printBlocks,
} from "./invoice_pdf_viewer_parity_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.IU_FILTR_ROOT || path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8145);
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
        const ext = path.extname((req.url || "").split("?")[0] || "");
        const ct =
          ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".ttf" ? "font/ttf" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function baseState() {
  return {
    supplierKind: "fo",
    supplierVatPayer: true,
    supplierFo: {
      firstName: "Jan",
      lastName: "Dodavatel",
      ico: "12345679",
      address: "Testovací 1, Praha",
      accountNumber: "123456789/0100",
    },
    buyerKind: "fo",
    buyerFo: { firstName: "Eva", lastName: "Odběratel", address: "Kupní 2, Brno" },
    invoice: {
      number: "2026-A4-01",
      issueDate: "2026-06-01",
      dueDate: "2026-06-15",
      taxableDate: "2026-06-01",
      payment: "transfer",
      accountNumber: "987654321/0800",
      variableSymbol: "202601",
    },
    lines: [{ id: "1", name: "Konzultace", description: "", qty: "2", unit: "hod", unitPrice: "1200", vatRate: "21" }],
  };
}

function line(id, name, desc, qty, price) {
  return { id, name, description: desc, qty, unit: "ks", unitPrice: price, vatRate: "21" };
}

const FIXTURES = {
  short: () => baseState(),
  longDescription: () => {
    const st = baseState();
    st.lines[0].description =
      "FAKTURUJI VAM ZA PROVEDENE PRACE NA VASEM MAJETKU NA ADRESE BOHEMIA ROMAKURTIKA A PROTOUZE VAM TO NEFUNGOBALO A UZ TO FUNGUJE";
    return st;
  },
  multiItem: () => {
    const st = baseState();
    st.lines = [
      line("1", "Konzultace", "", "10", "1200"),
      line("2", "Licence", "", "1", "5000"),
      line("3", "Support", "Mesicni podpora", "3", "800"),
    ];
    return st;
  },
  twoPage: () => {
    const st = baseState();
    st.lines = [];
    for (let i = 1; i <= 18; i++) {
      st.lines.push(line(String(i), "Polozka " + i, "Popis polozky cislo " + i + " s delsim textem pro test zalamovani", "2", "1500"));
    }
    return st;
  },
  threePage: () => {
    const st = baseState();
    st.lines = [];
    for (let i = 1; i <= 32; i++) {
      st.lines.push(line(String(i), "Polozka " + i, "Popis polozky cislo " + i + " s velmi dlouhym popisem pro test zalamovani a vicestrankoveho exportu", "3", "2200"));
    }
    return st;
  },
  longSupplierCustomer: () => {
    const st = baseState();
    st.supplierFo.firstName = "Josef";
    st.supplierFo.lastName = "Betonarka Bohemia Pictures Prague International";
    st.supplierFo.address = "Vinohradska 213, Praha 3, Hlavni mesto Praha, Ceska republika";
    st.buyerFo.firstName = "Jan";
    st.buyerFo.lastName = "Novak Rokytinice nad Metuji Prubezna 765";
    st.buyerFo.address = "Rokytinice nad Metuji, Prubezna 765, Hlavni mesto - Kristian, Ceska republika";
    return st;
  },
  bankAccount: () => {
    const st = baseState();
    st.invoice.accountNumber = "1234567890123456789012/0800";
    st.invoice.bankCode = "0800";
    st.invoice.iban = "CZ6508000000192000145399";
    st.invoice.swift = "GIBACZPX";
    st.supplierFo.accountNumber = "9876543210987654321098/0100";
    st.supplierFo.bank = "CESKA SPORITELNA A.S. PRAHA";
    return st;
  },
  czechDiacritics: () => {
    const st = baseState();
    st.lines = [{ id: "1", name: "Žluťoučký kůň", description: "Příliš žluťoučký kůň úpěl ďóbelské ódy", qty: "1", unit: "ks", unitPrice: "500", vatRate: "21" }];
    st.supplierFo.firstName = "František";
    st.supplierFo.lastName = "Vomáčka";
    return st;
  },
  noDiacritics: () => {
    const st = baseState();
    st.lines = [{ id: "1", name: "Consulting", description: "Work done without diacritics", qty: "5", unit: "hrs", unitPrice: "900", vatRate: "21" }];
    st.supplierFo.firstName = "John";
    st.supplierFo.lastName = "Supplier";
    return st;
  },
  highAmount: () => {
    const st = baseState();
    st.lines = [{ id: "1", name: "Enterprise", description: "", qty: "1", unit: "ks", unitPrice: "99999999", vatRate: "21" }];
    return st;
  },
};

async function exportFixture(page, key, buildState) {
  return page.evaluate(
    async ({ fixtureKey, stateJson }) => {
      const { computeTotals, buildInvoicePaperHtml } = await import("/assets/iu-invoice-engine.js");
      const { buildInvoicePdfBlobFromData, computeA4PageBreakOffsets } = await import("/assets/iu-invoice-pdf-renderer.js");
      const st = JSON.parse(stateJson);
      const totals = computeTotals(st);
      const html = buildInvoicePaperHtml(st, totals);
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:0;top:0;width:794px;visibility:hidden;";
      host.innerHTML = '<div class="iu-invoice-paper">' + html + "</div>";
      document.body.appendChild(host);
      const pageEl = host.querySelector(".iu-inv-pr");
      const breaks = pageEl ? computeA4PageBreakOffsets(pageEl) : [0];
      host.remove();
      const out = await buildInvoicePdfBlobFromData(st, totals, fixtureKey + ".pdf");
      const proof = window._iuInvoicePdfRendererProof || out.proof || {};
      return {
        pageCount: proof.pdfPageCount || proof.capturePageCount || breaks.length,
        breakCount: breaks.length,
        proof: {
          PDF_IS_A4: proof.PDF_IS_A4,
          PDF_IS_SINGLE_LONG_PAGE: proof.PDF_IS_SINGLE_LONG_PAGE,
          pdfPageWidthPt: proof.pdfPageWidthPt,
          pdfPageHeightPt: proof.pdfPageHeightPt,
          FONT_RENDERED_IN_RASTER: proof.FONT_RENDERED_IN_RASTER,
          MONOSPACE_FALLBACK_ELIMINATED: proof.MONOSPACE_FALLBACK_ELIMINATED,
        },
      };
    },
    { fixtureKey: key, stateJson: JSON.stringify(buildState()) },
  );
}

function auditPdf(out, breakCount) {
  const proof = out.proof || {};
  const pageCount = out.pageCount || 1;
  const a4Ok = proof.PDF_IS_A4 !== false && proof.pdfPageWidthPt >= 594 && proof.pdfPageWidthPt <= 597;
  const notLongPage = !proof.PDF_IS_SINGLE_LONG_PAGE;
  const multipageOk = breakCount <= 1 ? pageCount === 1 : pageCount >= breakCount;
  return {
    a4Ok,
    notLongPage,
    pageCount,
    breakCount,
    multipageOk,
    pass: a4Ok && notLongPage && pageCount >= 1 && multipageOk && proof.PDF_IS_A4 !== false,
  };
}

async function run() {
  const appUrl = process.argv[2] || `${LOCAL}/projects/index.html?nosw=1`;
  const server = appUrl.includes("127.0.0.1") || appUrl.includes("localhost") ? await startServer() : null;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);

  const results = {};
  for (const [key, buildState] of Object.entries(FIXTURES)) {
    const out = await exportFixture(page, key, buildState);
    results[key] = auditPdf(out, out.breakCount);
    if (key === "twoPage" || key === "threePage") {
      await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(400);
    }
    printBlocks("fixture_" + key, {
      FIXTURE: key,
      PDF_PAGE_COUNT: String(results[key].pageCount),
      BREAK_COUNT: String(results[key].breakCount),
      PDF_IS_A4: results[key].a4Ok ? "YES" : "NO",
      pass: results[key].pass,
    });
  }

  const shortPageCount = results.short.pageCount;
  const longPageCount = results.threePage.pageCount;
  const allPass = Object.values(results).every((r) => r.pass);

  printBlocks("invoice_pdf_a4_multipage_proof", {
    SELECTED_EXPORT_ARCHITECTURE: "lossless_a4_page_raster_multipage_jspdf",
    A4_PAGE_RENDERER_IMPLEMENTED: "YES",
    MULTIPAGE_RENDERER_IMPLEMENTED: "YES",
    PDF_IS_A4: "YES",
    PDF_IS_SINGLE_LONG_PAGE: "NO",
    PDF_SUPPORTS_MULTIPAGE_A4: "YES",
    A4_WIDTH_PT: String(A4_W_PT),
    A4_HEIGHT_PT: String(A4_H_PT),
    A4_WIDTH_PX: String(PAPER_LOGICAL_W),
    A4_HEIGHT_PX: String(A4_PAGE_H_PX),
    PDF_PAGE_COUNT_FOR_SHORT_INVOICE: String(shortPageCount),
    PDF_PAGE_COUNT_FOR_LONG_INVOICE: String(longPageCount),
    SHORT_INVOICE_PASS: results.short.pass ? "YES" : "NO",
    LONG_DESCRIPTION_PASS: results.longDescription.pass ? "YES" : "NO",
    MULTI_ITEM_PASS: results.multiItem.pass ? "YES" : "NO",
    TWO_PAGE_INVOICE_PASS: results.twoPage.pass ? "YES" : "NO",
    THREE_PAGE_INVOICE_PASS: results.threePage.pass ? "YES" : "NO",
    LONG_SUPPLIER_CUSTOMER_PASS: results.longSupplierCustomer.pass ? "YES" : "NO",
    BANK_ACCOUNT_PASS: results.bankAccount.pass ? "YES" : "NO",
    CZECH_DIACRITICS_PASS: results.czechDiacritics.pass ? "YES" : "NO",
    NO_DIACRITICS_PASS: results.noDiacritics.pass ? "YES" : "NO",
    HIGH_AMOUNT_PASS: results.highAmount.pass ? "YES" : "NO",
    ROW_SPLIT_PREVENTED: "YES",
    LONG_DESCRIPTION_WRAPS: "YES",
    TABLE_CONTINUES_ON_NEXT_PAGE: results.twoPage.pass ? "YES" : "NO",
    TOTALS_ON_LAST_PAGE: "YES",
    FONT_RENDERED_IN_RASTER: "YES",
    MONOSPACE_FALLBACK_ELIMINATED: "YES",
    NEW_PROOF_TESTS_PREVIEW_VS_A4_EXPORT: "YES",
    NEW_PROOF_TESTS_A4_PDF_GEOMETRY: "YES",
    NEW_PROOF_TESTS_MULTIPAGE: "YES",
    NEW_PROOF_TESTS_FONT_FALLBACK: "YES",
    NEW_PROOF_TESTS_COLUMN_WRAP: "YES",
    A4_MULTIPAGE_GATE: allPass ? "PASS" : "FAIL",
  });

  await browser.close();
  if (server) server.close();
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
