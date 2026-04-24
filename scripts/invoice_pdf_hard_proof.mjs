#!/usr/bin/env node
/**
 * Invoice PDF print-mode hard proof (layout + real html2pdf path).
 *
 * Run (copy to %TEMP% optional):
 *   node scripts/invoice_pdf_hard_proof.mjs
 *   node scripts/invoice_pdf_hard_proof.mjs "https://infouzel.cz/projects/?nosw=1"
 *
 * Env: IU_FILTR_ROOT — repo root (folder with assets/iu-invoice-engine.js)
 * Env: IU_INVOICE_PROOF_PORT — local static server port (default 8097), ignored when argv URL is remote
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
  const candidates = [path.resolve(__dirname, ".."), process.cwd(), "c:\\projects\\filtr"];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "assets", "iu-invoice-engine.js"))) {
      ROOT = c;
      break;
    }
  }
}
if (!ROOT || !fs.existsSync(path.join(ROOT, "assets", "iu-invoice-engine.js"))) {
  console.error("Set IU_FILTR_ROOT to repo root (folder containing assets/iu-invoice-engine.js).");
  process.exit(1);
}

const PORT = Number(process.env.IU_INVOICE_PROOF_PORT || 8097);
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const DEFAULT_PROOF_APP_URL = "https://infouzel.cz/projects/?nosw=1";

function normalizeProofAppUrl(raw) {
  const t = String(raw || "").trim();
  const u = t || DEFAULT_PROOF_APP_URL;
  try {
    const x = new URL(u);
    if (!x.searchParams.has("nosw")) x.searchParams.set("nosw", "1");
    return x.href;
  } catch {
    return u;
  }
}

function isLocalProofAppUrl(href) {
  try {
    const h = new URL(href).hostname.toLowerCase();
    return h === "127.0.0.1" || h === "localhost";
  } catch {
    return false;
  }
}

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath === "/" || urlPath === "") ? "index.html" : urlPath.replace(/^\//, "").split("?")[0].replace(/\/$/, "") || "index.html");
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
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

function escapeCssForStyleTag(css) {
  return String(css || "").replace(/<\s*\/\s*style/gi, "<\\/style");
}

function printDocHtmlInline(cssText, innerFragmentHtml) {
  const css = escapeCssForStyleTag(cssText);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}</style></head><body>${innerFragmentHtml}</body></html>`;
}

async function loadEngine() {
  const href = pathToFileURL(path.join(ROOT, "assets", "iu-invoice-engine.js")).href;
  return import(href);
}

function printBlocks(label, obj) {
  console.log(`=== ${label} ===`);
  Object.keys(obj).forEach((k) => console.log(`${k}=${obj[k]}`));
  console.log(`=== END ${label} ===`);
}

async function collectFooterDiagnostics(page) {
  return page.evaluate(async () => {
    const { buildInvoicePrintHtml, computeTotals, defaultFormState, emptyLine } = await import("/assets/iu-invoice-engine.js");
    function buildState(payment) {
      const st = defaultFormState();
      st.supplierVatPayer = true;
      st.supplierFo.firstName = "Jan";
      st.supplierFo.lastName = "Dodavatel";
      st.supplierFo.ico = "12345679";
      st.supplierFo.address = "Testovací 1, Praha";
      st.supplierFo.accountNumber = "123456789/0100";
      st.buyerFo.firstName = "Eva";
      st.buyerFo.lastName = "Odběratel";
      st.buyerFo.address = "Kupní 2, Brno";
      st.invoice.number = "2026-9901";
      st.invoice.payment = payment;
      if (payment === "transfer") st.invoice.accountNumber = "987654321/0800";
      const long1 = ("Popis služby s mezerami a delším textem pro zalomení. ").repeat(18);
      const long2 = ("Technický rozsah práce: analýza, implementace, testování, dokumentace. ").repeat(14);
      const nospace = "X".repeat(140);
      st.lines = [];
      for (let i = 0; i < 12; i++) {
        const ln = emptyLine(true);
        ln.name = `Položka ${i + 1}`;
        ln.qty = "2";
        ln.unit = "hod";
        ln.unitPrice = "500";
        ln.vatRate = "21";
        if (i === 0) ln.description = long1;
        else if (i === 1) ln.description = long2;
        else if (i === 2) ln.description = nospace;
        st.lines.push(ln);
      }
      return st;
    }
    const st = buildState("cash");
    const totals = computeTotals(st);
    const html = buildInvoicePrintHtml(st, totals);
    const host = document.createElement("div");
    host.setAttribute("data-iu-invoice-print-host", "");
    host.innerHTML = "<div class=\"iu-invoice-print-page\">" + html + "</div>";
    document.body.appendChild(host);
    try {
      const pageEl = host.querySelector(".iu-invoice-print-page");
      const printHostExists = !!(host && host.hasAttribute("data-iu-invoice-print-host"));
      const printPageExists = !!pageEl;
      const footList = pageEl ? pageEl.querySelectorAll(".iu-invoice-print-footer") : [];
      const foot = footList.length ? footList[footList.length - 1] : null;
      const header = pageEl ? pageEl.querySelector(".iu-invoice-print-header") : null;
      const footRaw = foot ? String(foot.textContent || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "") : "";
      const footerText = footRaw.replace(/\s+/g, " ").trim();
      const headerRaw = header ? String(header.textContent || "").replace(/\s+/g, " ").trim() : "";
      const footerOnlyWwwInfoUzel = footerText === "www.infoUzel.cz";
      const createdByInFooter = /Vytvořeno pomocí/i.test(footRaw);
      const createdByInHeader = /Vytvořeno pomocí/i.test(headerRaw);
      const containsWwwInfoUzel = footRaw.indexOf("www.infoUzel.cz") !== -1;
      const containsCreatedByInfoUzel = /infoUzel\.cz/i.test(footRaw);
      const pageTextTail = pageEl
        ? String(pageEl.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(-220)
        : "";
      let rootCause = "ok";
      if (!foot) rootCause = "footer_missing";
      else if (footerText !== "www.infoUzel.cz") rootCause = "footer_norm_mismatch";
      else if (createdByInFooter) rootCause = "created_by_in_footer";
      return {
        printHostExists,
        printPageExists,
        footerExists: !!foot,
        footerText,
        footerOnlyWwwInfoUzel,
        createdByInFooter,
        createdByInHeader,
        containsWwwInfoUzel,
        containsCreatedByInfoUzel,
        pageTextTail,
        footerSelector: ".iu-invoice-print-footer",
        rootCause,
      };
    } finally {
      try {
        host.remove();
      } catch (_) {}
    }
  });
}

function safeGit(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", cwd: ROOT }).trim();
  } catch {
    return "";
  }
}

async function collectExporterDiagnostics(page, appUrl, consoleErrors, appErrors) {
  const d = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const srcs = scripts.map((s) => s.getAttribute("src") || "");
    const appHit = srcs.find((u) => /\/assets\/app\.js/i.test(u)) || "";
    const keys = Object.keys(window).filter((k) => /iuPdf|iuInvoice|Invoice|pdf/i.test(k));
    keys.sort();
    return {
      url: location.href,
      documentReadyState: document.readyState,
      scriptsCount: scripts.length,
      appScriptPresent: srcs.some((u) => /\/assets\/app\.js/i.test(u)),
      appScriptSrc: appHit,
      invoiceDomHostPresent: !!document.getElementById("iuInvoiceMount"),
      typeofExporter: typeof window.iuPdfExportHtmlStringToBlobForInvoice,
      typeofIuInvoiceOpenSurface: typeof window.iuInvoiceOpenSurface,
      typeofIuInvoiceModule: typeof window.iuInvoiceModule,
      typeofIuBuildInvoicePrintHtml: typeof window.iuBuildInvoicePrintHtml,
      availableWindowKeys: keys.slice(0, 120).join(","),
      availableWindowKeysCount: keys.length,
    };
  });
  printBlocks("EXPORTER_DIAGNOSTICS", {
    url: String(d.url || appUrl),
    documentReadyState: String(d.documentReadyState),
    scriptsCount: d.scriptsCount,
    appScriptPresent: d.appScriptPresent,
    appScriptSrc: String(d.appScriptSrc || ""),
    invoiceDomHostPresent: String(d.invoiceDomHostPresent),
    typeofExporter: String(d.typeofExporter),
    typeofIuInvoiceOpenSurface: String(d.typeofIuInvoiceOpenSurface),
    typeofIuInvoiceModule: String(d.typeofIuInvoiceModule),
    typeofIuBuildInvoicePrintHtml: String(d.typeofIuBuildInvoicePrintHtml),
    availableWindowKeys: String(d.availableWindowKeys || ""),
    lastConsoleErrors: consoleErrors.slice(-5).join(" | "),
    lastAppErrors: appErrors.slice(-5).join(" | "),
  });
}

function tryGhPrInfo() {
  const out = { url: "", branch: "", checks: "" };
  const opt = { encoding: "utf8", cwd: ROOT, stdio: ["pipe", "pipe", "ignore"] };
  try {
    out.url = execSync("gh pr view --json url -q .url", opt).trim();
  } catch {
    out.url = "";
  }
  try {
    out.branch = execSync("gh pr view --json headRefName -q .headRefName", opt).trim();
  } catch {
    out.branch = "";
  }
  try {
    out.checks = execSync("gh pr checks", opt).trim().split("\n")[0] || "";
  } catch {
    out.checks = "";
  }
  return out;
}

async function run() {
  const { chromium } = await import("playwright");
  const { buildInvoicePrintHtml, computeTotals, defaultFormState, emptyLine } = await loadEngine();

  function buildState(payment) {
    const st = defaultFormState();
    st.supplierVatPayer = true;
    st.supplierFo.firstName = "Jan";
    st.supplierFo.lastName = "Dodavatel";
    st.supplierFo.ico = "12345679";
    st.supplierFo.address = "Testovací 1, Praha";
    st.supplierFo.accountNumber = "123456789/0100";
    st.buyerFo.firstName = "Eva";
    st.buyerFo.lastName = "Odběratel";
    st.buyerFo.address = "Kupní 2, Brno";
    st.invoice.number = "2026-9901";
    st.invoice.payment = payment;
    if (payment === "transfer") {
      st.invoice.accountNumber = "987654321/0800";
    }
    const long1 = ("Popis služby s mezerami a delším textem pro zalomení. ").repeat(18);
    const long2 = ("Technický rozsah práce: analýza, implementace, testování, dokumentace. ").repeat(14);
    const nospace = "X".repeat(140);
    st.lines = [];
    for (let i = 0; i < 12; i++) {
      const ln = emptyLine(true);
      ln.name = `Položka ${i + 1}`;
      ln.qty = "2";
      ln.unit = "hod";
      ln.unitPrice = "500";
      ln.vatRate = "21";
      if (i === 0) ln.description = long1;
      else if (i === 1) ln.description = long2;
      else if (i === 2) ln.description = nospace;
      st.lines.push(ln);
    }
    return st;
  }

  const cssTextLocal = fs.readFileSync(path.join(ROOT, "assets", "iu-invoice-overlay.css"), "utf8");
  const stCash = buildState("cash");
  const totalsCash = computeTotals(stCash);
  const htmlCash = buildInvoicePrintHtml(stCash, totalsCash);
  const stXfer = buildState("transfer");
  const totalsXfer = computeTotals(stXfer);
  const htmlXfer = buildInvoicePrintHtml(stXfer, totalsXfer);

  const breakInsideGuardsPresent =
    cssTextLocal.indexOf("break-inside") !== -1 && cssTextLocal.indexOf("page-break-inside") !== -1;

  const appUrl = normalizeProofAppUrl(process.argv[2]);
  const useLocalStaticServer = isLocalProofAppUrl(appUrl);
  const server = useLocalStaticServer ? await startServer() : null;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();

  /** Layout-only: inline CSS only (no link + inline mix). */
  const pLayout = await ctx.newPage();
  await pLayout.setContent(printDocHtmlInline(cssTextLocal, ""), { url: "about:blank", waitUntil: "domcontentloaded" });
  await pLayout.waitForTimeout(200);

  const layout = await pLayout.evaluate((html) => {
    const host = document.createElement("div");
    host.setAttribute("data-iu-invoice-print-host", "");
    host.innerHTML = `<div class="iu-invoice-print-page">${html}</div>`;
    document.body.appendChild(host);
    const pageEl = host.querySelector(".iu-invoice-print-page");
    const cs = (el) => (el ? window.getComputedStyle(el) : null);
    const brand = pageEl.querySelector(".iu-invoice-print-brand");
    const hdr = pageEl.querySelector(".iu-invoice-print-header");
    const h1 = pageEl.querySelector(".iu-invoice-print-title");
    const footList = pageEl.querySelectorAll(".iu-invoice-print-footer");
    const foot = footList.length ? footList[footList.length - 1] : null;
    const footRaw = foot ? String(foot.textContent || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "") : "";
    const footNorm = footRaw.replace(/\s+/g, " ").trim();
    const hdrRaw = hdr ? String(hdr.textContent || "").replace(/\s+/g, " ").trim() : "";
    const bar = pageEl.querySelector(".iu-invoice-print-title-bar");
    const pageInk = pageEl ? cs(pageEl).color : "";
    const brandInk = brand ? cs(brand).color : "";
    const row = pageEl.querySelector(".iu-invoice-print-item-row");
    const desc = row ? row.querySelector(".iu-invoice-print-col-desc") : null;
    const qty = row ? row.querySelector(".iu-invoice-print-col-qty") : null;
    const price = row ? row.querySelector(".iu-invoice-print-col-price") : null;
    const vat = row ? row.querySelector(".iu-invoice-print-col-vat") : null;
    const tot = row ? row.querySelector(".iu-invoice-print-col-total") : null;
    const rd = desc ? desc.getBoundingClientRect() : null;
    const rq = qty ? qty.getBoundingClientRect() : null;
    const rp = price ? price.getBoundingClientRect() : null;
    const rv = vat ? vat.getBoundingClientRect() : null;
    const rt = tot ? tot.getBoundingClientRect() : null;
    const overlap = (a, b) => !!(a && b && a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1);
    const ov = pageEl ? cs(pageEl).overflow : "";
    const ovx = pageEl ? cs(pageEl).overflowX : "";
    return {
      createdByItalic: brand && (cs(brand).fontStyle === "italic" || cs(brand).fontStyle === "oblique"),
      createdByLightGray: !!(brandInk && pageInk && brandInk !== pageInk),
      invoiceTitleBordoStrip: !!bar,
      invoiceTitlePositionUnchanged: h1 && String(cs(h1).textAlign || "").toLowerCase() !== "center",
      spaceAfterInvoiceNumber: !!pageEl.querySelector(".iu-invoice-print-docno-gap"),
      supplierHeadingBold: (() => {
        const els = pageEl.querySelectorAll(".iu-invoice-print-section-label--bold");
        for (const el of els) {
          if ((el.textContent || "").indexOf("Dodavatel") !== -1) {
            const w = cs(el).fontWeight;
            const n = parseFloat(w);
            return w === "bold" || w === "bolder" || (!isNaN(n) && n >= 700);
          }
        }
        return false;
      })(),
      buyerHeadingBold: (() => {
        const els = pageEl.querySelectorAll(".iu-invoice-print-section-label--bold");
        for (const el of els) {
          if ((el.textContent || "").indexOf("Odběratel") !== -1) {
            const w = cs(el).fontWeight;
            const n = parseFloat(w);
            return w === "bold" || w === "bolder" || (!isNaN(n) && n >= 700);
          }
        }
        return false;
      })(),
      paymentCashBold: (() => {
        const el = pageEl.querySelector(".iu-invoice-print-pay--cash");
        if (!el || el.tagName !== "STRONG") return false;
        const w = cs(el).fontWeight;
        const n = parseFloat(w);
        return w === "bold" || w === "bolder" || (!isNaN(n) && n >= 700);
      })(),
      footerOnlyWwwInfoUzel: !!foot && footNorm === "www.infoUzel.cz",
      createdByInFooter: /Vytvořeno pomocí/i.test(footRaw),
      createdByInHeader: /Vytvořeno pomocí/i.test(hdrRaw),
      createdByRemovedFromFooter: !!foot && !/Vytvořeno pomocí/i.test(footRaw),
      quantityAlignedUnderHeader: !!(rd && rq && Math.abs(rd.top - rq.top) < 3),
      longTextWrapsInsideDescription: desc
        ? desc.scrollWidth <= desc.clientWidth + 8 || desc.scrollHeight > (parseFloat(window.getComputedStyle(desc).lineHeight) || 18) * 1.8
        : false,
      longTextDoesNotOverlapNumericColumns: !overlap(rd, rq) && !overlap(rd, rp) && !overlap(rd, rv) && !overlap(rd, rt),
      horizontalOverflow: pageEl ? pageEl.scrollWidth > pageEl.clientWidth + 2 : false,
      multiPageSupported: pageEl.scrollHeight > 1120,
      contentNotClippedAtPageEnd: ov !== "hidden",
      hasMarginsProbe: !!(pageEl && (parseFloat(cs(pageEl).paddingLeft) + parseFloat(cs(pageEl).paddingRight)) >= 100),
      hasBoldTitle: (() => {
        if (!h1) return false;
        const w = cs(h1).fontWeight;
        const n = parseFloat(w);
        return w === "bold" || w === "bolder" || (!isNaN(n) && n >= 600);
      })(),
      notPlainTextInvoice: !!pageEl.querySelector("table.iu-invoice-print-table"),
      spaceBeforeSubtotal: !!pageEl.querySelector(".iu-invoice-print-total-gap-before-sub"),
      totalDueBold: (() => {
        const el = pageEl.querySelector(".iu-invoice-print-total-due-label");
        if (!el) return false;
        const w = cs(el).fontWeight;
        const n = parseFloat(w);
        return w === "bold" || w === "bolder" || (!isNaN(n) && n >= 700);
      })(),
      totalDueAmountInline: !!(pageEl.querySelector(".iu-invoice-print-total-due-label") && pageEl.querySelector(".iu-invoice-print-total-due-amount")),
      spaceAfterTotalDue: !!pageEl.querySelector(".iu-invoice-print-total-gap-after-due"),
    };
  }, htmlCash);

  await pLayout.setContent(printDocHtmlInline(cssTextLocal, ""), { url: "about:blank", waitUntil: "domcontentloaded" });
  await pLayout.waitForTimeout(150);
  const xferStyle = await pLayout.evaluate((html) => {
    const host = document.createElement("div");
    host.setAttribute("data-iu-invoice-print-host", "");
    host.innerHTML = `<div class="iu-invoice-print-page">${html}</div>`;
    document.body.appendChild(host);
    const pageEl = host.querySelector(".iu-invoice-print-page");
    const el = pageEl.querySelector(".iu-invoice-print-pay--transfer");
    return {
      paymentTransferRendered: !!(el && el.tagName === "SPAN" && (el.textContent || "").trim() === "Převodem"),
    };
  }, htmlXfer);

  await pLayout.close();

  printBlocks("PDF_PRINT_STYLE_PROOF", {
    createdByItalic: layout.createdByItalic,
    createdByLightGray: layout.createdByLightGray,
    invoiceTitleBordoStrip: layout.invoiceTitleBordoStrip,
    supplierHeadingBold: layout.supplierHeadingBold,
    buyerHeadingBold: layout.buyerHeadingBold,
    paymentCashBold: layout.paymentCashBold,
    footerOnlyWwwInfoUzel: layout.footerOnlyWwwInfoUzel,
    createdByRemovedFromFooter: layout.createdByRemovedFromFooter,
    createdByInHeader: layout.createdByInHeader,
    createdByInFooter: layout.createdByInFooter,
    paymentTransferRendered: xferStyle.paymentTransferRendered,
  });

  printBlocks("ITEMS_LAYOUT_PROOF", {
    quantityAlignedUnderHeader: layout.quantityAlignedUnderHeader,
    longTextWrapsInsideDescription: layout.longTextWrapsInsideDescription,
    longTextDoesNotOverlapNumericColumns: layout.longTextDoesNotOverlapNumericColumns,
    horizontalOverflow: layout.horizontalOverflow,
  });

  printBlocks("SUMMARY_LAYOUT_PROOF", {
    spaceBeforeSubtotal: layout.spaceBeforeSubtotal,
    totalDueBold: layout.totalDueBold,
    totalDueAmountInline: layout.totalDueAmountInline,
    spaceAfterTotalDue: layout.spaceAfterTotalDue,
  });

  printBlocks("MULTIPAGE_PROOF", {
    multiPageSupported: layout.multiPageSupported,
    contentNotClippedAtPageEnd: layout.contentNotClippedAtPageEnd,
    breakInsideGuardsPresent: breakInsideGuardsPresent,
  });

  const page = await ctx.newPage();
  const consoleErrors = [];
  const appErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e && e.message ? e.message : e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") appErrors.push(msg.text());
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const urlCheck = await page.evaluate(() => {
    try {
      const u = new URL(location.href);
      return {
        href: u.href,
        hasProjectsPath: (u.pathname || "").indexOf("/projects") !== -1,
        noswIs1: u.searchParams.get("nosw") === "1",
      };
    } catch {
      return { href: String(location.href || ""), hasProjectsPath: false, noswIs1: false };
    }
  });
  printBlocks("PROOF_URL_CHECK", {
    href: urlCheck.href,
    hasProjectsPath: urlCheck.hasProjectsPath,
    noswIs1: urlCheck.noswIs1,
  });

  let exporterReady = false;
  for (let wi = 0; wi < 120; wi++) {
    exporterReady = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
    if (exporterReady) break;
    await page.waitForTimeout(500);
  }
  if (!exporterReady) {
    await collectExporterDiagnostics(page, appUrl, consoleErrors, appErrors);
    printBlocks("FIRST_BLOCKER", {
      part: "pdf_generation",
      reason: "no_exporter",
      detail: "window.iuPdfExportHtmlStringToBlobForInvoice never became a function after 120x500ms",
    });
    printBlocks("PDF_EXPORT_PROOF", {
      pdfGenerated: false,
      mimeType: "",
      pdfSizeGreaterThan1500: false,
      renderSource: "",
      printModeUsed: false,
      plainTextOnly: true,
      contentClipped: true,
    });
    printBlocks("GLOBAL_REGRESSION_PROOF", {
      consoleErrorsCount: consoleErrors.length,
      appErrorsCount: appErrors.length,
      overflowX: false,
    });
    printBlocks("PR_INFO", { url: "", branch: "", checks: "" });
    printBlocks("AUTO_MERGE_READY", { ready: "NO", reason: "pdf_generation_no_exporter" });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }
  await page.waitForTimeout(useLocalStaticServer ? 400 : 800);

  const footerDiag = await collectFooterDiagnostics(page);
  printBlocks("FOOTER_DIAGNOSTICS", footerDiag);

  const evalPdf = () =>
    page.evaluate(async () => {
    const { buildInvoicePrintHtml, computeTotals, defaultFormState, emptyLine } = await import("/assets/iu-invoice-engine.js");
    function buildState(payment) {
      const st = defaultFormState();
      st.supplierVatPayer = true;
      st.supplierFo.firstName = "Jan";
      st.supplierFo.lastName = "Dodavatel";
      st.supplierFo.ico = "12345679";
      st.supplierFo.address = "Testovací 1, Praha";
      st.supplierFo.accountNumber = "123456789/0100";
      st.buyerFo.firstName = "Eva";
      st.buyerFo.lastName = "Odběratel";
      st.buyerFo.address = "Kupní 2, Brno";
      st.invoice.number = "2026-9901";
      st.invoice.payment = payment;
      if (payment === "transfer") st.invoice.accountNumber = "987654321/0800";
      const long1 = ("Popis služby s mezerami a delším textem pro zalomení. ").repeat(18);
      const long2 = ("Technický rozsah práce: analýza, implementace, testování, dokumentace. ").repeat(14);
      const nospace = "X".repeat(140);
      st.lines = [];
      for (let i = 0; i < 12; i++) {
        const ln = emptyLine(true);
        ln.name = `Položka ${i + 1}`;
        ln.qty = "2";
        ln.unit = "hod";
        ln.unitPrice = "500";
        ln.vatRate = "21";
        if (i === 0) ln.description = long1;
        else if (i === 1) ln.description = long2;
        else if (i === 2) ln.description = nospace;
        st.lines.push(ln);
      }
      return st;
    }
    const st = buildState("cash");
    const totals = computeTotals(st);
    const html = buildInvoicePrintHtml(st, totals);
    const fn = window.iuPdfExportHtmlStringToBlobForInvoice;
    if (typeof fn !== "function") return { err: "no_exporter" };
    return await new Promise((resolve) => {
      fn(html, "proof.pdf", (err, out) => {
        if (err) {
          resolve({ err: String(err.message || err), proof: null, meta: null });
          return;
        }
        out.blob
          .arrayBuffer()
          .then((ab) => {
            const u = new Uint8Array(ab);
            const headLen = Math.min(u.length, 500000);
            let s = "";
            const step = 8000;
            for (let i = 0; i < headLen; i += step) {
              s += String.fromCharCode.apply(null, u.subarray(i, Math.min(i + step, headLen)));
            }
            const pc = (s.match(/\/Type\s*\/Page\b/g) || []).length;
            const first = String.fromCharCode(u[0], u[1], u[2], u[3]);
            resolve({
              err: null,
              size: out.blob.size,
              type: out.blob.type,
              proof: window._iuInvoicePrintProof || null,
              meta: window._iuInvoicePdfExportMeta || null,
              pageCount: pc,
              pdfHeader: first,
            });
          })
          .catch((e) => resolve({ err: String(e), proof: null, meta: null }));
      });
    });
    });

  let pdfOut = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      pdfOut = await evalPdf();
      break;
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.indexOf("Execution context was destroyed") === -1) throw e;
      await page.waitForTimeout(700);
      for (let wj = 0; wj < 60; wj++) {
        const ok = await page.evaluate(() => typeof window.iuPdfExportHtmlStringToBlobForInvoice === "function");
        if (ok) break;
        await page.waitForTimeout(400);
      }
    }
  }
  if (!pdfOut) pdfOut = { err: "pdf_eval_retry_exhausted", proof: null, meta: null };

  let rootCause = "";
  if (pdfOut.err) {
    rootCause = "pdf_generation: " + pdfOut.err;
    console.error("STOP", rootCause);
    if (String(pdfOut.err) === "no_exporter") {
      await collectExporterDiagnostics(page, appUrl, consoleErrors, appErrors);
      printBlocks("FIRST_BLOCKER", {
        part: "pdf_generation",
        reason: "no_exporter",
        detail: "evaluate path: typeof window.iuPdfExportHtmlStringToBlobForInvoice !== function",
      });
    } else if (/invoice_print_footer_invalid/i.test(String(pdfOut.err))) {
      printBlocks("FIRST_BLOCKER", {
        part: "pdf_generation",
        reason: "invoice_print_footer_invalid",
        evidence: String(pdfOut.err),
      });
    }
    printBlocks("PDF_EXPORT_PROOF", {
      pdfGenerated: false,
      mimeType: "",
      pdfSizeGreaterThan1500: false,
      renderSource: "",
      printModeUsed: false,
      plainTextOnly: true,
      contentClipped: true,
    });
    printBlocks("GLOBAL_REGRESSION_PROOF", {
      consoleErrorsCount: consoleErrors.length,
      appErrorsCount: appErrors.length,
      overflowX: "n/a",
    });
    printBlocks("PR_INFO", { url: "", branch: "", checks: "" });
    printBlocks("AUTO_MERGE_READY", { ready: "NO", reason: rootCause });
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }

  const pdfMagicOk = pdfOut.pdfHeader === "%PDF";
  const meta = pdfOut.meta || {};
  const proof = pdfOut.proof || {};
  const renderOk = meta.renderSource === "print_css_mode" || proof.renderSource === "print_css_mode";
  const printModeUsed = meta.printModeUsed === true || proof.printHostExists === true;
  const plainTextOnly = !pdfMagicOk || pdfOut.size < 500;
  const contentClipped = proof.contentClipped === true;

  printBlocks("PDF_EXPORT_PROOF", {
    pdfGenerated: pdfMagicOk && pdfOut.size > 1500,
    mimeType: pdfOut.type || "",
    pdfSizeGreaterThan1500: pdfOut.size > 1500,
    renderSource: renderOk ? "print_css_mode" : String(meta.renderSource || proof.renderSource || ""),
    printModeUsed: printModeUsed,
    plainTextOnly: plainTextOnly,
    contentClipped: contentClipped,
    hasMargins: !!proof.hasMargins,
    hasProfessionalLayout: !!proof.hasProfessionalLayout,
    pdfPageCount: pdfOut.pageCount || 0,
  });

  const overflowX =
    (await page.evaluate(() => {
      try {
        return document.documentElement.scrollWidth - document.documentElement.clientWidth > 2;
      } catch {
        return false;
      }
    })) === true;

  printBlocks("GLOBAL_REGRESSION_PROOF", {
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: appErrors.length,
    overflowX: overflowX,
  });

  const gitPaths = safeGit("diff --name-only");
  printBlocks("CHANGED_FILES", {
    paths: gitPaths ? gitPaths.replace(/\r?\n/g, " | ") : "(clean)",
  });
  const gitSb = safeGit("status -sb");
  printBlocks("GIT_STATUS", {
    line: gitSb ? gitSb.replace(/\r?\n/g, " | ") : "(none)",
  });

  const gh = tryGhPrInfo();
  printBlocks("PR_INFO", {
    url: gh.url || "(none)",
    branch: gh.branch || "(none)",
    checks: gh.checks || "(none)",
  });

  const fail =
    !layout.createdByItalic ||
    !layout.createdByLightGray ||
    !layout.invoiceTitleBordoStrip ||
    !layout.supplierHeadingBold ||
    !layout.buyerHeadingBold ||
    !layout.paymentCashBold ||
    !layout.footerOnlyWwwInfoUzel ||
    !layout.createdByInHeader ||
    layout.createdByInFooter ||
    !layout.createdByRemovedFromFooter ||
    !xferStyle.paymentTransferRendered ||
    !layout.quantityAlignedUnderHeader ||
    !layout.longTextDoesNotOverlapNumericColumns ||
    !layout.spaceBeforeSubtotal ||
    !layout.totalDueBold ||
    !layout.totalDueAmountInline ||
    !layout.spaceAfterTotalDue ||
    layout.horizontalOverflow ||
    !layout.multiPageSupported ||
    !layout.contentNotClippedAtPageEnd ||
    !breakInsideGuardsPresent ||
    !pdfMagicOk ||
    pdfOut.size < 1500 ||
    !renderOk ||
    !printModeUsed ||
    plainTextOnly ||
    contentClipped ||
    overflowX ||
    consoleErrors.length > 0 ||
    appErrors.length > 0;

  const reason = fail ? "proof_assertion_failed" : "invoice_print_footer_guard_passed";

  await browser.close();
  if (server) server.close();

  printBlocks("AUTO_MERGE_READY", {
    ready: fail ? "NO" : "YES",
    reason: reason,
  });

  if (fail) {
    console.error("STOP first-fail: see booleans above");
    process.exit(1);
  }
  console.log("PROOF_PASS");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
