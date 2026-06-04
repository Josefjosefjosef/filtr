/**
 * infoUzel.cz — deterministický PDF renderer faktury (jsPDF, A4).
 * Nezávislý na html2canvas / mobilním náhledu; stejná invoice data.
 */
import {
  buyerBlockText,
  lineAmounts,
  parseNum,
  parseVatRate,
  supplierBlockText,
} from "./iu-invoice-engine.js";

export const IU_INVOICE_PDF_RENDERER_ID = "iu-invoice-pdf-renderer-v1";

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
  fontTotalsPt: 9.5,
  fontDuePt: 10.5,
  fontFootPt: 8,
  summaryLabelValueGapMm: 14,
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
  if (!res.ok) throw new Error("invoice_pdf_font_fetch_failed:" + res.status);
  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength < 10000) throw new Error("invoice_pdf_font_empty");
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
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
    try {
      doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "normal", "Identity-H");
      doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "bold", "Identity-H");
    } catch (_) {
      doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "normal");
      doc.addFont(IU_INV_PDF_FONT_FILE, IU_INV_PDF_FONT, "bold");
    }
  }
}

function assertUtf8FontMetrics(doc) {
  setPdfFont(doc, "normal");
  doc.setFontSize(10);
  const wWord = doc.getTextWidth("číslo");
  const wAscii = doc.getTextWidth("cislo");
  if (!Number.isFinite(wWord) || wWord < 6) throw new Error("invoice_pdf_utf8_metrics_fail");
  const perChar = wWord / 5;
  if (perChar > 8) throw new Error("invoice_pdf_utf8_spacing_fail");
}

async function ensureInvoicePdfUtf8Font(doc) {
  const b64 = await preloadInvoicePdfFont();
  registerInvoicePdfFontOnDoc(doc, b64);
  setPdfFont(doc, "normal");
  assertUtf8FontMetrics(doc);
}

function setPdfFont(doc, style) {
  doc.setFont(IU_INV_PDF_FONT, style === "bold" ? "bold" : "normal");
  applyNormalTracking(doc);
}

function columnLayout(hasVat) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const x0 = L.marginLeftMm;
  const xEnd = MM_PAGE_W - L.marginRightMm;
  const inner = xEnd - x0;
  if (hasVat) {
    const wNum = 7;
    const wQty = 12;
    const wUnit = 12;
    const wPrice = 18;
    const wVat = 10;
    const wTotal = 18;
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
  const wNum = 7;
  const wQty = 14;
  const wUnit = 14;
  const wPrice = 22;
  const wTotal = 22;
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

function publishRendererProof(extra) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const typo = {
    TYPOGRAPHY_FIX: "v1_utf8_noto_font",
    PDF_CHAR_SPACING: 0,
    PDF_LETTER_SPACING: L.letterSpacingPt,
    PDF_TEXT_RENDER_MODE: "fill",
    PDF_FONT_ENGINE: "noto-utf8-vfs-identity-h",
    PDF_FONT_LOAD_OK: pdfFontLoadOk,
    TEXT_SPACING_FIXED: true,
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
  doc.setFontSize(L.fontTableHeadPt);
  doc.setTextColor(255, 255, 255);
  const midY = yTop + h / 2 + ptToMm(L.fontTableHeadPt) * 0.35;
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    if (c.key === "item") {
      pdfText(doc, c.label, c.x + 1.5, midY);
    } else if (c.key === "num") {
      pdfText(doc, c.label, c.x + c.w / 2, midY, { align: "center" });
    } else {
      pdfText(doc, c.label, c.x + c.w - 1.5, midY, { align: "right" });
    }
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
  return Math.max(L.tableRowMinMm, bodyH + L.tableRowPadTopMm + L.tableRowPadBottomMm);
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
  doc.setFontSize(L.fontTableCellPt);
  const midY = yTop + rowH / 2;
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    if (c.key === "item") continue;
    const val = row.cells[c.key] != null ? String(row.cells[c.key]) : "";
    if (c.key === "num") {
      pdfText(doc, val, c.x + c.w / 2, midY, { align: "center" });
    } else {
      pdfText(doc, val, c.x + c.w - 1.5, midY, { align: "right" });
    }
  }
  return yTop + rowH;
}

function drawTotals(doc, totals, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const valueX = MM_PAGE_W - L.marginRightMm;
  const labelX = valueX - L.summaryLabelValueGapMm;
  let cy = y + L.summaryBlockPadMm;
  const yStart = cy;
  doc.setFontSize(L.fontTotalsPt);
  doc.setTextColor(30, 41, 59);
  const drawRow = (label, amount, bold) => {
    doc.setFontSize(bold ? L.fontDuePt : L.fontTotalsPt);
    pdfText(doc, label, labelX, cy, { align: "right", style: bold ? "bold" : "normal" });
    pdfText(doc, amount, valueX, cy, { align: "right", style: bold ? "bold" : "normal" });
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

/**
 * @param {object} state
 * @param {object} totals from computeTotals
 * @param {string} [fileName]
 * @returns {Promise<{ blob: Blob, fileName: string, proof: object }>}
 */
export async function buildInvoicePdfBlobFromData(state, totals, fileName) {
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
  pdfText(doc, "číslo faktury", L.marginLeftMm + 4, y + 16);
  setPdfFont(doc, "bold");
  pdfText(doc, invNum, L.marginLeftMm + 4 + doc.getTextWidth("číslo faktury ") + 0.5, y + 16, { style: "bold" });
  y += 22;

  y = drawPartyColumns(doc, state, y);
  y = drawMetaBlock(doc, state, y);
  y += 3;
  y = drawTableHeader(doc, layout, y);

  const lines = state.lines || [];
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
    y = drawTableRow(doc, layout, y, row);
  }

  if (y + 20 > bottom) {
    doc.addPage();
    y = L.marginTopMm;
  }
  const totalsOut = drawTotals(doc, totals, y + 3);
  const footerOut = drawFooter(doc, totalsOut.yAfter);

  const blob = doc.output("blob");
  const outName = fileName || "faktura.pdf";
  const itemCol = layout.cols.find((c) => c.key === "item");
  const proof = publishRendererProof({
    PDF_TABLE_COLUMN_WIDTHS_MM: layout.cols.map((c) => c.w).join(","),
    ITEM_DESCRIPTION_WIDTH_MM: itemCol ? itemCol.w : 0,
    lineCount: lines.length,
    pageCount: doc.internal.getNumberOfPages(),
    SUMMARY_BLOCK_HEIGHT: totalsOut.summaryBlockHeightMm + "mm",
    FOOTER_TOP_GAP: footerOut.footerTopGapMm + "mm",
    ROOT_CAUSE: "helvetica_standard_font_missing_czech_glyphs",
    TYPOGRAPHY_FIX: "v1_utf8_noto_font",
    PDF_LAYOUT_SCORE: "typography_v1",
  });
  return { blob, fileName: outName, proof };
}

try {
  if (typeof window !== "undefined") {
    window.iuInvoiceRenderPdfBlobFromData = buildInvoicePdfBlobFromData;
    window.iuInvoicePreloadPdfFont = preloadInvoicePdfFont;
    window.IU_INVOICE_PDF_LAYOUT = IU_INVOICE_PDF_LAYOUT;
  }
} catch (_) {}
