import { rgb, type PDFPage } from "pdf-lib";
import { PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import {
  drawWrappedText,
  measureWrappedHeight,
  PREMIUM_INVOICE_MARGIN,
  PremiumInvoicePdfCursor,
  wrapTextLines,
} from "./premium-invoice-pdf-layout";
import type { PremiumPdfFonts } from "./premium-pdf-font";
import type { PremiumOrderPdfContext } from "./premium-order-pdf-fields";

export const PREMIUM_PDF_TEXT_MAIN = rgb(0.1, 0.1, 0.12);
export const PREMIUM_PDF_TEXT_MUTED = rgb(0.35, 0.38, 0.45);
export const PREMIUM_PDF_BG_BOX_HEAD = rgb(0.96, 0.97, 0.99);
export const PREMIUM_PDF_LINE_GRAY = rgb(0.86, 0.88, 0.92);
export const PREMIUM_PDF_BG_PANEL = rgb(0.93, 0.96, 1);

export function premiumPdfHexRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function premiumPdfBrandRgb() {
  return premiumPdfHexRgb(PREMIUM_INVOICE_BRAND_HEX);
}

export function drawPremiumPdfBrandLogo(page: PDFPage, fonts: PremiumPdfFonts, rightX: number, topY: number) {
  const brandBlue = premiumPdfBrandRgb();
  const size = 24;
  const infoW = fonts.bold.widthOfTextAtSize("info", size);
  const uzelW = fonts.bold.widthOfTextAtSize("Uzel.cz", size);
  const startX = rightX - (infoW + uzelW);
  page.drawText("info", { x: startX, y: topY, size, font: fonts.bold, color: rgb(0, 0, 0) });
  page.drawText("Uzel.cz", { x: startX + infoW, y: topY, size, font: fonts.bold, color: brandBlue });
}

export type PartyLineStyle = { text: string; bold?: boolean; linkBlue?: boolean };

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

export function drawPremiumPdfPartyBox(
  cursor: PremiumInvoicePdfCursor,
  fonts: PremiumPdfFonts,
  brand: ReturnType<typeof premiumPdfBrandRgb>,
  x: number,
  w: number,
  title: string,
  lines: PartyLineStyle[]
): number {
  const titleSize = 11;
  const bodySize = 9.5;
  const pad = 10;
  const innerW = w - pad * 2;
  const plainLines = lines.map((l) => l.text);
  const blockH = measurePartyBlock(fonts, innerW, plainLines, titleSize, bodySize);
  cursor.ensureSpace(blockH + 8);
  const yTop = cursor.y;
  const yBottom = yTop - blockH;

  cursor.page.drawRectangle({
    x,
    y: yBottom,
    width: w,
    height: blockH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
    color: rgb(1, 1, 1),
  });
  const headH = titleSize * 1.6 + 6;
  cursor.page.drawRectangle({
    x,
    y: yTop - headH,
    width: w,
    height: headH,
    color: PREMIUM_PDF_BG_BOX_HEAD,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawText(title, {
    x: x + pad,
    y: yTop - titleSize - 4,
    size: titleSize,
    font: fonts.bold,
    color: brand,
  });

  let y = yTop - headH - 8;
  for (const line of lines) {
    const font = line.bold ? fonts.bold : fonts.regular;
    const color = line.linkBlue ? brand : PREMIUM_PDF_TEXT_MAIN;
    y = drawWrappedText(cursor.page, font, line.text, x + pad, y, innerW, bodySize, color, 1.32);
    y -= 2;
  }
  cursor.y = yBottom - 6;
  return yBottom;
}

export function premiumPdfSupplierLines(): PartyLineStyle[] {
  const sup = PREMIUM_INVOICE_SUPPLIER;
  return [
    { text: sup.companyName, bold: true },
    { text: sup.street + ", " + sup.zip + " " + sup.city },
    { text: "IČO: " + sup.ico },
    {
      text:
        "Zapsána v obchodním rejstříku vedeném " +
        sup.commercialRegisterCourt +
        ", oddíl " +
        sup.commercialRegisterSection +
        ", vložka " +
        sup.commercialRegisterInsert +
        ".",
    },
    { text: sup.nonVatNotice },
    { text: "E-mail: " + sup.email, linkBlue: true },
    { text: "Web: www.infouzel.cz", linkBlue: true },
  ];
}

export function premiumPdfBuyerLinesFromCtx(ctx: PremiumOrderPdfContext): PartyLineStyle[] {
  const out: PartyLineStyle[] = [{ text: ctx.company_name, bold: true }, { text: "IČO: " + ctx.ico }];
  if (ctx.dic) out.push({ text: "DIČ: " + ctx.dic });
  const addr = [ctx.billing_street, ctx.billing_zip + " " + ctx.billing_city].filter(Boolean).join(", ");
  if (addr.trim()) out.push({ text: addr });
  const reg = ctx.customer_registry?.display_line_cs;
  if (reg && reg.trim()) out.push({ text: reg.trim() });
  return out;
}

export function drawPremiumPdfSectionHeader(
  cursor: PremiumInvoicePdfCursor,
  fonts: PremiumPdfFonts,
  brand: ReturnType<typeof premiumPdfBrandRgb>,
  title: string,
  fullWidth: number
): void {
  const h = 22;
  cursor.ensureSpace(h + 4);
  const yTop = cursor.y;
  const x = PREMIUM_INVOICE_MARGIN;
  cursor.page.drawRectangle({
    x,
    y: yTop - h,
    width: fullWidth,
    height: h,
    color: PREMIUM_PDF_BG_PANEL,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.5,
  });
  cursor.page.drawText(title, { x: x + 10, y: yTop - 15, size: 10.5, font: fonts.bold, color: brand });
  cursor.y = yTop - h - 6;
}

export function fmtPremiumPdfMoney(cents: number, currency: string): string {
  const major = cents / 100;
  const formatted = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major);
  if (cents < 0) return "− " + formatted.replace(/^-/, "") + " " + currency;
  return formatted + " " + currency;
}
