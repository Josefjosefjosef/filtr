import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_AD_WEB_PLACEMENT } from "./premium-invoice-brand";
import {
  drawWrappedText,
  PremiumInvoicePdfCursor,
  PREMIUM_INVOICE_CONTENT_MIN_Y,
  PREMIUM_INVOICE_CONTENT_W,
  PREMIUM_INVOICE_FOOTER_Y,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
} from "./premium-invoice-pdf-layout";
import {
  drawPremiumPdfBrandLogo,
  drawPremiumPdfPartyBox,
  drawPremiumPdfSectionHeader,
  fmtPremiumPdfMoney,
  premiumPdfBrandRgb,
  premiumPdfBuyerLinesFromCtx,
  premiumPdfSupplierLines,
  PREMIUM_PDF_BG_PANEL,
  PREMIUM_PDF_LINE_GRAY,
  PREMIUM_PDF_TEXT_MAIN,
  PREMIUM_PDF_TEXT_MUTED,
} from "./premium-pdf-party-blocks";
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
  remaining_due_cents?: number;
  overpayment_cents?: number;
};

export async function buildPremiumCreditNotePdf(input: PremiumCreditNotePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const pages = [page];
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = premiumPdfBrandRgb();

  let cursor = new PremiumInvoicePdfCursor(page, pages, pdf, PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_MIN_Y);
  cursor.lockPageCount = true;

  drawPremiumPdfBrandLogo(page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y + 4);
  page.drawText("DOBROPIS – OPRAVNÝ ÚČETNÍ DOKLAD", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 16,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 18;
  page.drawText("Neplátce DPH – nejedná se o opravný daňový doklad", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 9,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MUTED,
  });
  cursor.y -= 22;

  const colW = (PREMIUM_INVOICE_CONTENT_W - 12) / 2;
  const leftX = PREMIUM_INVOICE_MARGIN;
  const rightX = PREMIUM_INVOICE_MARGIN + colW + 12;
  const leftMeta = [
    "Číslo dobropisu: " + input.credit_note_number,
    "Číslo původní faktury: " + input.invoice_number,
    "Číslo objednávky: " + input.ctx.evidence_reference,
  ];
  const rightMeta = [
    "Datum vystavení: " + formatAdminPragueDateTime(input.issued_at),
    "Datum uskutečnění opravy: " + formatAdminPragueDateTime(input.correction_effective_at),
    "Datum původní faktury: " + formatAdminPragueDateTime(input.invoice_issued_at),
  ];
  let yL = cursor.y;
  let yR = cursor.y;
  for (const line of leftMeta) {
    page.drawText(line, { x: leftX, y: yL, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    yL -= 12;
  }
  for (const line of rightMeta) {
    page.drawText(line, { x: rightX, y: yR, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    yR -= 12;
  }
  cursor.y = Math.min(yL, yR) - 10;

  const partyY = cursor.y;
  drawPremiumPdfPartyBox(cursor, fonts, brand, leftX, colW, "Dodavatel", premiumPdfSupplierLines());
  cursor.y = partyY;
  drawPremiumPdfPartyBox(cursor, fonts, brand, rightX, colW, "Odběratel", premiumPdfBuyerLinesFromCtx(input.ctx));
  cursor.y = Math.min(cursor.y, partyY - 130) - 6;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Původně fakturovaná reklamní služba", PREMIUM_INVOICE_CONTENT_W);
  const svc = [
    "Kategorie: " + input.ctx.category_title_cs,
    "Reklamní pozice: " + input.ctx.position_label,
    "Délka: " + String(input.ctx.duration_months) + " měsíců",
    "Režim kreativy: " + input.ctx.creative_mode_label_cs,
    "Webové umístění: " + (input.ctx.ad_web_placement_url || PREMIUM_AD_WEB_PLACEMENT),
    "Cílová URL: " + input.ctx.target_url,
  ];
  let ySvc = cursor.y;
  for (const line of svc) {
    ySvc = drawWrappedText(page, fonts.regular, line, leftX, ySvc, colW + 20, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.25);
    ySvc -= 2;
  }
  const periodH = 48;
  page.drawRectangle({
    x: rightX,
    y: cursor.y - periodH,
    width: colW,
    height: periodH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
    color: rgb(0.97, 0.98, 1),
  });
  page.drawText("Období poskytování (původní)", { x: rightX + 8, y: cursor.y - 14, size: 9, font: fonts.bold, color: brand });
  const period =
    input.ctx.campaign_start_at && input.ctx.campaign_end_at
      ? [
          "Od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at),
          "Do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at),
        ]
      : ["—"];
  let yPer = cursor.y - 28;
  for (const p of period) {
    page.drawText(p, { x: rightX + 8, y: yPer, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN });
    yPer -= 12;
  }
  cursor.y = Math.min(ySvc, cursor.y - periodH) - 8;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Položky dobropisu", PREMIUM_INVOICE_CONTENT_W);
  const tableTop = cursor.y;
  const tableH = 52;
  page.drawRectangle({
    x: leftX,
    y: tableTop - tableH,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: tableH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
  });
  page.drawRectangle({
    x: leftX,
    y: tableTop - 18,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: 18,
    color: PREMIUM_PDF_BG_PANEL,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
  });
  page.drawText("Popis", { x: leftX + 8, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  page.drawText("Období", { x: leftX + 280, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  page.drawText("Částka", { x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 70, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  const periodShort =
    input.ctx.campaign_start_at && input.ctx.campaign_end_at
      ? formatAdminPragueDateTime(input.ctx.campaign_start_at) + " – " + formatAdminPragueDateTime(input.ctx.campaign_end_at)
      : "—";
  page.drawText("Původně fakturováno", { x: leftX + 8, y: tableTop - 32, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN });
  page.drawText(periodShort, { x: leftX + 280, y: tableTop - 32, size: 8, font: fonts.regular, color: PREMIUM_PDF_TEXT_MUTED, maxWidth: 120 });
  page.drawText(fmtPremiumPdfMoney(input.original_total_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 72,
    y: tableTop - 32,
    size: 8.5,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  page.drawText("Oprava – storno / snížení", { x: leftX + 8, y: tableTop - 46, size: 8.5, font: fonts.bold, color: PREMIUM_PDF_TEXT_MAIN });
  page.drawText(periodShort, { x: leftX + 280, y: tableTop - 46, size: 8, font: fonts.regular, color: PREMIUM_PDF_TEXT_MUTED, maxWidth: 120 });
  page.drawText(fmtPremiumPdfMoney(input.correction_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 72,
    y: tableTop - 46,
    size: 9.5,
    font: fonts.bold,
    color: brand,
  });
  cursor.y = tableTop - tableH - 8;

  page.drawText("CELKOVÁ OPRAVA", { x: leftX, y: cursor.y, size: 10, font: fonts.bold, color: brand });
  page.drawText(fmtPremiumPdfMoney(input.correction_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 90,
    y: cursor.y - 2,
    size: 14,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 20;
  page.drawText("Nová cena služby po opravě:", { x: leftX, y: cursor.y, size: 9, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN });
  page.drawText(fmtPremiumPdfMoney(input.new_total_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 90,
    y: cursor.y,
    size: 10,
    font: fonts.bold,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  cursor.y -= 22;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důvod opravy", PREMIUM_INVOICE_CONTENT_W);
  cursor.y = drawWrappedText(page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, cursor.y, PREMIUM_INVOICE_CONTENT_W, 9.5, PREMIUM_PDF_TEXT_MAIN) - 8;

  const finTop = cursor.y;
  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Finanční vypořádání", PREMIUM_INVOICE_CONTENT_W / 2 - 6);
  cursor.y = finTop - 28;
  const finLines = [
    "Stav úhrady původní faktury: " + input.payment_status_label,
    input.amount_paid_cents > 0
      ? "Skutečně přijatá úhrada: " + fmtPremiumPdfMoney(input.amount_paid_cents, input.currency)
      : "Přijatá úhrada nebyla evidována (0 Kč).",
    "Zbývající cena služby po opravě: " + fmtPremiumPdfMoney(input.new_total_cents, input.currency),
  ];
  if ((input.remaining_due_cents ?? 0) > 0) {
    finLines.push("Zbývá k úhradě: " + fmtPremiumPdfMoney(input.remaining_due_cents!, input.currency));
  }
  if ((input.overpayment_cents ?? 0) > 0) {
    finLines.push("Přeplatek k vypořádání: " + fmtPremiumPdfMoney(input.overpayment_cents!, input.currency));
  }
  finLines.push("Vystavení dobropisu neznamená automatické vrácení peněz — ověřte skutečné finanční vypořádání mimo tento doklad.");
  for (const line of finLines) {
    cursor.y = drawWrappedText(page, fonts.regular, line, leftX, cursor.y, colW, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.28) - 2;
  }

  cursor.y = finTop - 28;
  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Účetní evidence", PREMIUM_INVOICE_CONTENT_W / 2 - 6);
  cursor.y = finTop - 52;
  const accLines = [
    "Datum zaúčtování: dle interní účetní evidence",
    "Odpovědná osoba: dle podpisového záznamu v účetním systému",
    "Podpisové záznamy jsou vedeny v prokazatelně propojené účetní evidenci.",
  ];
  for (const line of accLines) {
    cursor.y = drawWrappedText(page, fonts.regular, line, rightX, cursor.y, colW, 8.5, PREMIUM_PDF_TEXT_MUTED, 1.28) - 2;
  }

  page.drawRectangle({
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_FOOTER_Y + 18,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: 28,
    color: PREMIUM_PDF_BG_PANEL,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.5,
  });
  page.drawText("Původní faktura zůstává zachována. Tento doklad opravuje fakturovanou částku a stornuje odpovídající část objednané služby.", {
    x: PREMIUM_INVOICE_MARGIN + 8,
    y: PREMIUM_INVOICE_FOOTER_Y + 28,
    size: 8,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
    maxWidth: PREMIUM_INVOICE_CONTENT_W - 16,
  });

  page.drawText("Děkujeme za spolupráci.", {
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_FOOTER_Y - 2,
    size: 8,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MUTED,
  });
  drawPremiumPdfBrandLogo(page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_FOOTER_Y - 8);

  return pdf.save();
}
