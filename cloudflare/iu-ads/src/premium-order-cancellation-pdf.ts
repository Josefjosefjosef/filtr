import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import {
  PREMIUM_INVOICE_CONTENT_W,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
  drawWrappedText,
} from "./premium-invoice-pdf-layout";
import { registerPremiumPdfFonts } from "./premium-pdf-font";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import type { PremiumOrderPdfContext } from "./premium-order-pdf-fields";

export type PremiumOrderCancellationPdfInput = {
  ctx: PremiumOrderPdfContext;
  storno_number: string;
  storno_kind: "rejection" | "cancellation";
  reason: string;
  issued_at: string;
  issuer_display_name: string;
  invoice_number: string | null;
  credit_note_number: string | null;
  order_was_approved: boolean;
  ad_was_published: boolean;
  ad_turned_off_at: string | null;
  payment_status_label: string;
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

export async function buildPremiumOrderCancellationPdf(input: PremiumOrderCancellationPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const textMain = rgb(0.1, 0.1, 0.12);
  const textMuted = rgb(0.4, 0.42, 0.48);
  const stornoRed = rgb(0.78, 0.12, 0.12);

  let y = PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN;
  page.drawText("Potvrzení o stornování objednávky", { x: PREMIUM_INVOICE_MARGIN, y, size: 18, font: fonts.bold, color: brand });
  y -= 22;
  page.drawText("— Potvrzení o zrušení objednávky reklamní služby", {
    x: PREMIUM_INVOICE_MARGIN,
    y,
    size: 10,
    font: fonts.regular,
    color: brand,
  });
  y -= 28;

  const metaLines = [
    "Číslo storna: " + input.storno_number,
    "Číslo objednávky: " + input.ctx.evidence_reference,
    input.invoice_number ? "Číslo faktury: " + input.invoice_number : null,
    "Datum vystavení: " + formatAdminPragueDateTime(input.issued_at),
    "Vystavil: " + input.issuer_display_name,
  ].filter(Boolean) as string[];
  for (const line of metaLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: 9, font: fonts.regular, color: textMain });
    y -= 12;
  }

  const boxW = 150;
  const boxX = PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - boxW;
  page.drawRectangle({
    x: boxX,
    y: PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN - 52,
    width: boxW,
    height: 48,
    borderColor: stornoRed,
    borderWidth: 1.5,
  });
  page.drawText("STORNO", { x: boxX + 42, y: PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN - 28, size: 16, font: fonts.bold, color: stornoRed });
  page.drawText(
    input.storno_kind === "rejection" ? "Objednávka zamítnuta" : "Objednávka stornována",
    { x: boxX + 8, y: PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN - 44, size: 7.5, font: fonts.regular, color: textMuted, maxWidth: boxW - 12 }
  );

  y -= 10;
  page.drawText("Poskytovatel", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  page.drawText("Objednatel", { x: PREMIUM_INVOICE_MARGIN + PREMIUM_INVOICE_CONTENT_W / 2, y, size: 10, font: fonts.bold, color: brand });
  y -= 14;
  const supplierLines = [
    PREMIUM_INVOICE_SUPPLIER.companyName,
    PREMIUM_INVOICE_SUPPLIER.street + ", " + PREMIUM_INVOICE_SUPPLIER.zip + " " + PREMIUM_INVOICE_SUPPLIER.city,
    "IČO: " + PREMIUM_INVOICE_SUPPLIER.ico,
    PREMIUM_INVOICE_SUPPLIER.email,
  ];
  const buyerLines = [
    input.ctx.company_name,
    input.ctx.billing_street + ", " + input.ctx.billing_zip + " " + input.ctx.billing_city,
    "IČO: " + input.ctx.ico,
    input.ctx.dic ? "DIČ: " + input.ctx.dic : "",
  ].filter(Boolean);
  let yL = y;
  for (const line of supplierLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y: yL, size: 8.5, font: fonts.regular, color: textMain });
    yL -= 11;
  }
  yL = y;
  for (const line of buyerLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN + PREMIUM_INVOICE_CONTENT_W / 2, y: yL, size: 8.5, font: fonts.regular, color: textMain });
    yL -= 11;
  }
  y = Math.min(y - supplierLines.length * 11, yL) - 8;

  page.drawText("Předmět objednané reklamní služby", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 14;
  const serviceLines = [
    "Kategorie: " + input.ctx.category_title_cs,
    "Reklamní pozice: " + input.ctx.position_label,
    "Délka poskytování: " + String(input.ctx.duration_months) + " měsíců",
    "Režim kreativy: " + input.ctx.creative_mode_label_cs,
    "Cílová URL: " + input.ctx.target_url,
    "Původní cena: " + fmtMoney(input.ctx.price_cents, input.ctx.currency),
  ];
  for (const line of serviceLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: 8.5, font: fonts.regular, color: textMain, maxWidth: PREMIUM_INVOICE_CONTENT_W });
    y -= 11;
  }
  y -= 6;

  page.drawText("Důvod storna", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 12;
  y = drawWrappedText(page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, y, PREMIUM_INVOICE_CONTENT_W, 9, textMain) - 8;

  const statusLines = [
    "Datum vytvoření objednávky: " + formatAdminPragueDateTime(input.ctx.order_created_at),
    input.order_was_approved
      ? "Objednávka byla schválena" + (input.ctx.published_at ? " a zveřejněna " + formatAdminPragueDateTime(input.ctx.published_at) : "")
      : "Objednávka nebyla schválena — reklama nebyla zveřejněna",
    input.ad_turned_off_at
      ? "Reklama definitivně vypnuta: " + formatAdminPragueDateTime(input.ad_turned_off_at)
      : input.ad_was_published && !input.ad_turned_off_at
        ? "Reklama nebyla evidována jako definitivně vypnutá v době storna"
        : null,
    "Stav úhrady faktury: " + input.payment_status_label,
    input.credit_note_number ? "Dobropis: " + input.credit_note_number : null,
  ].filter(Boolean) as string[];
  page.drawText("Stav a související doklady", { x: PREMIUM_INVOICE_MARGIN, y, size: 10, font: fonts.bold, color: brand });
  y -= 12;
  for (const line of statusLines) {
    page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: 8.5, font: fonts.regular, color: textMain, maxWidth: PREMIUM_INVOICE_CONTENT_W });
    y -= 11;
  }

  page.drawText("Dokument vznikl automaticky v administraci infoUzel Ads.", {
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_MARGIN,
    size: 7.5,
    font: fonts.regular,
    color: textMuted,
  });

  return pdf.save();
}
