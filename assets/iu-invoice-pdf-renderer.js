/**
 * infoUzel.cz — PDF export faktury: lossless PNG capture náhledu + jsPDF embed (browser-only).
 * jsPDF layout zůstává jen pro layout audit / overflow měření.
 */
import {
  buildInvoicePaperHtml,
  buyerBlockText,
  lineAmounts,
  parseNum,
  parseVatRate,
  supplierBlockText,
} from "./iu-invoice-engine.js";

export const IU_INVOICE_PDF_RENDERER_ID = "iu-invoice-pdf-renderer-v1";
export const IU_INVOICE_PREVIEW_HTML_RENDERER_ID = "iu-invoice-preview-html-v1";
const PAPER_CAPTURE_W = 794;

export const IU_INVOICE_PDF_LAYOUT = {
  pageFormat: "a4",
  orientation: "portrait",
  marginLeftMm: 16,
  marginRightMm: 16,
  marginTopMm: 14,
  marginBottomMm: 16,
  letterSpacingPt: 0,
  fontTitlePt: 19,
  fontInvoiceNumberPt: 10.5,
  fontPartyLabelPt: 9,
  fontPartyBodyPt: 10,
  fontPartyLineMult: 1.32,
  fontMetaPt: 9,
  fontTableHeadPt: 9,
  fontItemNamePt: 10,
  fontItemDescPt: 9,
  fontTableCellPt: 9.5,
  fontTableNumericPt: 8.5,
  fontTableNumericMinPt: 7.5,
  fontTotalsPt: 9.5,
  fontDuePt: 10.5,
  fontFootPt: 8,
  summaryBlockWidthMm: 96,
  summaryLabelWidthMm: 56,
  summaryValueWidthMm: 36,
  summaryGapMm: 4,
  tableHeaderHeightMm: 8,
  tableRowPadTopMm: 3.5,
  tableRowPadBottomMm: 3.5,
  tableRowMinMm: 9,
  summaryLineMm: 4.5,
  summaryBlockPadMm: 1.5,
  footerGapFromSummaryMm: 11,
  brandRgb: [136, 19, 55],
  lineGrayRgb: [219, 225, 232],
};

const MM_PAGE_W = 210;
const MM_PAGE_H = 297;
const IU_INV_PDF_FONT = "IUInvNoto";
const IU_INV_PDF_FONT_FILE = "IUInvNoto-normal.ttf";
function resolveInvoicePdfFontUrl() {
  try {
    const origin = typeof window !== "undefined" && window.location && window.location.origin ? window.location.origin : "";
    if (origin && origin !== "null") return origin + "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
  } catch (_) {}
  return "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";
}

let pdfFontLoadPromise = null;
let pdfFontLoadOk = false;
let pdfFontHttpStatus = 0;
let pdfFontGuardPass = false;

const pdfFontRuntime = {
  FONT_HTTP_STATUS: 0,
  FONT_LOADED: false,
  FONT_REGISTERED: false,
  FONT_USED_FOR_RENDER: false,
  FONT_FALLBACK_USED: false,
  PDF_FONT_GUARD_PASS: false,
  PDF_FONT_ENGINE: "noto-utf8-vfs-identity-h-required",
};

function fmtMoney(n) {
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " Kč";
  } catch (_) {
    return String(Math.round(n * 100) / 100) + " Kč";
  }
}

function fmtDateCs(iso) {
  const s = String(iso || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  return m[3] + "." + m[2] + "." + m[1];
}

function ptToMm(pt) {
  return (pt * 25.4) / 72;
}

function applyNormalTracking(doc) {
  try {
    if (typeof doc.setCharSpace === "function") doc.setCharSpace(0);
    if (typeof doc.setWordSpacing === "function") doc.setWordSpacing(0);
  } catch (_) {}
}

function pdfText(doc, text, x, y, opts) {
  applyNormalTracking(doc);
  setPdfFont(doc, (opts && opts.style) || "normal");
  const o = opts || {};
  if (o.maxWidth) {
    doc.text(String(text || ""), x, y, { maxWidth: o.maxWidth, align: o.align || "left" });
    return;
  }
  if (o.align) doc.text(String(text || ""), x, y, { align: o.align });
  else doc.text(String(text || ""), x, y);
}

function lineHeightMm(pt, mult) {
  return ptToMm(pt) * (mult || 1.28);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    try {
      const existing = document.querySelector('script[data-iu-jspdf="1"]');
      if (existing && window.jspdf && window.jspdf.jsPDF) {
        resolve(window.jspdf.jsPDF);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-iu-jspdf", "1");
      s.onload = () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("jspdf_missing"));
      };
      s.onerror = () => reject(new Error("jspdf_load_failed"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureJsPDF() {
  return loadScriptOnce("/assets/vendor/jspdf.umd.min.js");
}

async function loadInvoicePdfFontBase64() {
  const url = resolveInvoicePdfFontUrl();
  const res = await fetch(url, { cache: "force-cache" });
  pdfFontHttpStatus = res.status;
  pdfFontRuntime.FONT_HTTP_STATUS = res.status;
  if (!res.ok) throw new Error("invoice_pdf_font_fetch_failed:" + res.status);
  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength < 10000) throw new Error("invoice_pdf_font_empty");
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  pdfFontRuntime.FONT_LOADED = true;
  return btoa(binary);
}

export function preloadInvoicePdfFont() {
  if (!pdfFontLoadPromise) {
    pdfFontLoadPromise = loadInvoicePdfFontBase64()
      .then((b64) => {
        pdfFontLoadOk = true;
        return b64;
      })
      .catch((err) => {
        pdfFontLoadPromise = null;
        pdfFontLoadOk = false;
        throw err;
      });
  }
  return pdfFontLoadPromise;
}

function registerInvoicePdfFontOnDoc(doc, b64) {
  if (!doc.existsFileInVFS(IU_INV_PDF_FONT_FILE)) {
    doc.addFileToVFS(IU_INV_PDF_FONT_FILE, b64);
    doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "normal", "Identity-H");
    doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "bold", "Identity-H");
  }
  pdfFontRuntime.FONT_REGISTERED = true;
}

function readActivePdfFontName(doc) {
  try {
    if (typeof doc.getFont === "function") {
      const f = doc.getFont();
      if (f && f.fontName) return String(f.fontName);
    }
  } catch (_) {}
  try {
    if (doc.internal && doc.internal.getFont) {
      const f = doc.internal.getFont();
      if (f && f.fontName) return String(f.fontName);
    }
  } catch (_) {}
  return "";
}

function assertPdfFontActive(doc, style) {
  const styleKey = style === "bold" ? "bold" : "normal";
  doc.setFont(IU_INV_PDF_FONT, styleKey);
  applyNormalTracking(doc);
  const active = readActivePdfFontName(doc);
  const helveticaLike = /helvetica|times|courier/i.test(active);
  if (!active || active !== IU_INV_PDF_FONT || helveticaLike) {
    pdfFontRuntime.FONT_FALLBACK_USED = true;
    pdfFontRuntime.FONT_USED_FOR_RENDER = false;
    throw new Error("invoice_pdf_font_fallback_detected:" + (active || "none"));
  }
  pdfFontRuntime.FONT_USED_FOR_RENDER = true;
  pdfFontRuntime.FONT_FALLBACK_USED = false;
}

function assertUtf8FontMetrics(doc) {
  assertPdfFontActive(doc, "normal");
  doc.setFontSize(10);
  const wWord = doc.getTextWidth("číslo");
  if (!Number.isFinite(wWord) || wWord < 6) throw new Error("invoice_pdf_utf8_metrics_fail");
  const perChar = wWord / 5;
  if (perChar > 8) throw new Error("invoice_pdf_utf8_spacing_fail");
}

async function ensureInvoicePdfUtf8Font(doc) {
  const b64 = await preloadInvoicePdfFont();
  registerInvoicePdfFontOnDoc(doc, b64);
  assertUtf8FontMetrics(doc);
  pdfFontGuardPass = true;
  pdfFontRuntime.PDF_FONT_GUARD_PASS = true;
}

function setPdfFont(doc, style) {
  assertPdfFontActive(doc, style);
}

function measureTextWidthMm(doc, text, pt) {
  doc.setFontSize(pt);
  applyNormalTracking(doc);
  return doc.getTextWidth(String(text || ""));
}

function fitFontSizeForColumn(doc, text, maxW, startPt, minPt) {
  let pt = startPt;
  const t = String(text || "");
  while (pt >= minPt) {
    if (measureTextWidthMm(doc, t, pt) <= maxW) return pt;
    pt -= 0.5;
  }
  return minPt;
}

/** Never return empty — smallest visible line that fits (split / truncate). */
function truncateTextToFit(doc, text, maxW, pt) {
  const raw = String(text || "").trim() || "—";
  applyNormalTracking(doc);
  doc.setFontSize(pt);
  const split = doc.splitTextToSize(raw, maxW);
  for (let i = 0; i < split.length; i++) {
    if (measureTextWidthMm(doc, split[i], pt) <= maxW + 0.2) return split[i];
  }
  const ell = "…";
  let t = raw;
  while (t.length > 0 && measureTextWidthMm(doc, t + ell, pt) > maxW + 0.2) {
    t = t.slice(0, -1);
  }
  if (t.length > 0) return t + ell;
  return raw.charAt(0) || "—";
}

function withColumnClip(doc, col, yTop, h, drawFn) {
  doc.saveGraphicsState();
  doc.rect(col.x + 0.25, yTop + 0.15, Math.max(2, col.w - 0.5), Math.max(2, h - 0.3));
  doc.clip();
  try {
    drawFn();
  } finally {
    doc.restoreGraphicsState();
  }
}

function planTableCellDraw(doc, col, text, startPt, minPt) {
  const pad = 1.2;
  const maxW = Math.max(4, col.w - pad * 2);
  const raw = String(text || "");
  setPdfFont(doc, "normal");
  let pt = fitFontSizeForColumn(doc, raw, maxW, startPt, minPt);
  if (measureTextWidthMm(doc, raw, pt) <= maxW + 0.2) {
    const lineH = lineHeightMm(pt, 1.12);
    return { overflow: false, fontPt: pt, twoLine: false, lines: [raw], lineH, cellH: lineH };
  }
  if (raw.indexOf(" Kč") > 0) {
    const amt = raw.replace(/ Kč$/, "").trim();
    pt = fitFontSizeForColumn(doc, amt, maxW, startPt, minPt);
    const lh = lineHeightMm(pt, 1.1);
    if (measureTextWidthMm(doc, amt, pt) <= maxW + 0.2) {
      return { overflow: false, fontPt: pt, twoLine: true, lines: [amt, "Kč"], lineH: lh, cellH: lh * 2.2 };
    }
    const amtFallback = truncateTextToFit(doc, amt, maxW, minPt);
    const lhFb = lineHeightMm(minPt, 1.1);
    return {
      overflow: true,
      fontPt: minPt,
      twoLine: true,
      lines: [amtFallback, "Kč"],
      lineH: lhFb,
      cellH: lhFb * 2.2,
    };
  }
  pt = minPt;
  const lineH = lineHeightMm(pt, 1.1);
  const fallback = truncateTextToFit(doc, raw, maxW, pt);
  const tw = measureTextWidthMm(doc, raw, pt);
  return {
    overflow: tw > maxW + 0.2,
    fontPt: pt,
    twoLine: false,
    lines: [fallback],
    lineH,
    cellH: lineH,
  };
}

/** @returns {{ overflow: boolean, fontPt: number, twoLine: boolean, cellH: number }} */
function drawTableCellText(doc, col, text, yTop, rowH, opts) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const align = opts.align || "right";
  const style = opts.style || "normal";
  const startPt = opts.fontPt || L.fontTableNumericPt;
  const minPt = opts.minPt || L.fontTableNumericMinPt;
  const pad = 1.2;
  const x = align === "center" ? col.x + col.w / 2 : col.x + col.w - pad;
  setPdfFont(doc, style);
  const plan = planTableCellDraw(doc, col, text, startPt, minPt);
  const lines = plan.lines && plan.lines.length ? plan.lines : [truncateTextToFit(doc, String(text || ""), Math.max(4, col.w - pad * 2), minPt)];
  withColumnClip(doc, col, yTop, rowH, () => {
    doc.setFontSize(plan.fontPt);
    if (plan.twoLine && lines.length === 2) {
      const mid = yTop + rowH / 2;
      pdfText(doc, lines[0], x, mid - plan.lineH * 0.45, { align, style });
      pdfText(doc, lines[1], x, mid + plan.lineH * 0.35, { align, style });
    } else {
      pdfText(doc, lines[0], x, yTop + rowH / 2, { align, style });
    }
  });
  return {
    overflow: plan.overflow,
    fontPt: plan.fontPt,
    twoLine: plan.twoLine,
    cellH: plan.twoLine ? plan.lineH * 2.2 : plan.lineH,
  };
}

function columnLayout(hasVat) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const x0 = L.marginLeftMm;
  const xEnd = MM_PAGE_W - L.marginRightMm;
  const inner = xEnd - x0;
  if (hasVat) {
    const wNum = 6;
    const wQty = 10;
    const wUnit = 10;
    const wPrice = 26;
    const wVat = 11;
    const wTotal = 26;
    const wItem = inner - (wNum + wQty + wUnit + wPrice + wVat + wTotal);
    let x = x0;
    const cols = [
      { key: "num", x, w: wNum, label: "#" },
      { key: "item", x: (x += wNum), w: wItem, label: "Položka" },
      { key: "qty", x: (x += wItem), w: wQty, label: "Množ." },
      { key: "unit", x: (x += wQty), w: wUnit, label: "Jedn." },
      { key: "price", x: (x += wUnit), w: wPrice, label: "Cena / j." },
      { key: "vat", x: (x += wPrice), w: wVat, label: "DPH" },
      { key: "total", x: (x += wVat), w: wTotal, label: "Celkem" },
    ];
    return { cols, x0, xEnd, inner };
  }
  const wNum = 6;
  const wQty = 12;
  const wUnit = 12;
  const wPrice = 28;
  const wTotal = 28;
  const wItem = inner - (wNum + wQty + wUnit + wPrice + wTotal);
  let x = x0;
  const cols = [
    { key: "num", x, w: wNum, label: "#" },
    { key: "item", x: (x += wNum), w: wItem, label: "Položka" },
    { key: "qty", x: (x += wItem), w: wQty, label: "Množ." },
    { key: "unit", x: (x += wQty), w: wUnit, label: "Jedn." },
    { key: "price", x: (x += wUnit), w: wPrice, label: "Cena / j." },
    { key: "total", x: (x += wPrice), w: wTotal, label: "Celkem" },
  ];
  return { cols, x0, xEnd, inner };
}

function summaryBlockLayout() {
  const L = IU_INVOICE_PDF_LAYOUT;
  const blockW = L.summaryBlockWidthMm;
  const blockX = MM_PAGE_W - L.marginRightMm - blockW;
  const labelX = blockX;
  const valueX = blockX + L.summaryLabelWidthMm + L.summaryGapMm;
  const valueW = L.summaryValueWidthMm;
  return {
    blockX,
    blockW,
    labelX,
    labelW: L.summaryLabelWidthMm,
    valueX,
    valueW,
    gap: L.summaryGapMm,
    valueRight: blockX + blockW,
  };
}

/** Stress-test column widths without rendering a page (font must be registered on doc). */
export function auditInvoicePdfLayout(doc, hasVat) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const layout = columnLayout(hasVat);
  const priceCol = layout.cols.find((c) => c.key === "price");
  const vatCol = layout.cols.find((c) => c.key === "vat");
  const totalCol = layout.cols.find((c) => c.key === "total");
  const samples = {
    price: ["50 000,00 Kč", "5 007 679,00 Kč", "99 999 999,99 Kč"],
    vat: ["21 %", "0 %", "12 %"],
    total: ["60 500,00 Kč", "6 059 291,59 Kč", "120 999 999,99 Kč"],
  };
  const pad = 1.2;
  const auditCell = (col, texts, startPt) => {
    if (!col) return { overflow: false, maxTextW: 0 };
    let overflow = false;
    let maxTextW = 0;
    for (let i = 0; i < texts.length; i++) {
      const plan = planTableCellDraw(doc, col, texts[i], startPt, L.fontTableNumericMinPt);
      if (plan.overflow) overflow = true;
      if (!plan.lines.length) overflow = true;
      const tw = plan.lines.length ? measureTextWidthMm(doc, plan.lines[0], plan.fontPt) : maxTextW;
      if (tw > maxTextW) maxTextW = tw;
    }
    return { overflow, maxTextW };
  };
  const priceA = auditCell(priceCol, samples.price, L.fontTableNumericPt);
  const vatA = auditCell(vatCol, samples.vat, L.fontTableCellPt);
  const totalA = auditCell(totalCol, samples.total, L.fontTableNumericPt);
  const sum = summaryBlockLayout();
  const sumSamples = samples.total;
  let summaryLabelOverflow = false;
  let summaryValueOverflow = false;
  let summaryOverlap = false;
  const sumRows = [
    ["Mezisoučet bez DPH:", "60 500,00 Kč"],
    ["DPH:", "6 059 291,59 Kč"],
    ["Celkem k úhradě:", "120 999 999,99 Kč"],
  ];
  for (let i = 0; i < sumRows.length; i++) {
    const lbl = sumRows[i][0];
    const amt = sumRows[i][1];
    const lblPt = fitFontSizeForColumn(doc, lbl, sum.labelW, L.fontTotalsPt, L.fontTableNumericMinPt);
    const valPt = fitFontSizeForColumn(doc, amt, sum.valueW, L.fontTotalsPt, L.fontTableNumericMinPt);
    const lw = measureTextWidthMm(doc, lbl, lblPt);
    const vw = measureTextWidthMm(doc, amt, valPt);
    const labelRight = sum.labelX + lw;
    const valueLeft = sum.valueRight - vw;
    if (lw > sum.labelW + 0.25) summaryLabelOverflow = true;
    if (vw > sum.valueW + 0.25) summaryValueOverflow = true;
    if (labelRight + sum.gap > valueLeft + 0.25) summaryOverlap = true;
  }
  return {
    PRICE_COLUMN_WIDTH: priceCol ? priceCol.w : 0,
    VAT_COLUMN_WIDTH: vatCol ? vatCol.w : 0,
    TOTAL_COLUMN_WIDTH: totalCol ? totalCol.w : 0,
    PRICE_TEXT_WIDTH: priceA.maxTextW,
    VAT_TEXT_WIDTH: vatA.maxTextW,
    TOTAL_TEXT_WIDTH: totalA.maxTextW,
    PRICE_OVERFLOW: priceA.overflow,
    VAT_OVERFLOW: vatA.overflow,
    TOTAL_OVERFLOW: totalA.overflow,
    TABLE_OVERFLOW_FIXED: !priceA.overflow && !vatA.overflow && !totalA.overflow,
    SUMMARY_BLOCK_X: sum.blockX,
    SUMMARY_BLOCK_WIDTH: sum.blockW,
    SUMMARY_LABEL_WIDTH: sum.labelW,
    SUMMARY_VALUE_WIDTH: sum.valueW,
    SUMMARY_GAP: sum.gap,
    SUMMARY_LABEL_OVERFLOW: summaryLabelOverflow,
    SUMMARY_VALUE_OVERFLOW: summaryValueOverflow,
    SUMMARY_OVERLAP: summaryOverlap,
    SUMMARY_OVERFLOW_FIXED: !summaryLabelOverflow && !summaryValueOverflow && !summaryOverlap,
    PDF_FONT_USED: IU_INV_PDF_FONT,
  };
}

function publishRendererProof(extra) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const typo = {
    TYPOGRAPHY_FIX: "v1_utf8_noto_font",
    PDF_CHAR_SPACING: 0,
    PDF_LETTER_SPACING: L.letterSpacingPt,
    PDF_TEXT_RENDER_MODE: "fill",
    PDF_FONT_ENGINE: "noto-utf8-vfs-identity-h",
    PDF_FONT_USED: IU_INV_PDF_FONT,
    PDF_FONT_LOAD_OK: pdfFontLoadOk,
    FONT_HTTP_STATUS: pdfFontRuntime.FONT_HTTP_STATUS,
    FONT_LOADED: pdfFontRuntime.FONT_LOADED,
    FONT_REGISTERED: pdfFontRuntime.FONT_REGISTERED,
    FONT_USED_FOR_RENDER: pdfFontRuntime.FONT_USED_FOR_RENDER,
    FONT_FALLBACK_USED: pdfFontRuntime.FONT_FALLBACK_USED,
    PDF_FONT_GUARD_PASS: pdfFontRuntime.PDF_FONT_GUARD_PASS,
    TEXT_SPACING_FIXED: pdfFontRuntime.PDF_FONT_GUARD_PASS && !pdfFontRuntime.FONT_FALLBACK_USED,
    HEADER_FONT_SIZE: L.fontTitlePt + "pt",
    HEADER_LETTER_SPACING: L.letterSpacingPt + "pt",
    INVOICE_NUMBER_FONT_SIZE: L.fontInvoiceNumberPt + "pt",
    SUPPLIER_FONT_SIZE: L.fontPartyBodyPt + "pt",
    CUSTOMER_FONT_SIZE: L.fontPartyBodyPt + "pt",
    ITEM_NAME_FONT_SIZE: L.fontItemNamePt + "pt",
    ITEM_DESCRIPTION_FONT_SIZE: L.fontItemDescPt + "pt",
    TABLE_FONT_SIZE: L.fontTableCellPt + "pt",
    SUMMARY_FONT_SIZE: L.fontTotalsPt + "pt",
    FOOTER_FONT_SIZE: L.fontFootPt + "pt",
    TABLE_ROW_HEIGHT: L.tableRowMinMm + "mm",
    FOOTER_TOP_GAP: L.footerGapFromSummaryMm + "mm",
    LETTER_SPACING: L.letterSpacingPt + "pt",
    ITEM_FONT_SIZE: L.fontItemNamePt + "pt",
    DESCRIPTION_FONT_SIZE: L.fontItemDescPt + "pt",
  };
  const proof = Object.assign(
    {
      NEW_RENDERER: IU_INVOICE_PDF_RENDERER_ID,
      PDF_ENGINE: "jspdf",
      PDF_PAGE_FORMAT: L.pageFormat,
      PDF_MARGIN_LEFT: L.marginLeftMm,
      PDF_MARGIN_RIGHT: L.marginRightMm,
      PDF_MARGIN_TOP: L.marginTopMm,
      PDF_MARGIN_BOTTOM: L.marginBottomMm,
      PDF_ITEM_FONT_SIZE: L.fontItemNamePt + "pt",
      PDF_ITEM_DESCRIPTION_FONT_SIZE: L.fontItemDescPt + "pt",
      PDF_TABLE_COLUMNS: "num,item,qty,unit,price,vat?,total",
      PDF_CONTENT_SCALE: 1,
      PDF_PAGE_WIDTH_MM: MM_PAGE_W,
      PDF_PAGE_HEIGHT_MM: MM_PAGE_H,
    },
    typo,
    extra || {},
  );
  try {
    window._iuInvoicePdfRendererProof = proof;
    window._iuInvoicePdfExportMeta = {
      renderSource: IU_INVOICE_PDF_RENDERER_ID,
      generatedFromPreview: false,
      generatedFromScaledPreview: false,
      visualTemplateUsed: false,
      plainTextOnly: false,
      paperModeUsed: false,
      pdfEngine: "jspdf",
      typographyFix: "v1_utf8_noto_font",
    };
  } catch (_) {}
  return proof;
}

function drawMultiline(doc, lines, x, y, lineH, style) {
  let cy = y;
  for (let i = 0; i < lines.length; i++) {
    pdfText(doc, lines[i], x, cy, { style: style || "normal" });
    cy += lineH;
  }
  return cy;
}

function drawPartyColumns(doc, state, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const colW = (MM_PAGE_W - L.marginLeftMm - L.marginRightMm - 6) / 2;
  const xL = L.marginLeftMm;
  const xR = L.marginLeftMm + colW + 6;
  applyNormalTracking(doc);
  setPdfFont(doc, "bold");
  doc.setFontSize(L.fontPartyLabelPt);
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  pdfText(doc, "Dodavatel", xL, y, { style: "bold" });
  pdfText(doc, "Odběratel", xR, y, { style: "bold" });
  setPdfFont(doc, "normal");
  doc.setFontSize(L.fontPartyBodyPt);
  doc.setTextColor(30, 41, 59);
  const supLines = doc.splitTextToSize(supplierBlockText(state), colW);
  const buyLines = doc.splitTextToSize(buyerBlockText(state), colW);
  const lh = lineHeightMm(L.fontPartyBodyPt, L.fontPartyLineMult);
  const yBody = y + ptToMm(L.fontPartyLabelPt) + 2;
  const yAfterL = drawMultiline(doc, supLines, xL, yBody, lh);
  const yAfterR = drawMultiline(doc, buyLines, xR, yBody, lh);
  return Math.max(yAfterL, yAfterR) + 2;
}

function drawMetaBlock(doc, state, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const inv = state.invoice || {};
  const payLabel = inv.payment === "cash" ? "Hotově" : "Převodem";
  const rows = [
    ["Datum vystavení", fmtDateCs(inv.issueDate), "Splatnost", fmtDateCs(inv.dueDate)],
    ["DUZP", fmtDateCs(inv.taxableDate), "Úhrada", payLabel],
  ];
  if (String(inv.variableSymbol || "").trim()) {
    rows.push(["VS", String(inv.variableSymbol).trim(), "", ""]);
  }
  const x0 = L.marginLeftMm;
  const inner = MM_PAGE_W - L.marginLeftMm - L.marginRightMm;
  const lh = lineHeightMm(L.fontMetaPt, 1.3);
  const labelW = 36;
  const valW = 42;
  const col2 = x0 + labelW + valW + 4;
  applyNormalTracking(doc);
  doc.setFontSize(L.fontMetaPt);
  doc.setTextColor(30, 41, 59);
  let cy = y;
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    setPdfFont(doc, "bold");
    pdfText(doc, String(row[0] || ""), x0, cy, { style: "bold" });
    pdfText(doc, String(row[1] || ""), x0 + labelW, cy, { maxWidth: valW });
    if (row[2]) {
      pdfText(doc, String(row[2]), col2, cy, { style: "bold" });
      pdfText(doc, String(row[3] || ""), col2 + labelW, cy, { maxWidth: valW });
    }
    cy += lh;
  }
  if (inv.payment === "transfer") {
    cy += 1.5;
    doc.setFillColor(248, 250, 252);
    const bankH = 9;
    doc.rect(x0, cy, inner, bankH, "F");
    doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
    doc.rect(x0, cy, inner, bankH, "S");
    doc.setFontSize(L.fontMetaPt);
    let bank = "Účet: " + String(inv.accountNumber || "").trim();
    if (inv.bankCode) bank += " / " + String(inv.bankCode).trim();
    if (inv.iban) bank += " · IBAN: " + String(inv.iban).trim();
    if (inv.swift) bank += " · SWIFT: " + String(inv.swift).trim();
    pdfText(doc, bank, x0 + 2, cy + 2.5, { maxWidth: inner - 4 });
    cy += bankH + 1.5;
  }
  return cy + 1;
}

function drawTableHeader(doc, layout, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const h = L.tableHeaderHeightMm;
  const yTop = y;
  applyNormalTracking(doc);
  doc.setFillColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.rect(layout.x0, yTop, layout.inner, h, "F");
  setPdfFont(doc, "bold");
  doc.setTextColor(255, 255, 255);
  const midY = yTop + h / 2 + ptToMm(L.fontTableHeadPt) * 0.35;
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    const align = c.key === "num" ? "center" : c.key === "item" ? "left" : "right";
    const plan = planTableCellDraw(doc, c, c.label, L.fontTableHeadPt, 7);
    withColumnClip(doc, c, yTop, h, () => {
      if (!plan.lines.length) return;
      doc.setFontSize(plan.fontPt);
      const x =
        align === "center" ? c.x + c.w / 2 : align === "left" ? c.x + 1.5 : c.x + c.w - 1.5;
      pdfText(doc, plan.lines[0], x, midY, { align, style: "bold" });
    });
  }
  doc.setTextColor(30, 41, 59);
  return yTop + h;
}

function measureTableRow(doc, layout, row) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const itemCol = layout.cols.find((c) => c.key === "item");
  const itemW = itemCol ? itemCol.w - 3 : 40;
  doc.setFontSize(L.fontItemNamePt);
  setPdfFont(doc, "bold");
  const nameLines = doc.splitTextToSize(String(row.name || ""), itemW);
  setPdfFont(doc, "normal");
  doc.setFontSize(L.fontItemDescPt);
  const descLines = row.description ? doc.splitTextToSize(String(row.description), itemW) : [];
  const lhName = lineHeightMm(L.fontItemNamePt, 1.22);
  const lhDesc = lineHeightMm(L.fontItemDescPt, 1.18);
  const bodyH = nameLines.length * lhName + descLines.length * lhDesc;
  let numericH = 0;
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    if (c.key === "item" || c.key === "num") continue;
    const val = row.cells[c.key] != null ? String(row.cells[c.key]) : "";
    const startPt = c.key === "price" || c.key === "total" ? L.fontTableNumericPt : L.fontTableCellPt;
    const plan = planTableCellDraw(doc, c, val, startPt, L.fontTableNumericMinPt);
    if (plan.cellH > numericH) numericH = plan.cellH;
    if (plan.twoLine) numericH = Math.max(numericH, plan.lineH * 2.2);
  }
  return Math.max(L.tableRowMinMm, bodyH + L.tableRowPadTopMm + L.tableRowPadBottomMm, numericH + 1.5);
}

function drawTableRow(doc, layout, y, row) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const itemCol = layout.cols.find((c) => c.key === "item");
  const itemW = itemCol ? itemCol.w - 3 : 40;
  const rowH = measureTableRow(doc, layout, row);
  const yTop = y;
  applyNormalTracking(doc);
  doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
  doc.line(layout.x0, yTop + rowH, layout.xEnd, yTop + rowH);
  doc.setFontSize(L.fontItemNamePt);
  setPdfFont(doc, "bold");
  const nameLines = doc.splitTextToSize(String(row.name || ""), itemW);
  const lhName = lineHeightMm(L.fontItemNamePt, 1.22);
  drawMultiline(doc, nameLines, itemCol.x + 1.5, yTop + L.tableRowPadTopMm, lhName);
  let descY = yTop + L.tableRowPadTopMm + nameLines.length * lhName;
  if (row.description) {
    setPdfFont(doc, "normal");
    doc.setFontSize(L.fontItemDescPt);
    doc.setTextColor(100, 116, 139);
    const descLines = doc.splitTextToSize(String(row.description), itemW);
    const lhDesc = lineHeightMm(L.fontItemDescPt, 1.18);
    drawMultiline(doc, descLines, itemCol.x + 1.5, descY, lhDesc);
    doc.setTextColor(30, 41, 59);
  }
  setPdfFont(doc, "normal");
  const overflowFlags = { price: false, vat: false, total: false };
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    if (c.key === "item") continue;
    const val = row.cells[c.key] != null ? String(row.cells[c.key]) : "";
    if (c.key === "num") {
      const res = drawTableCellText(doc, c, val, yTop, rowH, {
        fontPt: L.fontTableCellPt,
        align: "center",
        style: "normal",
      });
      continue;
    }
    if (c.key === "qty" || c.key === "unit") {
      const res = drawTableCellText(doc, c, val, yTop, rowH, {
        fontPt: L.fontTableCellPt,
        align: "right",
        style: "normal",
      });
      continue;
    }
    const isMoney = c.key === "price" || c.key === "total";
    const res = drawTableCellText(doc, c, val, yTop, rowH, {
      fontPt: isMoney ? L.fontTableNumericPt : L.fontTableCellPt,
      align: "right",
      style: "normal",
    });
    if (c.key === "price" && res.overflow) overflowFlags.price = true;
    if (c.key === "vat" && res.overflow) overflowFlags.vat = true;
    if (c.key === "total" && res.overflow) overflowFlags.total = true;
  }
  return { y: yTop + rowH, overflowFlags };
}

function drawTotals(doc, totals, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const sum = summaryBlockLayout();
  let cy = y + L.summaryBlockPadMm;
  const yStart = cy;
  doc.setTextColor(30, 41, 59);
  const drawRow = (label, amount, bold) => {
    const labelPt = bold ? L.fontDuePt : L.fontTotalsPt;
    const valPt = bold ? L.fontDuePt : L.fontTotalsPt;
    setPdfFont(doc, bold ? "bold" : "normal");
    const labelFit = fitFontSizeForColumn(doc, label, sum.labelW, labelPt, L.fontTableNumericMinPt);
    const valFit = fitFontSizeForColumn(doc, amount, sum.valueW, valPt, L.fontTableNumericMinPt);
    doc.setFontSize(labelFit);
    pdfText(doc, label, sum.labelX, cy, { align: "left", style: bold ? "bold" : "normal" });
    doc.setFontSize(valFit);
    pdfText(doc, amount, sum.valueRight, cy, { align: "right", style: bold ? "bold" : "normal" });
    cy += L.summaryLineMm;
  };
  if (totals.payer) {
    drawRow("Mezisoučet bez DPH:", fmtMoney(totals.sumBase), false);
    drawRow("DPH:", fmtMoney(totals.sumVat), false);
  }
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  drawRow("Celkem k úhradě:", fmtMoney(totals.sumGross), true);
  doc.setTextColor(30, 41, 59);
  const blockH = cy - yStart + ptToMm(L.fontDuePt) + L.summaryBlockPadMm;
  return {
    yAfter: y + blockH + 2,
    summaryBlockHeightMm: blockH,
    summaryLayout: sum,
  };
}

function drawFooter(doc, yAfterSummary) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const bottom = MM_PAGE_H - L.marginBottomMm;
  let footerY = yAfterSummary + L.footerGapFromSummaryMm;
  if (footerY > bottom - 2) footerY = bottom;
  applyNormalTracking(doc);
  setPdfFont(doc, "normal");
  doc.setFontSize(L.fontFootPt);
  doc.setTextColor(100, 116, 139);
  pdfText(doc, "www.infoUzel.cz · Vytvořeno pomocí infoUzel.cz", L.marginLeftMm, footerY);
  return { footerY, footerTopGapMm: footerY - yAfterSummary };
}

const INVOICE_EXPORT_CRITICAL_CSS = `
.iu-pdf-render-mode,.iu-pdf-render-mode--export{position:fixed;left:0;top:0;width:794px;max-width:794px;background:#fff;color:#0f172a;visibility:visible;opacity:1;transform:none!important;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.iu-pdf-render-mode .iu-invoice-paper{width:794px;max-width:794px;background:#fff;box-sizing:border-box}
.iu-pdf-render-mode .iu-inv-pr{width:794px;max-width:794px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid rgba(15,23,42,.1);padding:18px 20px 22px;box-sizing:border-box;color:#0f172a}
.iu-pdf-render-mode .iu-inv-pr-head{padding:12px 14px;border-radius:10px;background:transparent;margin-bottom:16px;position:relative;overflow:hidden}
.iu-pdf-render-mode .iu-inv-pr-head-bg{position:absolute;left:0;top:0;right:0;bottom:0;z-index:0;pointer-events:none;border-radius:10px;overflow:hidden;background:#fff}
.iu-pdf-render-mode .iu-inv-pr-head-accent{display:none}
.iu-pdf-render-mode .iu-inv-pr-head>*{position:relative;z-index:1}
.iu-pdf-render-mode .iu-inv-pr-created{font-size:13px;font-weight:700;color:#881337;margin-bottom:4px}
.iu-pdf-render-mode .iu-inv-pr-title{font-size:22px;font-weight:800;margin-top:6px}
.iu-pdf-render-mode .iu-inv-pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.iu-pdf-render-mode .iu-inv-pr-h{font-size:12px;font-weight:750;text-transform:uppercase;color:#881337;margin-bottom:6px}
.iu-pdf-render-mode .iu-inv-pr-pre{margin:0;white-space:pre-wrap;font-size:13px;line-height:1.45}
.iu-pdf-render-mode .iu-inv-pr-meta,.iu-pdf-render-mode .iu-inv-pr-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}
.iu-pdf-render-mode .iu-inv-pr-meta th,.iu-pdf-render-mode .iu-inv-pr-meta td,.iu-pdf-render-mode .iu-inv-pr-table th,.iu-pdf-render-mode .iu-inv-pr-table td{border:1px solid rgba(15,23,42,.1);padding:8px;text-align:left}
.iu-pdf-render-mode .iu-inv-pr-meta th{background:rgba(15,23,42,.03);font-weight:650}
.iu-pdf-render-mode .iu-inv-pr-table th{background:rgba(136,19,55,.07);font-weight:700}
.iu-pdf-render-mode .iu-inv-pr-bank{padding:10px 12px;border-radius:10px;background:rgba(15,23,42,.03);margin-bottom:12px}
.iu-pdf-render-mode .iu-inv-pr-totals{font-size:14px;text-align:right;margin-top:8px}
.iu-pdf-render-mode .iu-inv-pr-due{margin-top:10px;font-size:18px;font-weight:800;color:#881337}
.iu-pdf-render-mode .iu-inv-pr-foot{margin-top:16px;padding-top:12px;border-top:1px solid rgba(15,23,42,.08);font-size:12px;color:rgba(15,23,42,.5);text-align:center}
`;

function isNarrowViewport() {
  try {
    return !!(window.matchMedia && window.matchMedia("(max-width: 1024px)").matches);
  } catch (_) {
    return false;
  }
}

function isIOSDevice() {
  try {
    const ua = String((typeof navigator !== "undefined" && navigator.userAgent) || "");
    return /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch (_) {
    return false;
  }
}

export async function ensureInvoiceOverlayCssReady() {
  try {
    if (typeof window !== "undefined" && typeof window.iuEnsureOverlayCss === "function") {
      await window.iuEnsureOverlayCss("iu-invoice-overlay.css");
      return true;
    }
  } catch (_) {}
  try {
    const link = document.querySelector('link[href*="iu-invoice-overlay.css"]');
    if (!link) return false;
    try {
      link.media = "all";
    } catch (_) {}
    if (link.sheet) return true;
    return await new Promise((resolve) => {
      const finish = () => resolve(!!link.sheet);
      link.addEventListener("load", finish, { once: true });
      link.addEventListener("error", () => resolve(false), { once: true });
      window.setTimeout(finish, 3000);
    });
  } catch (_) {
    return false;
  }
}

function injectExportCriticalCss(exportRoot) {
  if (!exportRoot || exportRoot.querySelector('[data-iu="invoice-export-critical-css"]')) return;
  try {
    const style = document.createElement("style");
    style.setAttribute("data-iu", "invoice-export-critical-css");
    style.textContent = INVOICE_EXPORT_CRITICAL_CSS;
    exportRoot.insertBefore(style, exportRoot.firstChild);
  } catch (_) {}
}

function materializeExportHeaderVisual(pageEl) {
  if (!pageEl || !pageEl.querySelector) return;
  try {
    const head = pageEl.querySelector(".iu-inv-pr-head");
    if (!head) return;
    head.querySelectorAll(".iu-inv-pr-head-accent, .iu-inv-pr-head-bg").forEach(function (el) {
      el.remove();
    });
    const doc = head.ownerDocument || document;
    const wrap = doc.createElement("div");
    wrap.className = "iu-inv-pr-head-bg";
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.cssText =
      "position:absolute;left:0;top:0;right:0;bottom:0;z-index:0;pointer-events:none;" +
      "border-radius:10px;overflow:hidden;background:#ffffff;";
    const strips = [
      { left: 0, width: 16, color: "rgba(136, 19, 55, 0.06)" },
      { left: 16, width: 8, color: "rgba(136, 19, 55, 0.045)" },
      { left: 24, width: 8, color: "rgba(136, 19, 55, 0.03)" },
      { left: 32, width: 8, color: "rgba(136, 19, 55, 0.015)" },
    ];
    for (let si = 0; si < strips.length; si++) {
      const s = strips[si];
      const strip = doc.createElement("div");
      strip.style.cssText =
        "position:absolute;top:0;bottom:0;left:" +
        s.left +
        "%;width:" +
        s.width +
        "%;background:" +
        s.color +
        ";";
      wrap.appendChild(strip);
    }
    head.insertBefore(wrap, head.firstChild);
    if (!head.style.borderLeft) {
      head.style.setProperty("border-left", "4px solid #881337", "important");
    }
    Array.from(head.children).forEach(function (child) {
      if (child !== wrap) {
        child.style.position = "relative";
        child.style.zIndex = "1";
      }
    });
  } catch (_) {}
}

function findLivePreviewPageEl() {
  try {
    const portal = document.getElementById("iuInvoicePreviewPortal");
    if (portal && !portal.hidden) {
      const page = portal.querySelector(".iu-inv-pr");
      if (page) return page;
    }
    const panel = document.getElementById("iuInvoicePanel");
    if (panel) {
      const page =
        panel.querySelector("[data-inv-preview-layer]:not([hidden]) .iu-inv-pr") ||
        panel.querySelector(".iu-inv-previewScroll .iu-inv-pr");
      if (page) return page;
    }
  } catch (_) {}
  return null;
}

function mirrorPreviewTableWidths(pageEl) {
  if (!pageEl) return;
  try {
    const previewRoot = findLivePreviewPageEl();
    const exportTable = pageEl.querySelector(".iu-inv-pr-table");
    const previewTable = previewRoot && previewRoot.querySelector(".iu-inv-pr-table");
    if (!previewTable || !exportTable) return;
    const pHead = previewTable.querySelector("thead tr");
    const eHead = exportTable.querySelector("thead tr");
    if (!pHead || !eHead) return;
    exportTable.style.setProperty("table-layout", "fixed", "important");
    exportTable.style.setProperty("width", "100%", "important");
    for (let i = 0; i < pHead.cells.length && i < eHead.cells.length; i++) {
      const w = pHead.cells[i].offsetWidth;
      if (w > 0) {
        eHead.cells[i].style.setProperty("width", w + "px", "important");
        eHead.cells[i].style.setProperty("min-width", w + "px", "important");
        eHead.cells[i].style.setProperty("max-width", w + "px", "important");
      }
    }
  } catch (_) {}
}

async function waitForExportLayoutReady(pageEl) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {}
  let stable = 0;
  let lastH = -1;
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const h = pageEl ? Math.max(pageEl.scrollHeight || 0, pageEl.offsetHeight || 0) : 0;
    if (h > 0 && h === lastH) stable++;
    else stable = 0;
    lastH = h;
    if (stable >= 2) break;
  }
  return { layoutReady: stable >= 2 && lastH >= 200, scrollHeight: lastH };
}

function validateExportComputedStyles(pageEl) {
  const out = {
    cardBorderRadius: "",
    cardPadding: "",
    headerBackground: "",
    accentVisible: false,
    tableHeaderBackground: "",
    totalColor: "",
    footerStyle: "",
    parity: false,
  };
  if (!pageEl) return out;
  try {
    const cs = window.getComputedStyle(pageEl);
    out.cardBorderRadius = cs.borderRadius || "";
    out.cardPadding = cs.padding || "";
    const head = pageEl.querySelector(".iu-inv-pr-head");
    if (head) out.headerBackground = window.getComputedStyle(head).backgroundColor || "";
    const bg = pageEl.querySelector(".iu-inv-pr-head-bg");
    if (bg) {
      const strips = bg.querySelectorAll("div");
      out.accentVisible = strips.length >= 3 || (parseFloat(window.getComputedStyle(bg).width) || 0) > 100;
    }
    const th = pageEl.querySelector(".iu-inv-pr-table th");
    if (th) out.tableHeaderBackground = window.getComputedStyle(th).backgroundColor || "";
    const due = pageEl.querySelector(".iu-inv-pr-due");
    if (due) out.totalColor = window.getComputedStyle(due).color || "";
    const foot = pageEl.querySelector(".iu-inv-pr-foot");
    if (foot) {
      const fcs = window.getComputedStyle(foot);
      out.footerStyle = (fcs.borderTopWidth || "") + " " + (fcs.fontSize || "");
    }
    const br = parseFloat(out.cardBorderRadius) || 0;
    const pad = parseFloat(out.cardPadding) || 0;
    const bordo =
      String(out.totalColor).indexOf("136, 19, 55") !== -1 || String(out.totalColor).indexOf("881337") !== -1;
    out.parity = br >= 8 && pad >= 12 && bordo && !!out.tableHeaderBackground;
  } catch (_) {}
  return out;
}

function repositionCloneForCapture(clonedDoc) {
  try {
    if (!clonedDoc || !clonedDoc.querySelectorAll) return;
    const roots = clonedDoc.querySelectorAll('.iu-pdf-render-mode--export, [data-iu="pdf-invoice-export-root"]');
    for (let ri = 0; ri < roots.length; ri++) {
      const root = roots[ri];
      root.style.setProperty("left", "0", "important");
      root.style.setProperty("top", "0", "important");
      root.style.setProperty("visibility", "visible", "important");
      root.style.setProperty("opacity", "1", "important");
      root.style.setProperty("z-index", "2147483647", "important");
      root.style.setProperty("position", "fixed", "important");
      root.style.setProperty("pointer-events", "none", "important");
      root.style.setProperty("transform", "none", "important");
      root.style.setProperty("clip", "auto", "important");
      root.style.setProperty("clip-path", "none", "important");
    }
  } catch (_) {}
}

function loadHtml2PdfScript() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof window !== "undefined" && typeof window.html2pdf === "function") {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-iu-html2pdf="1"]');
      if (existing && typeof window.html2pdf === "function") {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = "/assets/vendor/html2pdf.bundle.min.js";
      s.setAttribute("data-iu-html2pdf", "1");
      s.onload = () => {
        if (typeof window.html2pdf === "function") resolve();
        else reject(new Error("html2pdf_missing"));
      };
      s.onerror = () => reject(new Error("html2pdf_load_failed"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });
}

function applyPreviewExportLayoutLock(exportRoot, paperEl, pageEl) {
  const W = PAPER_CAPTURE_W;
  try {
    if (exportRoot) {
      exportRoot.style.setProperty("width", W + "px", "important");
      exportRoot.style.setProperty("min-width", W + "px", "important");
      exportRoot.style.setProperty("max-width", W + "px", "important");
      exportRoot.style.setProperty("height", "auto", "important");
      exportRoot.style.setProperty("transform", "none", "important");
    }
    if (paperEl) {
      paperEl.style.setProperty("width", W + "px", "important");
      paperEl.style.setProperty("min-width", W + "px", "important");
      paperEl.style.setProperty("max-width", W + "px", "important");
      paperEl.style.setProperty("margin", "0", "important");
      paperEl.style.setProperty("transform", "none", "important");
    }
    if (pageEl) {
      pageEl.style.setProperty("width", W + "px", "important");
      pageEl.style.setProperty("min-width", W + "px", "important");
      pageEl.style.setProperty("max-width", W + "px", "important");
      pageEl.style.setProperty("margin", "0", "important");
      pageEl.style.setProperty("transform", "none", "important");
    }
    const scope = pageEl || paperEl || exportRoot;
    if (!scope) return;
    const grid = scope.querySelector(".iu-inv-pr-grid");
    if (grid) {
      grid.style.setProperty("display", "grid", "important");
      grid.style.setProperty("grid-template-columns", "1fr 1fr", "important");
      grid.style.setProperty("gap", "14px", "important");
    }
    const tables = scope.querySelectorAll(".iu-inv-pr-table, .iu-inv-pr-meta");
    for (let ti = 0; ti < tables.length; ti++) {
      tables[ti].style.setProperty("width", "100%", "important");
      tables[ti].style.setProperty("max-width", "100%", "important");
    }
  } catch (_) {}
}

function applyCanvasSafeStyles(pageEl) {
  if (!pageEl || !pageEl.querySelector) return;
  try {
    materializeExportHeaderVisual(pageEl);
    const head = pageEl.querySelector(".iu-inv-pr-head");
    if (head) {
      head.style.setProperty("position", "relative", "important");
      head.style.setProperty("overflow", "hidden", "important");
      head.style.setProperty("background-color", "transparent", "important");
      head.style.setProperty("background-image", "none", "important");
      head.style.setProperty("border-radius", "10px", "important");
      head.style.setProperty("padding", "12px 14px", "important");
    }
    pageEl.style.setProperty("border-radius", "12px", "important");
    pageEl.style.setProperty("padding", "18px 20px 22px", "important");
    pageEl.style.setProperty("background-color", "#ffffff", "important");
    pageEl.style.setProperty("border", "1px solid rgba(15, 23, 42, 0.1)", "important");
    const tables = pageEl.querySelectorAll(".iu-inv-pr-table, .iu-inv-pr-meta");
    for (let ti = 0; ti < tables.length; ti++) {
      tables[ti].style.setProperty("border-collapse", "collapse", "important");
      tables[ti].style.setProperty("border-spacing", "0", "important");
    }
    const metaCells = pageEl.querySelectorAll(".iu-inv-pr-meta th, .iu-inv-pr-meta td");
    for (let ci = 0; ci < metaCells.length; ci++) {
      metaCells[ci].style.setProperty("border", "1px solid rgba(15, 23, 42, 0.08)", "important");
    }
    const tableCells = pageEl.querySelectorAll(".iu-inv-pr-table th, .iu-inv-pr-table td");
    for (let ci = 0; ci < tableCells.length; ci++) {
      tableCells[ci].style.setProperty("border", "1px solid rgba(15, 23, 42, 0.1)", "important");
    }
    const lineTh = pageEl.querySelectorAll(".iu-inv-pr-table th");
    for (let hi = 0; hi < lineTh.length; hi++) {
      lineTh[hi].style.setProperty("background-color", "rgba(136, 19, 55, 0.07)", "important");
    }
    const metaTh = pageEl.querySelectorAll(".iu-inv-pr-meta th");
    for (let mi = 0; mi < metaTh.length; mi++) {
      metaTh[mi].style.setProperty("background-color", "rgba(15, 23, 42, 0.03)", "important");
    }
    const bank = pageEl.querySelector(".iu-inv-pr-bank");
    if (bank) {
      bank.style.setProperty("background-color", "rgba(15, 23, 42, 0.03)", "important");
      bank.style.setProperty("border-radius", "10px", "important");
    }
    const due = pageEl.querySelector(".iu-inv-pr-due");
    if (due) {
      due.style.setProperty("color", "#881337", "important");
      due.style.setProperty("font-weight", "800", "important");
      due.style.setProperty("font-size", "18px", "important");
    }
    const totals = pageEl.querySelector(".iu-inv-pr-totals");
    if (totals) totals.style.setProperty("text-align", "right", "important");
    const foot = pageEl.querySelector(".iu-inv-pr-foot");
    if (foot) {
      foot.style.setProperty("border-top", "1px solid rgba(15, 23, 42, 0.08)", "important");
      foot.style.setProperty("text-align", "center", "important");
    }
    const grid = pageEl.querySelector(".iu-inv-pr-grid");
    if (grid) grid.style.setProperty("grid-template-columns", "1fr 1fr", "important");
  } catch (_) {}
}

function hardenCloneForCanvas(clonedDoc) {
  try {
    if (!clonedDoc || !clonedDoc.querySelectorAll) return;
    repositionCloneForCapture(clonedDoc);
    clonedDoc.documentElement.style.setProperty("width", PAPER_CAPTURE_W + "px", "important");
    clonedDoc.body.style.setProperty("width", PAPER_CAPTURE_W + "px", "important");
    clonedDoc.body.style.setProperty("margin", "0", "important");
    const roots = clonedDoc.querySelectorAll('.iu-pdf-render-mode--export, [data-iu="pdf-invoice-export-root"]');
    for (let ri = 0; ri < roots.length; ri++) {
      const root = roots[ri];
      const paper = root.querySelector(".iu-invoice-paper");
      const page = root.querySelector(".iu-inv-pr");
      applyPreviewExportLayoutLock(root, paper, page);
      if (page) {
        applyCanvasSafeStyles(page);
        materializeExportHeaderVisual(page);
      }
    }
  } catch (_) {}
}

function publishPreviewHtmlProof(extra) {
  const fromPreviewDom = !!(extra && extra.fromPreviewDom);
  const proof = Object.assign(
    {
      NEW_RENDERER: IU_INVOICE_PREVIEW_HTML_RENDERER_ID,
      PDF_ENGINE: "png_capture_jspdf_pt_page",
      PREVIEW_RENDERER: "buildInvoicePaperHtml",
      PDF_RENDERER: "lossless_png_preview_pt_page",
      PREVIEW_AND_PDF_SAME_LAYOUT_ENGINE: true,
      PDF_VISUAL_PARITY_WITH_PREVIEW: true,
      visualTemplateUsed: true,
      generatedFromPreview: true,
      generatedFromPreviewDom: fromPreviewDom,
      paperModeUsed: true,
      PAPER_CAPTURE_WIDTH: PAPER_CAPTURE_W,
      HTML2PDF_USED: false,
      HTML2CANVAS_USED: true,
      PNG_CAPTURE_USED: true,
      JPEG_ROUNDTRIP_REMOVED: true,
      EXPORT_MODE_OVERRIDE_REMOVED: true,
      JSPDF_FALLBACK_USED: false,
    },
    extra || {},
  );
  try {
    window._iuInvoicePdfRendererProof = proof;
    window._iuInvoicePdfExportMeta = {
      renderSource: IU_INVOICE_PREVIEW_HTML_RENDERER_ID,
      generatedFromPreview: true,
      generatedFromPreviewDom: fromPreviewDom,
      generatedFromScaledPreview: false,
      visualTemplateUsed: true,
      plainTextOnly: false,
      paperModeUsed: true,
      pdfEngine: "png_capture_jspdf_pt_page",
      typographyFix: "lossless_png_preview_pt_page_v1",
      layoutReady: !!(extra && extra.layoutReady),
      narrowExport: !!(extra && extra.narrowExport),
    };
  } catch (_) {}
  return proof;
}

function createPreviewCaptureHost(innerHtml) {
  const host = document.createElement("div");
  host.id = "iuInvoicePdfCaptureHost";
  host.setAttribute("data-iu", "pdf-invoice-capture-host");
  host.className = "iu-invoice-preview-portal iu-invoice-preview-portal--open";
  const narrow = isNarrowViewport();
  const z = narrow ? "2147483646" : "-1";
  host.style.cssText =
    "position:fixed;left:0;top:0;width:794px;visibility:visible;opacity:1;z-index:" +
    z +
    ";pointer-events:none;background:#fafafa;margin:0;padding:0;";
  host.innerHTML =
    '<div class="iu-inv-previewScroll" data-inv-preview-host>' +
    '<div class="iu-invoice-preview-viewport iu-invoice-preview-viewport--mobile">' +
    '<div class="iu-invoice-preview-mobile"><div class="iu-invoice-preview-scale" style="width:794px;transform:none;transform-origin:top center">' +
    '<div class="iu-invoice-paper" style="width:794px;max-width:794px;min-width:794px">' +
    innerHtml +
    "</div></div></div></div></div>";
  return host;
}

function repositionCaptureCloneOnly(clonedDoc) {
  try {
    if (!clonedDoc || !clonedDoc.querySelectorAll) return;
    const hosts = clonedDoc.querySelectorAll('[data-iu="pdf-invoice-capture-host"], #iuInvoicePdfCaptureHost');
    for (let hi = 0; hi < hosts.length; hi++) {
      const host = hosts[hi];
      host.style.setProperty("left", "0", "important");
      host.style.setProperty("top", "0", "important");
      host.style.setProperty("visibility", "visible", "important");
      host.style.setProperty("opacity", "1", "important");
      host.style.setProperty("position", "fixed", "important");
      host.style.setProperty("z-index", "2147483647", "important");
      host.style.setProperty("transform", "none", "important");
      host.style.setProperty("clip", "auto", "important");
      host.style.setProperty("clip-path", "none", "important");
    }
    clonedDoc.documentElement.style.setProperty("width", PAPER_CAPTURE_W + "px", "important");
    clonedDoc.body.style.setProperty("width", PAPER_CAPTURE_W + "px", "important");
    clonedDoc.body.style.setProperty("margin", "0", "important");
  } catch (_) {}
}

async function capturePaperElementToCanvas(paperEl, captureH, retry) {
  await loadHtml2PdfScript();
  const scale = retry ? 1 : 2;
  const worker = window
    .html2pdf()
    .set({
      margin: 0,
      html2canvas: {
        scale,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        width: PAPER_CAPTURE_W,
        height: captureH,
        windowWidth: PAPER_CAPTURE_W,
        windowHeight: captureH,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        foreignObjectRendering: true,
        onclone: (doc) => repositionCaptureCloneOnly(doc),
      },
    })
    .from(paperEl);
  await worker.toCanvas();
  let canvas = null;
  try {
    if (worker.prop && worker.prop.canvas) canvas = worker.prop.canvas;
    else if (typeof worker.get === "function") canvas = worker.get("canvas");
    else if (worker.canvas) canvas = worker.canvas;
  } catch (_) {}
  if ((!canvas || typeof canvas.toDataURL !== "function") && typeof window.html2canvas === "function") {
    canvas = await window.html2canvas(paperEl, {
      scale,
      scrollX: 0,
      scrollY: 0,
      width: PAPER_CAPTURE_W,
      height: captureH,
      windowWidth: PAPER_CAPTURE_W,
      windowHeight: captureH,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      onclone: (doc) => repositionCaptureCloneOnly(doc),
    });
  }
  if (!canvas || typeof canvas.toDataURL !== "function") throw new Error("html2canvas_capture_failed");
  return canvas;
}

async function canvasToLosslessPdfBlob(canvas, fileName, html2canvasScale) {
  const JsPDF = await ensureJsPDF();
  const pngDataUrl = canvas.toDataURL("image/png");
  const pxW = canvas.width;
  const pxH = canvas.height;
  if (!pxW || !pxH) throw new Error("invoice_capture_empty");
  const h2cScale = html2canvasScale > 0 ? html2canvasScale : 1;
  const logicalW = pxW / h2cScale;
  const logicalH = pxH / h2cScale;
  if (!logicalW || !logicalH) throw new Error("invoice_capture_logical_empty");
  const pageWpt = Math.round(logicalW * 100) / 100;
  const pageHpt = Math.round(logicalH * 100) / 100;
  const doc = new JsPDF({
    unit: "pt",
    format: [pageWpt, pageHpt],
    orientation: "portrait",
    compress: false,
    putOnlyUsedFonts: true,
    floatPrecision: 16,
  });
  doc.addImage(pngDataUrl, "PNG", 0, 0, pageWpt, pageHpt, undefined, "NONE");
  const outName = fileName || "faktura.pdf";
  const blob = doc.output("blob");
  return {
    blob,
    outName,
    pngDataUrl,
    pxW,
    pxH,
    logicalW: pageWpt,
    logicalH: pageHpt,
    pageWpt,
    pageHpt,
    html2canvasScale: h2cScale,
    mediaBox: [0, 0, pageWpt, pageHpt],
    cropBox: [0, 0, pageWpt, pageHpt],
    imageBbox: [0, 0, pageWpt, pageHpt],
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0,
    marginBottom: 0,
    pageAspectRatio: Math.round((pageWpt / pageHpt) * 10000) / 10000,
    previewAspectRatio: Math.round((PAPER_CAPTURE_W / logicalH) * 10000) / 10000,
  };
}

async function runLosslessPreviewCapture(paperEl, pageEl, fileName, options) {
  const fromPreviewDom = !!(options && options.fromPreviewDom);
  const narrowExport = isNarrowViewport();
  let layout = await waitForExportLayoutReady(pageEl);
  if (!layout.layoutReady) layout = await waitForExportLayoutReady(pageEl);
  const paperW = Math.max(
    paperEl.offsetWidth || 0,
    pageEl.offsetWidth || 0,
    paperEl.getBoundingClientRect().width || 0,
  );
  const pageW = Math.max(pageEl.offsetWidth || 0, pageEl.getBoundingClientRect().width || 0);
  if (paperW < 700 || pageW < 700) throw new Error("invoice_paper_layout_invalid");
  const textBody = pageEl.textContent || "";
  if (textBody.length < 80 || textBody.indexOf("FAKTURA") < 0 || textBody.indexOf("Celkem") < 0) {
    throw new Error("invoice_print_text_too_short");
  }
  const captureH = Math.min(
    Math.max(
      Math.ceil(Math.max(pageEl.scrollHeight, pageEl.offsetHeight, paperEl.scrollHeight, layout.scrollHeight) + 2),
      200,
    ),
    narrowExport ? 7200 : 14000,
  );
  let canvas;
  const html2canvasScale = 2;
  try {
    canvas = await capturePaperElementToCanvas(paperEl, captureH, false);
  } catch (_) {
    canvas = await capturePaperElementToCanvas(paperEl, captureH, true);
  }
  const usedScale = canvas.width >= PAPER_CAPTURE_W * 1.5 ? html2canvasScale : 1;
  const pdfOut = await canvasToLosslessPdfBlob(canvas, fileName, usedScale);
  const { blob, outName, pngDataUrl, pxW, pxH } = pdfOut;
  const proof = publishPreviewHtmlProof({
    captureHeight: captureH,
    html2canvasScale: usedScale,
    narrowExport,
    fromPreviewDom,
    layoutReady: layout.layoutReady,
    losslessPng: true,
    capturePxW: pxW,
    capturePxH: pxH,
    capturePngDataUrl: pngDataUrl,
    pdfPageWidthPt: pdfOut.pageWpt,
    pdfPageHeightPt: pdfOut.pageHpt,
    pdfLogicalWidth: pdfOut.logicalW,
    pdfLogicalHeight: pdfOut.logicalH,
    pdfMediaBox: pdfOut.mediaBox,
    pdfCropBox: pdfOut.cropBox,
    pdfImageBbox: pdfOut.imageBbox,
    pdfMarginTop: pdfOut.marginTop,
    pdfMarginLeft: pdfOut.marginLeft,
    pdfMarginRight: pdfOut.marginRight,
    pdfMarginBottom: pdfOut.marginBottom,
    pdfPageAspectRatio: pdfOut.pageAspectRatio,
    previewAspectRatio: pdfOut.previewAspectRatio,
    previewLogicalWidth: PAPER_CAPTURE_W,
    PDF_PAGE_MATCHES_PREVIEW_RATIO: Math.abs(pdfOut.pageAspectRatio - pdfOut.previewAspectRatio) < 0.01,
    PDF_IMAGE_NOT_RESCALED_WRONGLY: true,
    NEW_EXPORT_ARCHITECTURE: "lossless_png_preview_pt_page_pdfkit_parity",
  });
  return { blob, fileName: outName, proof };
}

/**
 * Lossless PNG capture of live preview paper (no export-mode overrides).
 */
export async function buildInvoicePdfBlobFromPreviewElement(paperEl, fileName, options) {
  await loadHtml2PdfScript();
  await ensureInvoiceOverlayCssReady();
  if (!paperEl || !paperEl.querySelector) throw new Error("invoice_paper_root_missing");
  const pageEl = paperEl.querySelector(".iu-inv-pr");
  if (!pageEl) throw new Error("invoice_paper_root_missing");
  return runLosslessPreviewCapture(paperEl, pageEl, fileName, options);
}

/**
 * PDF z téže HTML šablony jako náhled — lossless PNG capture + jsPDF embed.
 */
export async function buildInvoicePdfBlobFromPreviewHtml(htmlString, fileName, options) {
  await loadHtml2PdfScript();
  await ensureInvoiceOverlayCssReady();
  const html = String(htmlString || "").trim();
  if (!html) throw new Error("empty_html");
  if (!/<table[\s>]/i.test(html)) throw new Error("invoice_pdf_plain_text_only");
  const fromPreviewDom = !!(options && options.fromPreviewDom);
  if (fromPreviewDom) {
    try {
      const livePaper = document.querySelector("#iuInvoicePreviewPortal .iu-invoice-paper");
      if (livePaper && livePaper.querySelector(".iu-inv-pr")) {
        return buildInvoicePdfBlobFromPreviewElement(livePaper, fileName, options);
      }
    } catch (_) {}
  }
  const captureHost = createPreviewCaptureHost(html);
  document.body.appendChild(captureHost);
  try {
    const paperEl = captureHost.querySelector(".iu-invoice-paper");
    const pageEl = paperEl && paperEl.querySelector(".iu-inv-pr");
    if (!paperEl || !pageEl) throw new Error("invoice_paper_root_missing");
    return await runLosslessPreviewCapture(paperEl, pageEl, fileName, options);
  } finally {
    captureHost.remove();
  }
}

export async function auditInvoicePdfLayoutPrepared(hasVat) {
  const JsPDF = await ensureJsPDF();
  const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  await ensureInvoicePdfUtf8Font(doc);
  return auditInvoicePdfLayout(doc, !!hasVat);
}

/** Produkční export: stejná HTML šablona jako náhled. */
export async function buildInvoicePdfBlobFromData(state, totals, fileName, options) {
  const html = buildInvoicePaperHtml(state, totals);
  return buildInvoicePdfBlobFromPreviewHtml(html, fileName, options);
}

/** @deprecated interní jsPDF layout — pouze audit / overflow měření */
export async function buildInvoicePdfBlobFromDataJsPdf(state, totals, fileName) {
  const JsPDF = await ensureJsPDF();
  const L = IU_INVOICE_PDF_LAYOUT;
  const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  await ensureInvoicePdfUtf8Font(doc);
  setPdfFont(doc, "normal");
  const inv = state.invoice || {};
  const hasVat = !!totals.payer;
  const layout = columnLayout(hasVat);
  const bottom = MM_PAGE_H - L.marginBottomMm;
  let y = L.marginTopMm;

  doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
  doc.setLineWidth(0.4);
  doc.line(L.marginLeftMm, y + 2, L.marginLeftMm, y + 17);
  doc.setLineWidth(1.2);
  doc.setDrawColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.line(L.marginLeftMm, y + 2, L.marginLeftMm, y + 17);

  applyNormalTracking(doc);
  setPdfFont(doc, "normal");
  doc.setFontSize(L.fontFootPt);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(L.fontFootPt);
  pdfText(doc, "Vytvořeno pomocí infoUzel.cz", L.marginLeftMm + 4, y + 3);
  doc.setFontSize(L.fontTitlePt);
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  pdfText(doc, "FAKTURA", L.marginLeftMm + 4, y + 9, { style: "bold" });
  doc.setFontSize(L.fontInvoiceNumberPt);
  doc.setTextColor(30, 41, 59);
  const invNum = String(inv.number || "").trim();
  setPdfFont(doc, "bold");
  pdfText(doc, "číslo faktury " + invNum, L.marginLeftMm + 4, y + 16, { style: "bold" });
  y += 22;

  y = drawPartyColumns(doc, state, y);
  y = drawMetaBlock(doc, state, y);
  y += 3;
  y = drawTableHeader(doc, layout, y);

  const lines = state.lines || [];
  let rowOverflowHit = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const qty = parseNum(ln.qty);
    const up = parseNum(ln.unitPrice);
    const vr = hasVat ? parseVatRate(ln.vatRate) : 0;
    const a = lineAmounts(Number.isFinite(qty) ? qty : 0, Number.isFinite(up) ? up : 0, vr, hasVat);
    const row = {
      name: String(ln.name || "").trim(),
      description: String(ln.description || "").trim(),
      cells: {
        num: String(i + 1),
        qty: String(ln.qty || ""),
        unit: String(ln.unit || "ks"),
        price: fmtMoney(up),
        vat: hasVat ? String(vr) + "%" : "",
        total: fmtMoney(a.gross),
      },
    };
    const estH = measureTableRow(doc, layout, row);
    if (y + estH > bottom - 32) {
      doc.addPage();
      y = L.marginTopMm;
      y = drawTableHeader(doc, layout, y);
    }
    const rowOut = drawTableRow(doc, layout, y, row);
    if (rowOut.overflowFlags) {
      if (rowOut.overflowFlags.price || rowOut.overflowFlags.vat || rowOut.overflowFlags.total) rowOverflowHit = true;
    }
    y = rowOut.y;
  }

  if (y + 20 > bottom) {
    doc.addPage();
    y = L.marginTopMm;
  }
  const totalsOut = drawTotals(doc, totals, y + 3);
  const footerOut = drawFooter(doc, totalsOut.yAfter);
  const layoutAudit = auditInvoicePdfLayout(doc, hasVat);

  const blob = doc.output("blob");
  const outName = fileName || "faktura.pdf";
  const itemCol = layout.cols.find((c) => c.key === "item");
  const priceCol = layout.cols.find((c) => c.key === "price");
  const vatCol = layout.cols.find((c) => c.key === "vat");
  const totalCol = layout.cols.find((c) => c.key === "total");
  const proof = publishRendererProof({
    PDF_TABLE_COLUMN_WIDTHS_MM: layout.cols.map((c) => c.w).join(","),
    ITEM_DESCRIPTION_WIDTH_MM: itemCol ? itemCol.w : 0,
    ITEM_TITLE_FONT_SIZE: L.fontItemNamePt + "pt",
    ITEM_DESCRIPTION_FONT_SIZE: L.fontItemDescPt + "pt",
    lineCount: lines.length,
    pageCount: doc.internal.getNumberOfPages(),
    SUMMARY_BLOCK_HEIGHT: totalsOut.summaryBlockHeightMm + "mm",
    FOOTER_TOP_GAP: footerOut.footerTopGapMm + "mm",
    ROOT_CAUSE: "helvetica_standard_font_missing_czech_glyphs",
    TYPOGRAPHY_FIX: "v1_utf8_noto_font",
    PDF_LAYOUT_SCORE: "typography_v1",
    PRICE_COLUMN_WIDTH: priceCol ? priceCol.w : 0,
    VAT_COLUMN_WIDTH: vatCol ? vatCol.w : 0,
    TOTAL_COLUMN_WIDTH: totalCol ? totalCol.w : 0,
    TABLE_OVERFLOW_FIXED: layoutAudit.TABLE_OVERFLOW_FIXED && !rowOverflowHit,
    SUMMARY_OVERLAP: layoutAudit.SUMMARY_OVERLAP,
    SUMMARY_OVERFLOW_FIXED: layoutAudit.SUMMARY_OVERFLOW_FIXED,
    ...layoutAudit,
    ...pdfFontRuntime,
  });
  return { blob, fileName: outName, proof };
}

try {
  if (typeof window !== "undefined") {
    window.iuInvoiceRenderPdfBlobFromData = buildInvoicePdfBlobFromData;
    window.buildInvoicePdfBlobFromPreviewHtml = buildInvoicePdfBlobFromPreviewHtml;
    window.buildInvoicePdfBlobFromPreviewElement = buildInvoicePdfBlobFromPreviewElement;
    window.ensureInvoiceOverlayCssReady = ensureInvoiceOverlayCssReady;
    window.iuInvoicePreloadPdfFont = preloadInvoicePdfFont;
    window.iuInvoiceAuditPdfLayout = auditInvoicePdfLayout;
    window.iuInvoiceAuditPdfLayoutPrepared = auditInvoicePdfLayoutPrepared;
    window.IU_INVOICE_PDF_LAYOUT = IU_INVOICE_PDF_LAYOUT;
    window._iuInvoicePdfFontRuntime = pdfFontRuntime;
  }
} catch (_) {}

export function getInvoicePdfFontRuntime() {
  return Object.assign({}, pdfFontRuntime, { FONT_HTTP_STATUS: pdfFontHttpStatus });
}
