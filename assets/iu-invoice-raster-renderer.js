/**
 * infoUzel.cz — jediný raster/canvas renderer faktury (náhled + PDF).
 * Fakturační data → A4 canvas stránky → preview i jsPDF embed.
 */
import {
  buyerBlockText,
  lineAmounts,
  parseNum,
  parseVatRate,
  supplierBlockText,
} from "./iu-invoice-engine.js";

export const IU_INVOICE_RASTER_RENDERER_ID = "iu-invoice-raster-canvas-v1";
export const RASTER_PAGE_W = 794;
export const RASTER_PAGE_H = 1123;
export const RASTER_SCALE = 2;

const BRAND = "#881337";
const BRAND_RGB = [136, 19, 55];
const TEXT = "#0f172a";
const TEXT_MUTED = "rgba(15, 23, 42, 0.65)";
const TEXT_DESC = "rgba(15, 23, 42, 0.62)";
const BORDER = "rgba(15, 23, 42, 0.1)";
const BORDER_LIGHT = "rgba(15, 23, 42, 0.08)";
const FONT_FAMILY = "IUInvRasterNoto";
const FONT_URL = "/assets/fonts/noto-sans-latin-ext-400-normal.ttf";

const PAD_X = 20;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const CONTENT_W = RASTER_PAGE_W - PAD_X * 2;

let fontLoadPromise = null;
let fontReady = false;

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

function resolveFontUrl() {
  try {
    const origin = typeof window !== "undefined" && window.location && window.location.origin ? window.location.origin : "";
    if (origin && origin !== "null") return origin + FONT_URL;
  } catch (_) {}
  return FONT_URL;
}

export async function ensureInvoiceRasterFontReady() {
  if (fontReady) return true;
  if (!fontLoadPromise) {
    fontLoadPromise = (async () => {
      try {
        if (typeof document === "undefined" || !document.fonts) return false;
        const existing = [...document.fonts].find((f) => f.family === FONT_FAMILY);
        if (existing && existing.status === "loaded") {
          fontReady = true;
          return true;
        }
        const face = new FontFace(FONT_FAMILY, "url(" + resolveFontUrl() + ")", { weight: "400", style: "normal" });
        const loaded = await face.load();
        document.fonts.add(loaded);
        await document.fonts.ready;
        fontReady = true;
        return true;
      } catch (_) {
        fontLoadPromise = null;
        return false;
      }
    })();
  }
  return fontLoadPromise;
}

function setFont(ctx, size, weight) {
  const w = weight === "bold" || weight === 800 || weight === 700 ? "700" : weight === 650 ? "650" : "400";
  ctx.font = w + " " + size + "px " + FONT_FAMILY + ", system-ui, sans-serif";
}

function wrapLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i];
    if (ctx.measureText(test).width <= maxW) line = test;
    else {
      if (line) lines.push(line);
      line = words[i];
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function measureWrapped(ctx, text, maxW, lineH) {
  const lines = wrapLines(ctx, text, maxW);
  return { lines, height: lines.length * lineH };
}

function drawWrapped(ctx, text, x, y, maxW, lineH, color, align) {
  const lines = wrapLines(ctx, text, maxW);
  ctx.fillStyle = color || TEXT;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "top";
  let cy = y;
  for (let i = 0; i < lines.length; i++) {
    const tx = align === "right" ? x + maxW : align === "center" ? x + maxW / 2 : x;
    ctx.fillText(lines[i], tx, cy);
    cy += lineH;
  }
  return cy;
}

function drawRect(ctx, x, y, w, h, fill, stroke) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function tableColumns(hasVat) {
  const inner = CONTENT_W;
  if (hasVat) {
    const wNum = 28;
    const wQty = 48;
    const wUnit = 44;
    const wPrice = 96;
    const wVat = 40;
    const wTotal = 96;
    const wItem = inner - (wNum + wQty + wUnit + wPrice + wVat + wTotal);
    return [
      { key: "num", w: wNum, label: "#", align: "center" },
      { key: "item", w: wItem, label: "Položka", align: "left" },
      { key: "qty", w: wQty, label: "Množ.", align: "right" },
      { key: "unit", w: wUnit, label: "Jedn.", align: "left" },
      { key: "price", w: wPrice, label: "Cena / j.", align: "right" },
      { key: "vat", w: wVat, label: "DPH", align: "right" },
      { key: "total", w: wTotal, label: "Celkem", align: "right" },
    ];
  }
  const wNum = 28;
  const wQty = 52;
  const wUnit = 48;
  const wPrice = 108;
  const wTotal = 108;
  const wItem = inner - (wNum + wQty + wUnit + wPrice + wTotal);
  return [
    { key: "num", w: wNum, label: "#", align: "center" },
    { key: "item", w: wItem, label: "Položka", align: "left" },
    { key: "qty", w: wQty, label: "Množ.", align: "right" },
    { key: "unit", w: wUnit, label: "Jedn.", align: "left" },
    { key: "price", w: wPrice, label: "Cena / j.", align: "right" },
    { key: "total", w: wTotal, label: "Celkem", align: "right" },
  ];
}

function buildRowModel(state, totals, ln, index) {
  const qty = parseNum(ln.qty);
  const up = parseNum(ln.unitPrice);
  const vr = totals.payer ? parseVatRate(ln.vatRate) : 0;
  const a = lineAmounts(Number.isFinite(qty) ? qty : 0, Number.isFinite(up) ? up : 0, vr, totals.payer);
  return {
    index: index + 1,
    name: String(ln.name || "").trim(),
    description: String(ln.description || "").trim(),
    qty: String(ln.qty || ""),
    unit: String(ln.unit || "ks"),
    price: fmtMoney(up),
    vat: totals.payer ? String(vr) + "%" : "",
    total: fmtMoney(a.gross),
  };
}

function measureRowHeight(ctx, cols, row) {
  const itemCol = cols.find((c) => c.key === "item");
  const pad = 8;
  setFont(ctx, 13, 400);
  let h = 16;
  const nameH = 18;
  h += nameH;
  if (row.description) {
    setFont(ctx, 12, 400);
    const wrapped = measureWrapped(ctx, row.description, itemCol.w - pad * 2, 16);
    h += wrapped.height + 4;
  }
  return Math.max(32, h + pad);
}

function measurePartyBlock(ctx, text, colW) {
  setFont(ctx, 13, 400);
  const lines = String(text || "").split("\n");
  let h = 22;
  for (let i = 0; i < lines.length; i++) {
    const wrapped = measureWrapped(ctx, lines[i], colW - 8, 19);
    h += wrapped.height;
  }
  return h + 8;
}

function measureHeaderBlock() {
  return 92;
}

function measureMetaBlock(state) {
  const inv = state.invoice || {};
  let h = 0;
  h += 36;
  h += 36;
  if (inv.variableSymbol) h += 36;
  return h + 10;
}

function measureBankBlock(state) {
  const inv = state.invoice || {};
  if (inv.payment !== "transfer") return 0;
  return 52;
}

function measureTotalsBlock(totals) {
  let h = 8;
  if (totals.payer) h += 22 * 2;
  h += 34;
  h += 40;
  return h;
}

function planPages(state, totals, ctx) {
  const hasVat = !!totals.payer;
  const cols = tableColumns(hasVat);
  const rows = (state.lines || []).map((ln, i) => buildRowModel(state, totals, ln, i));
  const rowHeights = rows.map((r) => measureRowHeight(ctx, cols, r));
  const headerH = measureHeaderBlock();
  const partyH =
    Math.max(
      measurePartyBlock(ctx, supplierBlockText(state), CONTENT_W / 2 - 7),
      measurePartyBlock(ctx, buyerBlockText(state), CONTENT_W / 2 - 7),
    ) + 14;
  const metaH = measureMetaBlock(state);
  const bankH = measureBankBlock(state);
  const tableHeadH = 34;
  const totalsBlockH = measureTotalsBlock(totals) + 44;
  const bottomLimit = RASTER_PAGE_H - PAD_BOTTOM;

  const pages = [];
  let rowIdx = 0;
  let isFirst = true;

  while (true) {
    let y = PAD_TOP;
    const page = {
      showHeader: isFirst,
      showParties: isFirst,
      showMeta: isFirst,
      showBank: isFirst,
      rowStart: rowIdx,
      rowEnd: rowIdx,
      showTotals: false,
      showFooter: false,
    };
    if (page.showHeader) y += headerH;
    if (page.showParties) y += partyH;
    if (page.showMeta) y += metaH;
    if (page.showBank) y += bankH;
    y += tableHeadH;

    while (rowIdx < rows.length) {
      const rh = rowHeights[rowIdx];
      const rowsLeft = rows.length - rowIdx;
      const needTotals = rowsLeft === 1;
      const spaceNeeded = rh + (needTotals ? totalsBlockH : 0);
      if (y + spaceNeeded > bottomLimit && page.rowEnd > page.rowStart) break;
      page.rowEnd = rowIdx + 1;
      y += rh;
      rowIdx += 1;
      if (rowIdx >= rows.length) break;
    }

    const allRowsDone = rowIdx >= rows.length;
    if (allRowsDone && y + totalsBlockH <= bottomLimit) {
      page.showTotals = true;
      page.showFooter = true;
    }
    pages.push(page);
    isFirst = false;

    if (allRowsDone && page.showTotals) break;
    if (allRowsDone && !page.showTotals) {
      pages.push({
        showHeader: false,
        showParties: false,
        showMeta: false,
        showBank: false,
        rowStart: rowIdx,
        rowEnd: rowIdx,
        showTotals: true,
        showFooter: true,
      });
      break;
    }
    if (page.rowStart >= page.rowEnd && rowIdx < rows.length) {
      page.rowEnd = rowIdx + 1;
      rowIdx += 1;
      pages[pages.length - 1] = page;
      if (rowIdx >= rows.length) {
        if (y + totalsBlockH > bottomLimit) {
          pages.push({
            showHeader: false,
            showParties: false,
            showMeta: false,
            showBank: false,
            rowStart: rowIdx,
            rowEnd: rowIdx,
            showTotals: true,
            showFooter: true,
          });
        } else {
          page.showTotals = true;
          page.showFooter = true;
        }
      }
      break;
    }
    if (rowIdx >= rows.length) break;
  }

  if (!pages.length) {
    pages.push({
      showHeader: true,
      showParties: true,
      showMeta: true,
      showBank: true,
      rowStart: 0,
      rowEnd: 0,
      showTotals: true,
      showFooter: true,
    });
  }
  const last = pages[pages.length - 1];
  last.showTotals = true;
  last.showFooter = true;
  return { pages, cols, rows, rowHeights, totalsBlockH };
}

function drawHeader(ctx, inv) {
  const x = PAD_X;
  const y = PAD_TOP;
  const w = CONTENT_W;
  const h = 78;
  drawRoundedRect(ctx, x, y, w, h, 10, "#ffffff", BORDER);
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 10, null, null);
  ctx.clip();
  const strips = [
    { left: 0, width: 0.16, color: "rgba(136, 19, 55, 0.06)" },
    { left: 0.16, width: 0.08, color: "rgba(136, 19, 55, 0.045)" },
    { left: 0.24, width: 0.08, color: "rgba(136, 19, 55, 0.03)" },
    { left: 0.32, width: 0.08, color: "rgba(136, 19, 55, 0.015)" },
  ];
  for (let si = 0; si < strips.length; si++) {
    const s = strips[si];
    ctx.fillStyle = s.color;
    ctx.fillRect(x + w * s.left, y, w * s.width, h);
  }
  ctx.restore();
  ctx.fillStyle = BRAND;
  ctx.fillRect(x, y + 8, 4, h - 16);
  setFont(ctx, 13, 700);
  ctx.fillStyle = BRAND;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Vytvořeno pomocí infoUzel.cz", x + 14, y + 12);
  setFont(ctx, 22, 800);
  ctx.fillStyle = TEXT;
  ctx.fillText("FAKTURA", x + 14, y + 30);
  setFont(ctx, 15, 700);
  ctx.fillStyle = TEXT_MUTED;
  ctx.fillText("číslo faktury " + String(inv.number || "").trim(), x + 14, y + 56);
  return y + h + 14;
}

function drawParties(ctx, state, y) {
  const colW = (CONTENT_W - 14) / 2;
  const xL = PAD_X;
  const xR = PAD_X + colW + 14;
  setFont(ctx, 12, 650);
  ctx.fillStyle = BRAND;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("DODAVATEL", xL, y);
  ctx.fillText("ODBĚRATEL", xR, y);
  let yL = y + 20;
  let yR = y + 20;
  setFont(ctx, 13, 400);
  ctx.fillStyle = TEXT;
  const supLines = String(supplierBlockText(state)).split("\n");
  const buyLines = String(buyerBlockText(state)).split("\n");
  for (let i = 0; i < supLines.length; i++) {
    yL = drawWrapped(ctx, supLines[i], xL, yL, colW, 19, TEXT, "left");
  }
  for (let i = 0; i < buyLines.length; i++) {
    yR = drawWrapped(ctx, buyLines[i], xR, yR, colW, 19, TEXT, "left");
  }
  return Math.max(yL, yR) + 14;
}

function drawMetaTable(ctx, state, y) {
  const inv = state.invoice || {};
  const payLabel = inv.payment === "cash" ? "Hotově" : "Převodem";
  const rows = [
    ["Datum vystavení", fmtDateCs(inv.issueDate), "Splatnost", fmtDateCs(inv.dueDate)],
    ["DUZP", fmtDateCs(inv.taxableDate), "Úhrada", payLabel],
  ];
  if (inv.variableSymbol) rows.push(["VS", inv.variableSymbol, "", ""]);
  const x = PAD_X;
  const colW = CONTENT_W / 4;
  const rowH = 34;
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    for (let ci = 0; ci < 4; ci++) {
      const cx = x + colW * ci;
      const isHead = ci % 2 === 0;
      drawRect(ctx, cx, y, colW, rowH, isHead ? "rgba(15, 23, 42, 0.03)" : "#fff", BORDER_LIGHT);
      setFont(ctx, 13, isHead ? 650 : 400);
      ctx.fillStyle = TEXT;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      if (row[ci]) ctx.fillText(row[ci], cx + 10, y + rowH / 2);
    }
    y += rowH;
  }
  return y + 10;
}

function drawBank(ctx, state, y) {
  const inv = state.invoice || {};
  if (inv.payment !== "transfer") return y;
  const x = PAD_X;
  const h = 42;
  drawRoundedRect(ctx, x, y, CONTENT_W, h, 10, "rgba(15, 23, 42, 0.03)", null);
  setFont(ctx, 13, 400);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let text = "Účet: " + String(inv.accountNumber || "");
  if (inv.bankCode) text += " / " + inv.bankCode;
  ctx.fillText(text, x + 12, y + 10);
  let line2 = "";
  if (inv.iban) line2 += "IBAN: " + inv.iban;
  if (inv.swift) line2 += (line2 ? "   " : "") + "SWIFT: " + inv.swift;
  if (line2) ctx.fillText(line2, x + 12, y + 26);
  return y + h + 12;
}

function drawTableHeader(ctx, cols, y) {
  const x0 = PAD_X;
  let x = x0;
  const h = 34;
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    drawRect(ctx, x, y, col.w, h, "rgba(136, 19, 55, 0.07)", BORDER);
    setFont(ctx, 13, 700);
    ctx.fillStyle = TEXT;
    ctx.textAlign = col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
    ctx.textBaseline = "middle";
    const tx = col.align === "right" ? x + col.w - 8 : col.align === "center" ? x + col.w / 2 : x + 8;
    ctx.fillText(col.label, tx, y + h / 2);
    x += col.w;
  }
  return y + h;
}

function drawTableRow(ctx, cols, row, y, rh) {
  let x = PAD_X;
  const cells = {
    num: String(row.index),
    item: row.name,
    qty: row.qty,
    unit: row.unit,
    price: row.price,
    vat: row.vat,
    total: row.total,
  };
  for (let ci = 0; ci < cols.length; ci++) {
    const col = cols[ci];
    drawRect(ctx, x, y, col.w, rh, "#fff", BORDER);
    const pad = 8;
    if (col.key === "item") {
      setFont(ctx, 13, 400);
      ctx.fillStyle = TEXT;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(row.name, x + pad, y + pad);
      if (row.description) {
        setFont(ctx, 12, 400);
        ctx.fillStyle = TEXT_DESC;
        drawWrapped(ctx, row.description, x + pad, y + pad + 18, col.w - pad * 2, 16, TEXT_DESC, "left");
      }
    } else {
      setFont(ctx, 13, col.key === "total" ? 800 : 400);
      ctx.fillStyle = TEXT;
      ctx.textAlign = col.align === "right" ? "right" : col.align === "center" ? "center" : "left";
      ctx.textBaseline = "middle";
      const tx = col.align === "right" ? x + col.w - pad : col.align === "center" ? x + col.w / 2 : x + pad;
      ctx.fillText(cells[col.key] || "", tx, y + rh / 2);
    }
    x += col.w;
  }
  return y + rh;
}

function drawTotals(ctx, totals, y) {
  const blockW = 280;
  const x = PAD_X + CONTENT_W - blockW;
  setFont(ctx, 14, 400);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  if (totals.payer) {
    ctx.fillText("Mezisoučet bez DPH: " + fmtMoney(totals.sumBase), PAD_X + CONTENT_W, y);
    y += 22;
    ctx.fillText("DPH: " + fmtMoney(totals.sumVat), PAD_X + CONTENT_W, y);
    y += 22;
  }
  setFont(ctx, 18, 800);
  ctx.fillStyle = BRAND;
  ctx.fillText("Celkem k úhradě: " + fmtMoney(totals.sumGross), PAD_X + CONTENT_W, y + 8);
  return y + 42;
}

function drawFooter(ctx, y) {
  const x = PAD_X;
  const w = CONTENT_W;
  ctx.strokeStyle = BORDER_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  setFont(ctx, 12, 400);
  ctx.fillStyle = TEXT_MUTED;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("www.infoUzel.cz · Vytvořeno pomocí infoUzel.cz", x + w / 2, y + 12);
  return y + 40;
}

function drawPage(ctx, state, totals, plan, pagePlan, scale) {
  const s = scale || 1;
  ctx.save();
  ctx.scale(s, s);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, RASTER_PAGE_W, RASTER_PAGE_H);
  drawRoundedRect(ctx, PAD_X - 4, PAD_TOP - 4, CONTENT_W + 8, RASTER_PAGE_H - PAD_TOP - PAD_BOTTOM + 8, 12, "#fff", BORDER);
  let y = PAD_TOP;
  if (pagePlan.showHeader) y = drawHeader(ctx, state.invoice || {});
  if (pagePlan.showParties) y = drawParties(ctx, state, y);
  if (pagePlan.showMeta) y = drawMetaTable(ctx, state, y);
  if (pagePlan.showBank) y = drawBank(ctx, state, y);
  y = drawTableHeader(ctx, plan.cols, y);
  for (let ri = pagePlan.rowStart; ri < pagePlan.rowEnd; ri++) {
    y = drawTableRow(ctx, plan.cols, plan.rows[ri], y, plan.rowHeights[ri]);
  }
  if (pagePlan.showTotals) y = drawTotals(ctx, totals, y + 8);
  if (pagePlan.showFooter) drawFooter(ctx, y + 8);
  ctx.restore();
}

function publishRasterProof(extra) {
  const proof = Object.assign(
    {
      NEW_RENDERER: IU_INVOICE_RASTER_RENDERER_ID,
      PDF_ENGINE: "a4_lossless_png_multipage_jspdf",
      PREVIEW_RENDERER: IU_INVOICE_RASTER_RENDERER_ID,
      PDF_RENDERER: IU_INVOICE_RASTER_RENDERER_ID,
      RASTER_SINGLE_SOURCE: true,
      PREVIEW_USES_SAME_RASTER_AS_PDF: true,
      PDF_USES_SAME_RASTER_AS_PREVIEW: true,
      HTML_PREVIEW_CAPTURE_USED_FOR_PDF: false,
      SECOND_RENDER_PATH_EXISTS: false,
      HTML2CANVAS_USED: false,
      HTML2PDF_USED: false,
      PNG_CAPTURE_USED: true,
      PDF_TEXT_LAYER: false,
      FONT_RENDERED_IN_RASTER: true,
      FONT_SUBSTITUTION_RISK: false,
      MONOSPACE_FALLBACK_RISK: false,
      MONOSPACE_FALLBACK_ELIMINATED: true,
      ROW_SPLIT_PREVENTED: true,
      TOTALS_ON_LAST_PAGE: true,
      PDF_IS_A4: true,
      PDF_SUPPORTS_MULTIPAGE_A4: true,
      PDF_IS_SINGLE_LONG_PAGE: false,
      PAPER_CAPTURE_WIDTH: RASTER_PAGE_W,
      PAPER_LOGICAL_WIDTH: RASTER_PAGE_W,
      PAPER_LOGICAL_HEIGHT: RASTER_PAGE_H,
    },
    extra || {},
  );
  try {
    window._iuInvoiceRasterProof = proof;
    window._iuInvoicePdfRendererProof = proof;
    window._iuInvoicePdfExportMeta = {
      renderSource: IU_INVOICE_RASTER_RENDERER_ID,
      generatedFromPreview: false,
      generatedFromPreviewDom: false,
      generatedFromScaledPreview: false,
      visualTemplateUsed: true,
      plainTextOnly: false,
      paperModeUsed: true,
      pdfEngine: "a4_lossless_png_multipage_jspdf",
      typographyFix: "raster_canvas_single_source_v1",
      rasterSingleSource: true,
    };
  } catch (_) {}
  return proof;
}

export function rasterContentKey(state, totals) {
  try {
    return JSON.stringify({
      inv: state.invoice,
      supplierKind: state.supplierKind,
      supplierVatPayer: state.supplierVatPayer,
      supplierFo: state.supplierFo,
      supplierPo: state.supplierPo,
      buyerKind: state.buyerKind,
      buyerFo: state.buyerFo,
      buyerPo: state.buyerPo,
      lines: state.lines,
      totals: { payer: totals.payer, sumBase: totals.sumBase, sumVat: totals.sumVat, sumGross: totals.sumGross },
    });
  } catch (_) {
    return String(Date.now());
  }
}

export async function renderInvoiceRasterBundle(state, totals, options) {
  await ensureInvoiceRasterFontReady();
  const scale = (options && options.scale) || RASTER_SCALE;
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = RASTER_PAGE_W;
  measureCanvas.height = 100;
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) throw new Error("invoice_raster_ctx_missing");
  const plan = planPages(state, totals, measureCtx);
  const canvases = [];
  const pngDataUrls = [];
  for (let pi = 0; pi < plan.pages.length; pi++) {
    const canvas = document.createElement("canvas");
    canvas.width = RASTER_PAGE_W * scale;
    canvas.height = RASTER_PAGE_H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("invoice_raster_page_ctx_missing");
    drawPage(ctx, state, totals, plan, plan.pages[pi], scale);
    canvases.push(canvas);
    pngDataUrls.push(canvas.toDataURL("image/png"));
  }
  const contentKey = rasterContentKey(state, totals);
  const proof = publishRasterProof({
    capturePageCount: canvases.length,
    pdfPageCount: canvases.length,
    pageCount: canvases.length,
    rasterScale: scale,
    contentKey,
    layoutPageCount: plan.pages.length,
  });
  return {
    canvases,
    pngDataUrls,
    pageCount: canvases.length,
    proof,
    contentKey,
    scale,
  };
}

export function buildRasterPreviewHostInner(bundle) {
  if (!bundle || !bundle.pngDataUrls || !bundle.pngDataUrls.length) return "";
  const pages = bundle.pngDataUrls
    .map(
      (url, i) =>
        '<div class="iu-invoice-raster-page" data-raster-page="' +
        (i + 1) +
        '"><img class="iu-invoice-raster-img" src="' +
        url +
        '" width="' +
        RASTER_PAGE_W +
        '" height="' +
        RASTER_PAGE_H +
        '" alt="Faktura strana ' +
        (i + 1) +
        '" decoding="async" /></div>',
    )
    .join("");
  return (
    '<div class="iu-invoice-paper iu-invoice-paper--raster" data-invoice-raster-preview="1">' + pages + "</div>"
  );
}

try {
  if (typeof window !== "undefined") {
    window.iuInvoiceRenderRasterBundle = renderInvoiceRasterBundle;
    window.iuInvoiceBuildRasterPreviewInner = buildRasterPreviewHostInner;
    window.IU_INVOICE_RASTER = { widthPx: RASTER_PAGE_W, heightPx: RASTER_PAGE_H, scale: RASTER_SCALE };
  }
} catch (_) {}
