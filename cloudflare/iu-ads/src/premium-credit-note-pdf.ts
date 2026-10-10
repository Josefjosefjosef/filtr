import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import { PREMIUM_INVOICE_CONTENT_W, PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_PAGE, drawWrappedText } from "./premium-invoice-pdf-layout";
import { registerPremiumPdfFonts } from "./premium-pdf-font";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import type { PremiumOrderPdfContext } from "./premium-order-pdf-fields";

export type PremiumCreditNotePdfInput = {
  ctx: PremiumOrderPdfContext;
  credit_note_number: string;
  invoice_number: string;
  invoice_issued_at: string;
  issued_at: string;
  correction_effective_at: string;
  original_total_cents: number;
  correction_cents: number;
  new_total_cents: number;
  currency: string;
  reason: string;
  payment_status_label: string;
  amount_paid_cents: number;
};

function hexRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major) + " " + currency;
  } catch {
    return String(major) + " " + currency;
  }
}

export async function buildPremiumCreditNotePdf(input: PremiumCreditNotePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const textMain = rgb(0.1, 0.1, 0.12);
  const textMuted = rgb(0.4, 0.42, 0.48);

  let y = PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN;
  page.drawText("Dobropis – opravný účetní doklad", { x: PREMIUM_INVOICE_MARGIN, y, size: 16, font: fonts.bold, color: brand });
  y -= 24;
  const meta = [
    "Číslo dobropisu: " + input.credit_note_number,
    "Číslo původní faktury: " + input.invoice_number,
    "Číslo objednávky: " + input.ctx.evidence_reference,
    "Datum vystavení: " + formatAdminPragueDateTime(input.issued_at),
    "Datum uskutečnění opravy: " + formatAdminPragueDateTime(input.correction_effective_at),
    "Datum původní faktury: " + formatAdminPragueDateTime(input.invoice_issued_at),
    "Měna: " + input.currency,
  ];
  for (const line of meta) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: 9, font: fonts.regular, color: textMain });
    y -= 12;
  }
  y -= 8;

  page.drawText("Dodavatel", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  page.drawText("Odběratel", { x: PREMIUM_INVOICE_MARGIN + PREMIUM_INVOICE_CONTENT_W / 2, y, size: 10, font: fonts.bold, color: brand });
  y -= 14;
  let yL = y;
  for (const line of [
    PREMIUM_INVOICE_SUPPLIER.companyName,
    PREMIUM_INVOICE_SUPPLIER.street + ", " + PREMIUM_INVOICE_SUPPLIER.zip + " " + PREMIUM_INVOICE_SUPPLIER.city,
    "IČO: " + PREMIUM_INVOICE_SUPPLIER.ico,
    PREMIUM_INVOICE_SUPPLIER.nonVatNotice,
  ]) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y: yL, size: 8.5, font: fonts.regular, color: textMain });
    yL -= 11;
  }
  yL = y;
  for (const line of [
    input.ctx.company_name,
    input.ctx.billing_street + ", " + input.ctx.billing_zip + " " + input.ctx.billing_city,
    "IČO: " + input.ctx.ico,
    input.ctx.dic ? "DIČ: " + input.ctx.dic : "",
  ].filter(Boolean)) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN + PREMIUM_INVOICE_CONTENT_W / 2, y: yL, size: 8.5, font: fonts.regular, color: textMain });
    yL -= 11;
  }
  y = Math.min(y - 44, yL) - 10;

  page.drawText("Položky dobropisu", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 16;
  page.drawText("Původně fakturováno: " + fmtMoney(input.original_total_cents, input.currency), {
    x: PREMIUM_INVOICE_MARGIN,
    y,
    size: 9,
    font: fonts.regular,
    color: textMain,
  });
  y -= 14;
  page.drawText("Oprava – storno / snížení: " + fmtMoney(input.correction_cents, input.currency), {
    x: PREMIUM_INVOICE_MARGIN,
    y,
    size: 11,
    font: fonts.bold,
    color: brand,
  });
  y -= 16;
  page.drawText("Nová cena po opravě: " + fmtMoney(input.new_total_cents, input.currency), {
    x: PREMIUM_INVOICE_MARGIN,
    y,
    size: 9,
    font: fonts.regular,
    color: textMain,
  });
  y -= 20;

  page.drawText("Důvod opravy", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 12;
  y = drawWrappedText(page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, y, PREMIUM_INVOICE_CONTENT_W, 9, textMain) - 10;

  page.drawText("Finanční vypořádání", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 12;
  const finLines = [
    "Stav úhrady původní faktury: " + input.payment_status_label,
    input.amount_paid_cents > 0
      ? "Evidovaná přijatá úhrada: " + fmtMoney(input.amount_paid_cents, input.currency)
      : "Úhrada nebyla evidována jako přijatá",
    "Vystavení dobropisu neznamená automatické vrácení peněz — ověřte skutečné finanční vypořádání.",
    "Účetní zaúčtování: k ověření odpovědnou osobou před produkčním použitím.",
  ];
  for (const line of finLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: 8.5, font: fonts.regular, color: textMain, maxWidth: PREMIUM_INVOICE_CONTENT_W });
    y -= 11;
  }

  page.drawText("Původní faktura zůstává v evidenci. Tento doklad opravuje fakturovanou částku.", {
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_MARGIN + 10,
    size: 7.5,
    font: fonts.regular,
    color: textMuted,
    maxWidth: PREMIUM_INVOICE_CONTENT_W,
  });

  return pdf.save();
}
