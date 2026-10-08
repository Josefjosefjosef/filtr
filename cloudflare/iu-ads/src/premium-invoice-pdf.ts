import { PDFDocument, rgb } from "pdf-lib";
import type { CustomerRegistrySnapshot } from "./premium-ares-registry";
import { PREMIUM_AD_WEB_PLACEMENT, PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import {
  drawWrappedText,
  measureWrappedHeight,
  PremiumInvoicePdfCursor,
  PREMIUM_INVOICE_CONTENT_W,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
  wrapTextLines,
  type LayoutBlockMetric,
} from "./premium-invoice-pdf-layout";
import { buildPremiumInvoiceQrPng } from "./premium-invoice-qr";
import { buildPremiumInvoiceSpayd } from "./premium-invoice-spayd";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import { resolvePremiumInvoiceVat } from "./premium-invoice-vat";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { registerPremiumPdfFonts, type PremiumPdfFonts } from "./premium-pdf-font";

export type PremiumInvoicePdfInput = {
  invoice_number: string;
  variable_symbol: string;
  issued_at: string;
  due_at: string;
  taxable_date: string;
  buyer_company: string;
  buyer_ico: string;
  buyer_dic: string | null;
  buyer_address_lines: string[];
  buyer_registry: CustomerRegistrySnapshot | null;
  line_description: string;
  service_period_start: string;
  service_period_end: string;
  total_cents: number;
  currency: string;
  order_reference: string;
  category_title_cs: string;
  position_label: string;
  duration_months: number;
};

function hexRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const TEXT_MAIN = rgb(0.1, 0.1, 0.12);
const TEXT_MUTED = rgb(0.35, 0.38, 0.45);
const BG_PANEL = rgb(0.93, 0.96, 1);
const BG_BOX_HEAD = rgb(0.96, 0.97, 0.99);
const LINE_GRAY = rgb(0.86, 0.88, 0.92);

function fmtMoneyCents(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major) + " " + currency;
  } catch {
    return String(major) + " " + currency;
  }
}

function isoToCsDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return formatAdminPragueDateTime(iso).split(" ")[0] || iso;
  return m[3] + "." + m[2] + "." + m[1];
}

function drawBrandLogo(page: PremiumInvoicePdfCursor["page"], fonts: PremiumPdfFonts, rightX: number, topY: number) {
  const brandBlue = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const size = 24;
  const infoW = fonts.bold.widthOfTextAtSize("info", size);
  const uzelW = fonts.bold.widthOfTextAtSize("Uzel.cz", size);
  const startX = rightX - (infoW + uzelW);
  page.drawText("info", { x: startX, y: topY, size, font: fonts.bold, color: rgb(0, 0, 0) });
  page.drawText("Uzel.cz", { x: startX + infoW, y: topY, size, font: fonts.bold, color: brandBlue });
}

function measurePartyBlock(
  fonts: PremiumPdfFonts,
  innerW: number,
  lines: string[],
  titleSize: number,
  bodySize: number
): number {
  const headH = titleSize * 1.6 + 8;
  let bodyH = 10;
  for (const line of lines) {
    const wrapped = wrapTextLines(fonts.regular, line, bodySize, innerW);
    bodyH += measureWrappedHeight(wrapped.length || 1, bodySize, 1.32);
  }
  return headH + bodyH + 10;
}

function drawPartyBox(
  cursor: PremiumInvoicePdfCursor,
  fonts: PremiumPdfFonts,
  x: number,
  w: number,
  title: string,
  lines: string[]
): number {
  const titleSize = 11;
  const bodySize = 9.5;
  const pad = 10;
  const innerW = w - pad * 2;
  const blockH = measurePartyBlock(fonts, innerW, lines, titleSize, bodySize);
  cursor.ensureSpace(blockH + 8);
  const yTop = cursor.y;
  const yBottom = yTop - blockH;

  cursor.page.drawRectangle({
    x,
    y: yBottom,
    width: w,
    height: blockH,
    borderColor: LINE_GRAY,
    borderWidth: 0.6,
    color: rgb(1, 1, 1),
  });
  cursor.page.drawRectangle({
    x,
    y: yTop - titleSize * 1.6 - 6,
    width: w,
    height: titleSize * 1.6 + 6,
    color: BG_BOX_HEAD,
    borderColor: LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawText(title, {
    x: x + pad,
    y: yTop - titleSize - 4,
    size: titleSize,
    font: fonts.bold,
    color: TEXT_MAIN,
  });

  let y = yTop - titleSize * 1.6 - 14;
  for (const line of lines) {
    y = drawWrappedText(cursor.page, fonts.regular, line, x + pad, y, innerW, bodySize, TEXT_MAIN, 1.32);
    y -= 2;
  }
  return yBottom;
}

function supplierLines(): string[] {
  const sup = PREMIUM_INVOICE_SUPPLIER;
  return [
    sup.companyName,
    sup.street + ", " + sup.zip + " " + sup.city,
    "IČO: " + sup.ico,
    "Zapsána v obchodním rejstříku vedeném " +
      sup.commercialRegisterCourt +
      ", oddíl " +
      sup.commercialRegisterSection +
      ", vložka " +
      sup.commercialRegisterInsert +
      ".",
    sup.nonVatNotice,
    "E-mail: " + sup.email,
    "Web: www.infouzel.cz",
  ];
}

function buyerLines(input: PremiumInvoicePdfInput): string[] {
  const out: string[] = [input.buyer_company, "IČO: " + input.buyer_ico];
  if (input.buyer_dic) out.push("DIČ: " + input.buyer_dic);
  for (const line of input.buyer_address_lines) {
    if (line && line.trim()) out.push(line.trim());
  }
  const reg = input.buyer_registry?.display_line_cs;
  if (reg && reg.trim()) out.push(reg.trim());
  return out;
}

export type PremiumInvoicePdfBuildResult = {
  pdfBytes: Uint8Array;
  layoutBlocks: LayoutBlockMetric[];
  pageCount: number;
};

/** Server-side invoice PDF — professional layout, dynamic blocks, QR Platba. */
export async function buildPremiumInvoicePdfWithLayout(
  input: PremiumInvoicePdfInput
): Promise<PremiumInvoicePdfBuildResult> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await registerPremiumPdfFonts(pdfDoc);
  const brand = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const sup = PREMIUM_INVOICE_SUPPLIER;
  const vatLine = resolvePremiumInvoiceVat(input.total_cents, input.issued_at);

  const page0 = pdfDoc.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const pages = [page0];
  const cursor = new PremiumInvoicePdfCursor(page0, pages, pdfDoc, PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN);

  drawBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y - 4);

  cursor.page.drawText("Faktura — daňový doklad", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 21,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 26;

  const invLabel = "Číslo faktury: ";
  cursor.page.drawText(invLabel, {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 11,
    font: fonts.regular,
    color: TEXT_MAIN,
  });
  const invLabelW = fonts.regular.widthOfTextAtSize(invLabel, 11);
  cursor.page.drawText(input.invoice_number, {
    x: PREMIUM_INVOICE_MARGIN + invLabelW,
    y: cursor.y,
    size: 11,
    font: fonts.bold,
    color: TEXT_MAIN,
  });
  cursor.y -= 16;

  const ordLabel = "Číslo objednávky: ";
  cursor.page.drawText(ordLabel, {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 10,
    font: fonts.regular,
    color: TEXT_MAIN,
  });
  const ordLabelW = fonts.regular.widthOfTextAtSize(ordLabel, 10);
  cursor.page.drawText(input.order_reference, {
    x: PREMIUM_INVOICE_MARGIN + ordLabelW,
    y: cursor.y,
    size: 10,
    font: fonts.bold,
    color: TEXT_MAIN,
  });
  cursor.y -= 22;
  cursor.recordBlock("header", PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN, cursor.y, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_W);

  const colGap = 12;
  const colW = (PREMIUM_INVOICE_CONTENT_W - colGap) / 2;
  const xL = PREMIUM_INVOICE_MARGIN;
  const xR = PREMIUM_INVOICE_MARGIN + colW + colGap;
  const partyTop = cursor.y;
  const supBottom = drawPartyBox(cursor, fonts, xL, colW, "Dodavatel", supplierLines());
  const buyBottom = drawPartyBox(cursor, fonts, xR, colW, "Odběratel", buyerLines(input));
  const partyBottom = Math.min(supBottom, buyBottom);
  cursor.y = partyBottom - 14;
  cursor.recordBlock("party_columns", partyTop, partyBottom, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_W);

  const metaBandH = 52;
  cursor.ensureSpace(metaBandH + 12);
  const metaTop = cursor.y;
  const metaBottom = metaTop - metaBandH;
  cursor.page.drawRectangle({
    x: PREMIUM_INVOICE_MARGIN,
    y: metaBottom,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: metaBandH,
    color: BG_BOX_HEAD,
    borderColor: LINE_GRAY,
    borderWidth: 0.5,
  });

  const metaCols = [
    { label: "Datum vystavení", value: isoToCsDate(input.issued_at), bold: false },
    { label: "Datum splatnosti", value: isoToCsDate(input.due_at), bold: true },
    { label: "DUZP", value: isoToCsDate(input.taxable_date), bold: false },
    { label: "Variabilní symbol", value: input.variable_symbol, bold: true },
    { label: "Způsob úhrady", value: "převodem", bold: false },
  ];
  const colCount = 5;
  const colInner = PREMIUM_INVOICE_CONTENT_W / colCount;
  let mx = PREMIUM_INVOICE_MARGIN;
  for (const cell of metaCols) {
    cursor.page.drawText(cell.label, { x: mx + 6, y: metaTop - 14, size: 8.5, font: fonts.regular, color: TEXT_MUTED });
    cursor.page.drawText(cell.value, {
      x: mx + 6,
      y: metaTop - 28,
      size: cell.bold ? 10.5 : 10,
      font: cell.bold ? fonts.bold : fonts.regular,
      color: TEXT_MAIN,
    });
    mx += colInner;
  }
  cursor.y = metaBottom - 16;
  cursor.recordBlock("meta_band", metaTop, metaBottom, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_W);

  cursor.ensureSpace(120);
  cursor.page.drawText("Fakturovaná služba", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 13,
    font: fonts.bold,
    color: brand,
  });
  const serviceTitleY = cursor.y;
  cursor.y -= 18;

  const tableX = PREMIUM_INVOICE_MARGIN;
  const colDescW = PREMIUM_INVOICE_CONTENT_W * 0.58;
  const colPeriodW = PREMIUM_INVOICE_CONTENT_W * 0.22;
  const colPriceW = PREMIUM_INVOICE_CONTENT_W - colDescW - colPeriodW;
  const headH = 20;
  cursor.page.drawRectangle({
    x: tableX,
    y: cursor.y - headH,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: headH,
    color: brand,
  });
  const headY = cursor.y - 14;
  cursor.page.drawText("Popis", { x: tableX + 8, y: headY, size: 9.5, font: fonts.bold, color: rgb(1, 1, 1) });
  cursor.page.drawText("Období", { x: tableX + colDescW + 8, y: headY, size: 9.5, font: fonts.bold, color: rgb(1, 1, 1) });
  cursor.page.drawText("Cena", {
    x: tableX + colDescW + colPeriodW + colPriceW - 8 - fonts.bold.widthOfTextAtSize("Cena", 9.5),
    y: headY,
    size: 9.5,
    font: fonts.bold,
    color: rgb(1, 1, 1),
  });
  cursor.y -= headH;

  const descLines = [
    "Reklamní umístění — Vybrané služby a odkazy",
    "Webové umístění reklamy: " + PREMIUM_AD_WEB_PLACEMENT,
    "Kategorie: " + input.category_title_cs,
    "Reklamní pozice: " + input.position_label,
    "Délka poskytování reklamní služby: " + String(input.duration_months) + " měsíců",
  ];
  const periodText =
    formatAdminPragueDateTime(input.service_period_start) + " – " + formatAdminPragueDateTime(input.service_period_end);
  const priceText = fmtMoneyCents(input.total_cents, input.currency);

  const bodySize = 9.5;
  let descH = 8;
  for (const dl of descLines) {
    descH += measureWrappedHeight(wrapTextLines(fonts.regular, dl, bodySize, colDescW - 16).length, bodySize, 1.32);
  }
  const periodWrapped = wrapTextLines(fonts.regular, periodText, bodySize, colPeriodW - 12);
  const periodH = measureWrappedHeight(periodWrapped.length, bodySize, 1.32) + 8;
  const rowH = Math.max(descH, periodH, 28) + 12;

  cursor.ensureSpace(rowH + 80);
  const rowTop = cursor.y;
  const rowBottom = rowTop - rowH;
  cursor.page.drawRectangle({
    x: tableX,
    y: rowBottom,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: rowH,
    borderColor: LINE_GRAY,
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
  });

  let dy = rowTop - 12;
  for (const dl of descLines) {
    dy = drawWrappedText(cursor.page, fonts.regular, dl, tableX + 8, dy, colDescW - 16, bodySize, TEXT_MAIN, 1.32);
    dy -= 1;
  }
  let py = rowTop - 12;
  for (const pl of periodWrapped) {
    cursor.page.drawText(pl, { x: tableX + colDescW + 8, y: py, size: bodySize, font: fonts.regular, color: TEXT_MAIN });
    py -= bodySize * 1.32;
  }
  cursor.page.drawText(priceText, {
    x: tableX + colDescW + colPeriodW + colPriceW - 8 - fonts.bold.widthOfTextAtSize(priceText, bodySize),
    y: rowTop - 12,
    size: bodySize,
    font: fonts.bold,
    color: TEXT_MAIN,
  });
  cursor.y = rowBottom - 14;
  cursor.recordBlock("service_table", serviceTitleY, rowBottom, tableX, PREMIUM_INVOICE_CONTENT_W);

  const totalPanelH = 44;
  cursor.ensureSpace(totalPanelH + 16);
  const totalTop = cursor.y;
  const totalBottom = totalTop - totalPanelH;
  cursor.page.drawRectangle({
    x: PREMIUM_INVOICE_MARGIN,
    y: totalBottom,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: totalPanelH,
    color: BG_PANEL,
    borderColor: LINE_GRAY,
    borderWidth: 0.5,
  });
  cursor.page.drawText("Celkem k úhradě", {
    x: PREMIUM_INVOICE_MARGIN + 12,
    y: totalTop - 16,
    size: 12,
    font: fonts.bold,
    color: TEXT_MAIN,
  });
  const vatNotice = vatLine.nonVatNotice || "";
  if (vatNotice) {
    cursor.page.drawText(vatNotice, {
      x: PREMIUM_INVOICE_MARGIN + 12,
      y: totalTop - 30,
      size: 8.5,
      font: fonts.regular,
      color: TEXT_MUTED,
    });
  }
  const totalStr = fmtMoneyCents(vatLine.grossCents, input.currency);
  const totalSize = 24;
  cursor.page.drawText(totalStr, {
    x:
      PREMIUM_INVOICE_MARGIN +
      PREMIUM_INVOICE_CONTENT_W -
      12 -
      fonts.bold.widthOfTextAtSize(totalStr, totalSize),
    y: totalTop - 28,
    size: totalSize,
    font: fonts.bold,
    color: brand,
  });
  cursor.y = totalBottom - 18;
  cursor.recordBlock("total_panel", totalTop, totalBottom, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_W);

  const payBlockH = 140;
  cursor.ensureSpace(payBlockH);
  const payTop = cursor.y;
  const payLeftW = PREMIUM_INVOICE_CONTENT_W * 0.55;
  const payRightX = PREMIUM_INVOICE_MARGIN + payLeftW + 12;
  const payRightW = PREMIUM_INVOICE_CONTENT_W - payLeftW - 12;

  cursor.page.drawText("Platební údaje", {
    x: PREMIUM_INVOICE_MARGIN,
    y: payTop,
    size: 11,
    font: fonts.bold,
    color: TEXT_MAIN,
  });
  const accountLine = "Číslo účtu: " + sup.accountNumber + "/" + sup.bankCode;
  const payLines: { text: string; bold: boolean }[] = [
    { text: accountLine, bold: true },
    { text: "Variabilní symbol: " + input.variable_symbol, bold: true },
    { text: "Částka: " + fmtMoneyCents(vatLine.grossCents, input.currency), bold: true },
    { text: "Datum splatnosti: " + isoToCsDate(input.due_at), bold: true },
    { text: "Způsob úhrady: převodem", bold: false },
    { text: "Měna: " + input.currency, bold: false },
  ];
  let pyPay = payTop - 16;
  for (const pl of payLines) {
    cursor.page.drawText(pl.text, {
      x: PREMIUM_INVOICE_MARGIN,
      y: pyPay,
      size: 10,
      font: pl.bold ? fonts.bold : fonts.regular,
      color: TEXT_MAIN,
    });
    pyPay -= 13;
  }

  cursor.page.drawText("QR Platba", { x: payRightX, y: payTop, size: 11, font: fonts.bold, color: TEXT_MAIN });
  cursor.page.drawText("Naskenujte QR kód mobilním bankovnictvím.", {
    x: payRightX,
    y: payTop - 14,
    size: 8.5,
    font: fonts.regular,
    color: TEXT_MUTED,
    maxWidth: payRightW,
  });

  const spayd = buildPremiumInvoiceSpayd({
    amountCents: input.total_cents,
    currency: input.currency,
    variableSymbol: input.variable_symbol,
    message: "Faktura " + input.invoice_number,
  });
  let qrPng: Uint8Array;
  try {
    qrPng = await buildPremiumInvoiceQrPng(spayd, 160);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error("invoice_qr_embed_failed:" + msg.slice(0, 200));
  }
  const qrImg = await pdfDoc.embedPng(qrPng);
  const qrSize = Math.min(108, payRightW - 8);
  const qrY = payTop - 28 - qrSize;
  cursor.page.drawImage(qrImg, { x: payRightX, y: qrY, width: qrSize, height: qrSize });

  cursor.y = Math.min(pyPay, qrY) - 20;
  cursor.recordBlock("payment_section", payTop, cursor.y, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_W);

  cursor.ensureSpace(36);
  const footY = Math.max(PREMIUM_INVOICE_MARGIN + 20, cursor.y);
  cursor.page.drawLine({
    start: { x: PREMIUM_INVOICE_MARGIN, y: footY + 8 },
    end: { x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, y: footY + 8 },
    thickness: 0.5,
    color: LINE_GRAY,
  });
  cursor.page.drawText("Děkujeme za vaši objednávku.", {
    x: PREMIUM_INVOICE_MARGIN,
    y: footY - 6,
    size: 9,
    font: fonts.regular,
    color: TEXT_MUTED,
  });
  drawBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, footY - 8);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, layoutBlocks: cursor.blocks, pageCount: pages.length };
}

export async function buildPremiumInvoicePdf(input: PremiumInvoicePdfInput): Promise<Uint8Array> {
  const built = await buildPremiumInvoicePdfWithLayout(input);
  return built.pdfBytes;
}
