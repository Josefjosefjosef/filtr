import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
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
};

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

/** Server-side invoice PDF aligned with infoUzel invoice module layout (brand, sections, non-VAT). */
export async function buildPremiumInvoicePdf(input: PremiumInvoicePdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await registerPremiumPdfFont(pdfDoc);
  const page = pdfDoc.addPage([595.28, 841.89]);
  const brand = rgb(0, 60 / 255, 1);
  let y = 800;

  page.drawText("Faktura — daňový doklad", { x: 48, y, size: 19, font, color: brand });
  y -= 22;
  page.drawText("Číslo faktury: " + input.invoice_number, { x: 48, y, size: 10.5, font });
  y -= 28;

  page.drawText("Dodavatel", { x: 48, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 14;
  const sup = PREMIUM_INVOICE_SUPPLIER;
  const supplierLines = [
    sup.companyName,
    sup.street + ", " + sup.zip + " " + sup.city,
    "IČO: " + sup.ico,
    sup.nonVatNotice,
    "E-mail: " + sup.email,
    "Účet: " + sup.accountNumber + "/" + sup.bankCode,
  ];
  for (const line of supplierLines) {
    page.drawText(line, { x: 48, y, size: 10, font });
    y -= 13;
  }
  y -= 10;

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
    page.drawText(line, { x: 48, y, size: 10, font });
    y -= 13;
  }
  y -= 10;

  const meta = [
    "Datum vystavení: " + isoToCsDate(input.issued_at),
    "Datum splatnosti: " + isoToCsDate(input.due_at),
    "DUZP: " + isoToCsDate(input.taxable_date),
    "Variabilní symbol: " + input.variable_symbol,
    "Způsob úhrady: převodem",
  ];
  for (const line of meta) {
    page.drawText(line, { x: 48, y, size: 9, font });
    y -= 12;
  }
  y -= 14;

  page.drawText("Položka", { x: 48, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
  y -= 16;
  page.drawText(input.line_description, { x: 48, y, size: 10, font, maxWidth: 500 });
  y -= 28;
  page.drawText(
    "Období služby: " +
      formatAdminPragueDateTime(input.service_period_start) +
      " – " +
      formatAdminPragueDateTime(input.service_period_end),
    { x: 48, y, size: 9, font }
  );
  y -= 24;

  page.drawText("Celkem k úhradě:", { x: 48, y, size: 10, font });
  page.drawText(fmtMoneyCents(input.total_cents, input.currency), { x: 400, y, size: 10, font });
  y -= 18;
  if (!sup.vatPayer) {
    page.drawText("Cena není předmětem DPH (dodavatel není plátce DPH).", { x: 48, y, size: 9, font });
    y -= 14;
  }

  page.drawText("Splatnost: 3 kalendářní dny od vystavení.", { x: 48, y: 40, size: 8.5, font, color: rgb(0.4, 0.4, 0.45) });

  return pdfDoc.save();
}
