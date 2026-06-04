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
  fontBodyPt: 10,
  fontMetaPt: 9,
  fontTitlePt: 18,
  fontSubtitlePt: 11,
  fontTableHeadPt: 9,
  fontItemNamePt: 9,
  fontItemDescPt: 8,
  fontTotalsPt: 10,
  fontDuePt: 11,
  fontFootPt: 8,
  brandRgb: [136, 19, 55],
  lineGrayRgb: [219, 225, 232],
};

const MM_PAGE_W = 210;
const MM_PAGE_H = 297;

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

function columnLayout(hasVat) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const x0 = L.marginLeftMm;
  const xEnd = MM_PAGE_W - L.marginRightMm;
  const inner = xEnd - x0;
  if (hasVat) {
    const wNum = 8;
    const wQty = 14;
    const wUnit = 14;
    const wPrice = 22;
    const wVat = 12;
    const wTotal = 22;
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
  const wNum = 8;
  const wQty = 16;
  const wUnit = 16;
  const wPrice = 26;
  const wTotal = 26;
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
    };
  } catch (_) {}
  return proof;
}

function drawMultiline(doc, lines, x, y, lineH) {
  let cy = y;
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], x, cy);
    cy += lineH;
  }
  return cy;
}

function drawPartyColumns(doc, state, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const colW = (MM_PAGE_W - L.marginLeftMm - L.marginRightMm - 6) / 2;
  const xL = L.marginLeftMm;
  const xR = L.marginLeftMm + colW + 6;
  const sup = supplierBlockText(state).split("\n");
  const buy = buyerBlockText(state).split("\n");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(L.fontMetaPt);
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.text("Dodavatel", xL, y);
  doc.text("Odběratel", xR, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontBodyPt);
  doc.setTextColor(30, 41, 59);
  const supLines = doc.splitTextToSize(sup.join("\n"), colW);
  const buyLines = doc.splitTextToSize(buy.join("\n"), colW);
  const lh = ptToMm(L.fontBodyPt) * 1.25;
  const yBody = y + 4;
  const yAfterL = drawMultiline(doc, supLines, xL, yBody, lh);
  const yAfterR = drawMultiline(doc, buyLines, xR, yBody, lh);
  return Math.max(yAfterL, yAfterR) + 3;
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
  const lh = ptToMm(L.fontMetaPt) * 1.35;
  doc.setFontSize(L.fontMetaPt);
  doc.setTextColor(30, 41, 59);
  let cy = y;
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    doc.setFont("helvetica", "bold");
    doc.text(String(row[0] || ""), x0, cy);
    doc.setFont("helvetica", "normal");
    doc.text(String(row[1] || ""), x0 + 38, cy);
    if (row[2]) {
      doc.setFont("helvetica", "bold");
      doc.text(String(row[2]), x0 + inner * 0.48, cy);
      doc.setFont("helvetica", "normal");
      doc.text(String(row[3] || ""), x0 + inner * 0.48 + 28, cy);
    }
    cy += lh;
  }
  if (inv.payment === "transfer") {
    cy += 1;
    doc.setFillColor(248, 250, 252);
    const bankH = 10;
    doc.rect(x0, cy - 3, inner, bankH, "F");
    doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
    doc.rect(x0, cy - 3, inner, bankH, "S");
    doc.setFontSize(L.fontMetaPt);
    let bank = "Účet: " + String(inv.accountNumber || "").trim();
    if (inv.bankCode) bank += " / " + String(inv.bankCode).trim();
    if (inv.iban) bank += " · IBAN: " + String(inv.iban).trim();
    if (inv.swift) bank += " · SWIFT: " + String(inv.swift).trim();
    doc.text(bank, x0 + 2, cy + 3);
    cy += bankH + 2;
  }
  return cy + 2;
}

function drawTableHeader(doc, layout, hasVat, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const h = 7;
  doc.setFillColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.rect(layout.x0, y - 4.5, layout.inner, h, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(L.fontTableHeadPt);
  doc.setTextColor(255, 255, 255);
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    const tx = c.key === "item" ? c.x + 1.5 : c.x + c.w / 2;
    const align = c.key === "item" ? "left" : "center";
    doc.text(c.label, tx, y, { align });
  }
  doc.setTextColor(30, 41, 59);
  return y + h - 2;
}

function drawTableRow(doc, layout, hasVat, y, row) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const itemCol = layout.cols.find((c) => c.key === "item");
  const itemW = itemCol ? itemCol.w - 2 : 40;
  doc.setFontSize(L.fontItemNamePt);
  doc.setFont("helvetica", "bold");
  const nameLines = doc.splitTextToSize(String(row.name || ""), itemW);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontItemDescPt);
  const descLines = row.description ? doc.splitTextToSize(String(row.description), itemW) : [];
  const lhName = ptToMm(L.fontItemNamePt) * 1.2;
  const lhDesc = ptToMm(L.fontItemDescPt) * 1.15;
  const bodyH = nameLines.length * lhName + descLines.length * lhDesc;
  const rowH = Math.max(7, bodyH + 2.5);
  const yTop = y;
  doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
  doc.line(layout.x0, yTop + rowH, layout.xEnd, yTop + rowH);
  doc.setFontSize(L.fontItemNamePt);
  doc.setFont("helvetica", "bold");
  drawMultiline(doc, nameLines, itemCol.x + 1.5, yTop + 3, lhName);
  if (descLines.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(L.fontItemDescPt);
    doc.setTextColor(100, 116, 139);
    drawMultiline(doc, descLines, itemCol.x + 1.5, yTop + 3 + nameLines.length * lhName, lhDesc);
    doc.setTextColor(30, 41, 59);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontMetaPt);
  const midY = yTop + rowH / 2 + 1;
  for (let i = 0; i < layout.cols.length; i++) {
    const c = layout.cols[i];
    if (c.key === "item") continue;
    const val = row.cells[c.key] != null ? String(row.cells[c.key]) : "";
    doc.text(val, c.x + c.w / 2, midY, { align: "center" });
  }
  return yTop + rowH;
}

function drawTotals(doc, totals, y) {
  const L = IU_INVOICE_PDF_LAYOUT;
  const boxW = 72;
  const x = MM_PAGE_W - L.marginRightMm - boxW;
  let cy = y;
  doc.setFontSize(L.fontTotalsPt);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);
  if (totals.payer) {
    doc.text("Mezisoučet bez DPH:", x, cy);
    doc.text(fmtMoney(totals.sumBase), x + boxW, cy, { align: "right" });
    cy += 5;
    doc.text("DPH:", x, cy);
    doc.text(fmtMoney(totals.sumVat), x + boxW, cy, { align: "right" });
    cy += 5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(L.fontDuePt);
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.text("Celkem k úhradě:", x, cy + 2);
  doc.text(fmtMoney(totals.sumGross), x + boxW, cy + 2, { align: "right" });
  doc.setTextColor(30, 41, 59);
  return cy + 10;
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
  const inv = state.invoice || {};
  const hasVat = !!totals.payer;
  const layout = columnLayout(hasVat);
  const bottom = MM_PAGE_H - L.marginBottomMm;
  let y = L.marginTopMm;

  doc.setDrawColor(L.lineGrayRgb[0], L.lineGrayRgb[1], L.lineGrayRgb[2]);
  doc.setLineWidth(0.4);
  doc.line(L.marginLeftMm, y + 2, L.marginLeftMm, y + 18);
  doc.setLineWidth(1.2);
  doc.setDrawColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.line(L.marginLeftMm, y + 2, L.marginLeftMm, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontFootPt);
  doc.setTextColor(100, 116, 139);
  doc.text("Vytvořeno pomocí infoUzel.cz", L.marginLeftMm + 4, y + 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(L.fontTitlePt);
  doc.setTextColor(L.brandRgb[0], L.brandRgb[1], L.brandRgb[2]);
  doc.text("FAKTURA", L.marginLeftMm + 4, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontSubtitlePt);
  doc.setTextColor(30, 41, 59);
  doc.text("číslo faktury " + String(inv.number || "").trim(), L.marginLeftMm + 4, y + 18);
  y += 24;

  y = drawPartyColumns(doc, state, y);
  y = drawMetaBlock(doc, state, y);
  y += 2;
  y = drawTableHeader(doc, layout, hasVat, y);

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
    const estItemCol = layout.cols.find((c) => c.key === "item");
    const estW = estItemCol ? estItemCol.w - 2 : 40;
    doc.setFontSize(L.fontItemNamePt);
    const estName = doc.splitTextToSize(row.name, estW);
    doc.setFontSize(L.fontItemDescPt);
    const estDesc = row.description ? doc.splitTextToSize(row.description, estW) : [];
    const estH = Math.max(7, estName.length * ptToMm(L.fontItemNamePt) * 1.2 + estDesc.length * ptToMm(L.fontItemDescPt) * 1.15 + 2.5);
    if (y + estH > bottom - 28) {
      doc.addPage();
      y = L.marginTopMm;
      y = drawTableHeader(doc, layout, hasVat, y);
    }
    y = drawTableRow(doc, layout, hasVat, y, row);
  }

  if (y + 24 > bottom) {
    doc.addPage();
    y = L.marginTopMm;
  }
  y = drawTotals(doc, totals, y + 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(L.fontFootPt);
  doc.setTextColor(100, 116, 139);
  doc.text("www.infoUzel.cz · Vytvořeno pomocí infoUzel.cz", L.marginLeftMm, bottom);

  const blob = doc.output("blob");
  const outName = fileName || "faktura.pdf";
  const proof = publishRendererProof({
    PDF_TABLE_COLUMN_WIDTHS_MM: layout.cols.map((c) => c.w).join(","),
    lineCount: lines.length,
    pageCount: doc.internal.getNumberOfPages(),
  });
  return { blob, fileName: outName, proof };
}

try {
  if (typeof window !== "undefined") {
    window.iuInvoiceRenderPdfBlobFromData = buildInvoicePdfBlobFromData;
    window.IU_INVOICE_PDF_LAYOUT = IU_INVOICE_PDF_LAYOUT;
  }
} catch (_) {}
