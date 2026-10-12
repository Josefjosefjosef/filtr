import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_AD_WEB_PLACEMENT } from "./premium-invoice-brand";
import {
  drawWrappedText,
  measureWrappedHeight,
  PremiumInvoicePdfCursor,
  PREMIUM_INVOICE_CONTENT_MIN_Y,
  PREMIUM_INVOICE_CONTENT_W,
  PREMIUM_INVOICE_FOOTER_Y,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
  wrapTextLines,
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
  /** When set, reklama byla vypnuta na webu (provozní záznam). */
  ad_turned_off_at?: string | null;
  ad_was_published?: boolean;
};

export async function buildPremiumCreditNotePdf(input: PremiumCreditNotePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const pages = [page];
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = premiumPdfBrandRgb();

  let cursor = new PremiumInvoicePdfCursor(page, pages, pdf, PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_MIN_Y);

  drawPremiumPdfBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y + 4);
  cursor.page.drawText("DOBROPIS – OPRAVNÝ ÚČETNÍ DOKLAD", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 16,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 18;
  cursor.page.drawText("Neplátce DPH – nejedná se o opravný daňový doklad", {
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
    cursor.page.drawText(line, { x: leftX, y: yL, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    yL -= 12;
  }
  for (const line of rightMeta) {
    cursor.page.drawText(line, { x: rightX, y: yR, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    yR -= 12;
  }
  cursor.y = Math.min(yL, yR) - 10;

  const partyY = cursor.y;
  drawPremiumPdfPartyBox(cursor, fonts, brand, leftX, colW, "Dodavatel", premiumPdfSupplierLines());
  cursor.y = partyY;
  drawPremiumPdfPartyBox(cursor, fonts, brand, rightX, colW, "Odběratel", premiumPdfBuyerLinesFromCtx(input.ctx));
  cursor.y = Math.min(cursor.y, partyY - 130) - 6;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Původně fakturovaná reklamní služba", PREMIUM_INVOICE_CONTENT_W);
  const svcTop = cursor.y;
  const svc = [
    "Kategorie: " + input.ctx.category_title_cs,
    "Reklamní pozice: " + input.ctx.position_label,
    "Délka: " + String(input.ctx.duration_months) + " měsíců",
    "Režim kreativy: " + input.ctx.creative_mode_label_cs,
    "Webové umístění: " + (input.ctx.ad_web_placement_url || PREMIUM_AD_WEB_PLACEMENT),
    "Cílová URL: " + input.ctx.target_url,
  ];
  let ySvc = svcTop;
  for (const line of svc) {
    ySvc = drawWrappedText(cursor.page, fonts.regular, line, leftX, ySvc, colW + 20, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.25);
    ySvc -= 2;
  }
  const periodH = 56;
  cursor.page.drawRectangle({
    x: rightX,
    y: svcTop - periodH,
    width: colW,
    height: periodH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
    color: rgb(0.97, 0.98, 1),
  });
  const periodBoxTop = svcTop;
  cursor.page.drawText("Období poskytování (původní)", { x: rightX + 8, y: periodBoxTop - 14, size: 9, font: fonts.bold, color: brand });
  const period: string[] =
    input.ctx.campaign_start_at && input.ctx.campaign_end_at
      ? [
          "Od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at),
          "Do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at),
        ]
      : ["—"];
  if (input.ad_was_published && input.ad_turned_off_at) {
    period.push("Reklama vypnuta: " + formatAdminPragueDateTime(input.ad_turned_off_at));
  }
  let yPer = periodBoxTop - 28;
  for (const p of period) {
    yPer = drawWrappedText(cursor.page, fonts.regular, p, rightX + 8, yPer, colW - 16, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.22);
    yPer -= 2;
  }
  cursor.y = Math.min(ySvc, periodBoxTop - periodH) - 8;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Položky dobropisu", PREMIUM_INVOICE_CONTENT_W);
  const tableTop = cursor.y;
  const descColW = 208;
  const periodColW = 148;
  const periodColX = leftX + 8 + descColW + 6;
  const amtColX = PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 78;
  const periodShort =
    input.ctx.campaign_start_at && input.ctx.campaign_end_at
      ? formatAdminPragueDateTime(input.ctx.campaign_start_at) + " – " + formatAdminPragueDateTime(input.ctx.campaign_end_at)
      : "—";
  const periodLines = wrapTextLines(fonts.regular, periodShort, 7.5, periodColW);
  const periodBlockH = measureWrappedHeight(Math.max(1, periodLines.length), 7.5, 1.22);
  const row1H = Math.max(14, periodBlockH + 4);
  const row2H = Math.max(14, periodBlockH + 4);
  const tableH = 18 + row1H + row2H + 6;
  cursor.page.drawRectangle({
    x: leftX,
    y: tableTop - tableH,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: tableH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawRectangle({
    x: leftX,
    y: tableTop - 18,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: 18,
    color: PREMIUM_PDF_BG_PANEL,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawText("Popis", { x: leftX + 8, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  cursor.page.drawText("Období", { x: periodColX, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  cursor.page.drawText("Částka", { x: amtColX, y: tableTop - 13, size: 8.5, font: fonts.bold, color: brand });
  const row1Y = tableTop - 18 - 12;
  cursor.page.drawText("Původně fakturováno", { x: leftX + 8, y: row1Y, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN });
  drawWrappedText(cursor.page, fonts.regular, periodShort, periodColX, row1Y, periodColW, 7.5, PREMIUM_PDF_TEXT_MUTED, 1.22);
  cursor.page.drawText(fmtPremiumPdfMoney(input.original_total_cents, input.currency), {
    x: amtColX,
    y: row1Y,
    size: 8.5,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  const correctionLabel =
    input.new_total_cents === 0 && input.correction_cents === -input.original_total_cents
      ? "Oprava – storno celé služby"
      : "Oprava – storno / snížení";
  const row2Y = tableTop - 18 - row1H - 12;
  cursor.page.drawText(correctionLabel, { x: leftX + 8, y: row2Y, size: 8.5, font: fonts.bold, color: PREMIUM_PDF_TEXT_MAIN });
  drawWrappedText(cursor.page, fonts.regular, periodShort, periodColX, row2Y, periodColW, 7.5, PREMIUM_PDF_TEXT_MUTED, 1.22);
  cursor.page.drawText(fmtPremiumPdfMoney(input.correction_cents, input.currency), {
    x: amtColX,
    y: row2Y,
    size: 9.5,
    font: fonts.bold,
    color: brand,
  });
  cursor.y = tableTop - tableH - 10;

  const totalY = cursor.y;
  cursor.page.drawLine({
    start: { x: leftX, y: totalY + 6 },
    end: { x: leftX + PREMIUM_INVOICE_CONTENT_W, y: totalY + 6 },
    thickness: 0.6,
    color: PREMIUM_PDF_LINE_GRAY,
  });
  cursor.page.drawText("CELKOVÁ OPRAVA", { x: leftX, y: cursor.y, size: 10, font: fonts.bold, color: brand });
  cursor.page.drawText(fmtPremiumPdfMoney(input.correction_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 90,
    y: cursor.y - 2,
    size: 14,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 20;
  cursor.page.drawText("Nová cena služby po opravě:", { x: leftX, y: cursor.y, size: 9, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN });
  cursor.page.drawText(fmtPremiumPdfMoney(input.new_total_cents, input.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 90,
    y: cursor.y,
    size: 10,
    font: fonts.bold,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  cursor.y -= 22;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důvod opravy", PREMIUM_INVOICE_CONTENT_W);
  const reasonTop = cursor.y;
  cursor.y =
    drawWrappedText(cursor.page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, reasonTop, PREMIUM_INVOICE_CONTENT_W, 9.5, PREMIUM_PDF_TEXT_MAIN) - 8;

  cursor.ensureSpace(110);
  const finTop = cursor.y;
  cursor.page.drawText("Finanční vypořádání", { x: leftX, y: finTop, size: 10, font: fonts.bold, color: brand });
  cursor.page.drawText("Účetní evidence", { x: rightX, y: finTop, size: 10, font: fonts.bold, color: brand });
  let yFinL = finTop - 16;
  let yFinR = finTop - 16;
  const finLines = [
    "Stav úhrady původní faktury: " + input.payment_status_label,
    input.amount_paid_cents > 0
      ? "Skutečně přijatá úhrada: " + fmtPremiumPdfMoney(input.amount_paid_cents, input.currency)
      : "Přijatá úhrada nebyla evidována (0 Kč).",
    "Způsob finančního vypořádání není v tomto dokladu automaticky evidován — vyřiďte jej mimo systém dle skutečné situace.",
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
    yFinL = drawWrappedText(cursor.page, fonts.regular, line, leftX, yFinL, colW, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.28) - 2;
  }
  const accLines = [
    "Datum zaúčtování: uvedeno v interním účetním systému mimo tento PDF doklad.",
    "Odpovědná osoba: dle interního postupu provozovatele.",
    "Tento dobropis je propojen s původní fakturou " + input.invoice_number + " a objednávkou " + input.ctx.evidence_reference + ".",
  ];
  for (const line of accLines) {
    yFinR = drawWrappedText(cursor.page, fonts.regular, line, rightX, yFinR, colW, 8.5, PREMIUM_PDF_TEXT_MUTED, 1.28) - 2;
  }
  cursor.y = Math.min(yFinL, yFinR) - 6;
  cursor.ensureSpace(PREMIUM_INVOICE_FOOTER_Y - PREMIUM_INVOICE_CONTENT_MIN_Y + 36);
  const footerPage = cursor.page;

  footerPage.drawRectangle({
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_FOOTER_Y + 18,
    width: PREMIUM_INVOICE_CONTENT_W,
    height: 28,
    color: PREMIUM_PDF_BG_PANEL,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.5,
  });
  footerPage.drawText("Původní faktura zůstává zachována. Tento doklad opravuje fakturovanou částku a stornuje odpovídající část objednané služby.", {
    x: PREMIUM_INVOICE_MARGIN + 8,
    y: PREMIUM_INVOICE_FOOTER_Y + 28,
    size: 8,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
    maxWidth: PREMIUM_INVOICE_CONTENT_W - 16,
  });

  footerPage.drawText("Děkujeme za spolupráci.", {
    x: PREMIUM_INVOICE_MARGIN,
    y: PREMIUM_INVOICE_FOOTER_Y - 2,
    size: 8,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MUTED,
  });
  return pdf.save();
}
