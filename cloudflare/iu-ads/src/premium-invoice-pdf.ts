import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_AD_WEB_PLACEMENT, PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { buildPremiumInvoiceQrPng } from "./premium-invoice-qr";
import { buildPremiumInvoiceSpayd } from "./premium-invoice-spayd";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import { resolvePremiumInvoiceVat } from "./premium-invoice-vat";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { registerPremiumPdfFont } from "./premium-pdf-font";

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

function drawTextBold(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<typeof registerPremiumPdfFont>>,
  text: string,
  x: number,
  y: number,
  size: number,
  color = rgb(0.1, 0.1, 0.12)
) {
  page.drawText(text, { x, y, size: size + 0.5, font, color });
}

function drawBrandLogo(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<typeof registerPremiumPdfFont>>,
  rightX: number,
  topY: number
) {
  const brandBlue = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const infoW = font.widthOfTextAtSize("info", 14);
  const uzelW = font.widthOfTextAtSize("Uzel.cz", 14);
  const totalW = infoW + uzelW;
  const startX = rightX - totalW;
  page.drawText("info", { x: startX, y: topY, size: 14, font, color: rgb(0, 0, 0) });
  page.drawText("Uzel.cz", { x: startX + infoW, y: topY, size: 14, font, color: brandBlue });
}

/** Server-side invoice PDF aligned with infoUzel invoice module (brand, sections, non-VAT, QR Platba). */
export async function buildPremiumInvoicePdf(input: PremiumInvoicePdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await registerPremiumPdfFont(pdfDoc);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const brand = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const sup = PREMIUM_INVOICE_SUPPLIER;
  const vatLine = resolvePremiumInvoiceVat(input.total_cents, input.issued_at);
  let y = 800;

  drawBrandLogo(page, font, 547, 812);

  page.drawText("Faktura — daňový doklad", { x: 48, y, size: 19, font, color: brand });
  y -= 24;
  drawTextBold(page, font, "Číslo faktury: " + input.invoice_number, 48, y, 11);
  y -= 16;
  page.drawText("Číslo objednávky: " + input.order_reference, { x: 48, y, size: 10, font });
  y -= 26;

  page.drawText("Dodavatel", { x: 48, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 14;
  const supplierLines = [
    sup.companyName,
    sup.street + ", " + sup.zip + " " + sup.city,
    "IČO: " + sup.ico,
    "Zapsána v obchodním rejstříku vedeném " +
      sup.commercialRegisterCourt +
      ", oddíl " +
      sup.commercialRegisterSection +
      ", vložka " +
      sup.commercialRegisterInsert,
    sup.nonVatNotice,
    "E-mail: " + sup.email,
  ];
  for (const line of supplierLines) {
    page.drawText(line, { x: 48, y, size: 10, font, maxWidth: 340 });
    y -= 13;
  }
  y -= 8;

  page.drawText("Odběratel", { x: 48, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 14;
  page.drawText(input.buyer_company, { x: 48, y, size: 10, font });
  y -= 13;
  page.drawText("IČO: " + input.buyer_ico, { x: 48, y, size: 10, font });
  y -= 13;
  if (input.buyer_dic) {
    page.drawText("DIČ: " + input.buyer_dic, { x: 48, y, size: 10, font });
    y -= 13;
  }
  for (const line of input.buyer_address_lines) {
    if (!line.trim()) continue;
    page.drawText(line, { x: 48, y, size: 10, font });
    y -= 13;
  }
  y -= 8;

  drawTextBold(page, font, "Datum splatnosti: " + isoToCsDate(input.due_at), 48, y, 10);
  y -= 14;
  const meta = [
    "Datum vystavení: " + isoToCsDate(input.issued_at),
    "DUZP: " + isoToCsDate(input.taxable_date),
    "Variabilní symbol: " + input.variable_symbol,
    "Způsob úhrady: převodem",
  ];
  for (const line of meta) {
    page.drawText(line, { x: 48, y, size: 9, font });
    y -= 12;
  }
  y -= 12;

  page.drawText("Položka", { x: 48, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 16;
  const serviceBlock =
    input.line_description +
    "\nWebové umístění reklamy: " +
    PREMIUM_AD_WEB_PLACEMENT +
    "\nKategorie: " +
    input.category_title_cs +
    " · Pozice: " +
    input.position_label +
    " · Délka: " +
    String(input.duration_months) +
    " měsíců";
  for (const line of serviceBlock.split("\n")) {
    page.drawText(line, { x: 48, y, size: 10, font, maxWidth: 340 });
    y -= 14;
  }
  y -= 4;
  page.drawText(
    "Období služby: " +
      formatAdminPragueDateTime(input.service_period_start) +
      " – " +
      formatAdminPragueDateTime(input.service_period_end),
    { x: 48, y, size: 9, font,
      maxWidth: 340 }
  );
  y -= 28;

  page.drawText("Celkem k úhradě:", { x: 48, y, size: 11, font });
  drawTextBold(page, font, fmtMoneyCents(vatLine.grossCents, input.currency), 380, y, 13, brand);
  y -= 20;
  if (vatLine.nonVatNotice) {
    page.drawText(vatLine.nonVatNotice, { x: 48, y, size: 9, font });
    y -= 14;
  }

  const payY = 120;
  page.drawText("Platební údaje", { x: 48, y: payY + 52, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  drawTextBold(page, font, "Účet: " + sup.accountNumber + "/" + sup.bankCode, 48, payY + 36, 10);
  drawTextBold(page, font, "Variabilní symbol: " + input.variable_symbol, 48, payY + 20, 10);
  page.drawText("QR Platba", { x: 400, y: payY + 52, size: 9, font, color: rgb(0.35, 0.35, 0.4) });

  try {
    const spayd = buildPremiumInvoiceSpayd({
      amountCents: input.total_cents,
      currency: input.currency,
      variableSymbol: input.variable_symbol,
      message: "Faktura " + input.invoice_number,
    });
    const qrPng = await buildPremiumInvoiceQrPng(spayd, 160);
    const qrImg = await pdfDoc.embedPng(qrPng);
    const qrSize = 110;
    page.drawImage(qrImg, { x: 400, y: payY - 8, width: qrSize, height: qrSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error("invoice_qr_embed_failed:" + msg.slice(0, 200));
  }

  page.drawText("Splatnost: 3 kalendářní dny od vystavení.", { x: 48, y: 40, size: 8.5, font, color: rgb(0.4, 0.4, 0.45) });

  return pdfDoc.save();
}
