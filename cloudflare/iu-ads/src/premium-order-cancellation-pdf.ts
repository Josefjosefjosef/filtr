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
  PREMIUM_PDF_LINE_GRAY,
  PREMIUM_PDF_TEXT_MAIN,
  PREMIUM_PDF_TEXT_MUTED,
} from "./premium-pdf-party-blocks";
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
  storno_amount_cents?: number | null;
  variable_symbol?: string | null;
};

export async function buildPremiumOrderCancellationPdf(input: PremiumOrderCancellationPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const pages = [page];
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = premiumPdfBrandRgb();
  const stornoRed = rgb(0.78, 0.12, 0.12);

  let cursor = new PremiumInvoicePdfCursor(page, pages, pdf, PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_MIN_Y);

  drawPremiumPdfBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y + 4);
  cursor.page.drawText("Storno objednávky", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 20,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 22;
  cursor.page.drawText("— Potvrzení o zrušení objednávky reklamní služby", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 10,
    font: fonts.regular,
    color: brand,
  });
  cursor.y -= 20;

  const metaStartY = cursor.y;
  const metaLines: { label: string; value: string }[] = [
    { label: "Číslo storna:", value: input.storno_number },
    { label: "Číslo objednávky:", value: input.ctx.evidence_reference },
  ];
  if (input.invoice_number) metaLines.push({ label: "Číslo faktury:", value: input.invoice_number });
  metaLines.push(
    { label: "Datum vystavení:", value: formatAdminPragueDateTime(input.issued_at) },
    { label: "Vystavil:", value: input.issuer_display_name }
  );
  for (const row of metaLines) {
    cursor.page.drawText(row.label, { x: PREMIUM_INVOICE_MARGIN, y: cursor.y, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MUTED });
    cursor.page.drawText(row.value, { x: PREMIUM_INVOICE_MARGIN + 118, y: cursor.y, size: 9, font: fonts.bold, color: PREMIUM_PDF_TEXT_MAIN });
    cursor.y -= 13;
  }

  const boxW = 158;
  const boxH = 52;
  const boxX = PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - boxW;
  const boxY = metaStartY - boxH + 8;
  cursor.page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, borderColor: stornoRed, borderWidth: 1.6, color: rgb(1, 1, 1) });
  cursor.page.drawText("STORNO", { x: boxX + 46, y: boxY + boxH - 26, size: 17, font: fonts.bold, color: stornoRed });
  const stornoNote =
    input.storno_kind === "rejection"
      ? "Objednávka byla zamítnuta."
      : "Objednávka a reklamní služba byla zrušena.";
  drawWrappedText(cursor.page, fonts.regular, stornoNote, boxX + 8, boxY + boxH - 40, boxW - 16, 7.5, PREMIUM_PDF_TEXT_MUTED, 1.2);

  cursor.y -= 8;
  const colW = (PREMIUM_INVOICE_CONTENT_W - 12) / 2;
  const leftX = PREMIUM_INVOICE_MARGIN;
  const rightX = PREMIUM_INVOICE_MARGIN + colW + 12;
  const partyYBefore = cursor.y;
  drawPremiumPdfPartyBox(cursor, fonts, brand, leftX, colW, "Poskytovatel (provozovatel)", premiumPdfSupplierLines());
  cursor.y = partyYBefore;
  drawPremiumPdfPartyBox(cursor, fonts, brand, rightX, colW, "Objednatel", premiumPdfBuyerLinesFromCtx(input.ctx));
  cursor.y = Math.min(cursor.y, partyYBefore - 120) - 4;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Předmět objednané reklamní služby", PREMIUM_INVOICE_CONTENT_W);
  const serviceLeft = [
    "Kategorie: " + input.ctx.category_title_cs,
    "Reklamní pozice: " + input.ctx.position_label,
    "Délka poskytování: " + String(input.ctx.duration_months) + " měsíců",
    "Režim kreativy: " + input.ctx.creative_mode_label_cs,
    "Webové umístění: " + (input.ctx.ad_web_placement_url || PREMIUM_AD_WEB_PLACEMENT),
    "Cílová URL: " + input.ctx.target_url,
  ];
  cursor.ensureSpace(90);
  const blockTop = cursor.y;
  let yLeft = blockTop;
  for (const line of serviceLeft) {
    yLeft = drawWrappedText(cursor.page, fonts.regular, line, leftX, yLeft, colW, 9, PREMIUM_PDF_TEXT_MAIN, 1.28);
    yLeft -= 2;
  }
  const periodW = colW - 8;
  const periodX = rightX + 4;
  const periodTop = blockTop;
  const periodH = 52;
  cursor.page.drawRectangle({
    x: periodX,
    y: periodTop - periodH,
    width: periodW,
    height: periodH,
    borderColor: PREMIUM_PDF_LINE_GRAY,
    borderWidth: 0.6,
    color: rgb(0.97, 0.98, 1),
  });
  cursor.page.drawText("Období poskytování (původní)", {
    x: periodX + 8,
    y: periodTop - 14,
    size: 9,
    font: fonts.bold,
    color: brand,
  });
  const periodLines =
    input.ctx.campaign_start_at && input.ctx.campaign_end_at
      ? [
          "Od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at),
          "Do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at),
        ]
      : ["Období bude doplněno z evidence kampaně."];
  let yP = periodTop - 28;
  for (const pl of periodLines) {
    cursor.page.drawText(pl, { x: periodX + 8, y: yP, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: periodW - 16 });
    yP -= 12;
  }
  cursor.y = Math.min(yLeft, periodTop - periodH) - 10;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Cena reklamní služby (původní objednávka)", PREMIUM_INVOICE_CONTENT_W);
  cursor.page.drawText("Cena je uvedena bez DPH (poskytovatel není plátce DPH).", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 8,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MUTED,
  });
  cursor.page.drawText(fmtPremiumPdfMoney(input.ctx.price_cents, input.ctx.currency), {
    x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - 120,
    y: cursor.y - 2,
    size: 16,
    font: fonts.bold,
    color: brand,
  });
  cursor.y -= 28;

  const statusLeft: string[] = ["Stav objednávky:"];
  statusLeft.push("Vytvořeno: " + formatAdminPragueDateTime(input.ctx.order_created_at));
  if (input.ctx.approved_at) statusLeft.push("Schváleno: " + formatAdminPragueDateTime(input.ctx.approved_at));
  if (input.ctx.published_at) statusLeft.push("Zveřejněno: " + formatAdminPragueDateTime(input.ctx.published_at));
  if (input.ctx.campaign_end_at) statusLeft.push("Plánované ukončení: " + formatAdminPragueDateTime(input.ctx.campaign_end_at));

  const statusRight: string[] = ["Související doklady:"];
  statusRight.push("Objednávka: " + input.ctx.evidence_reference);
  if (input.invoice_number) statusRight.push("Faktura: " + input.invoice_number);
  if (input.variable_symbol) statusRight.push("Variabilní symbol: " + input.variable_symbol);
  if (input.credit_note_number) statusRight.push("Dobropis: " + input.credit_note_number);

  cursor.ensureSpace(70);
  const stY = cursor.y;
  cursor.page.drawText("Stav objednávky", { x: leftX, y: stY, size: 10, font: fonts.bold, color: brand });
  cursor.page.drawText("Související doklady", { x: rightX, y: stY, size: 10, font: fonts.bold, color: brand });
  let ySL = stY - 14;
  let ySR = stY - 14;
  for (let i = 1; i < statusLeft.length; i++) {
    cursor.page.drawText(statusLeft[i]!, { x: leftX, y: ySL, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    ySL -= 12;
  }
  for (let i = 1; i < statusRight.length; i++) {
    cursor.page.drawText(statusRight[i]!, { x: rightX, y: ySR, size: 8.5, font: fonts.regular, color: PREMIUM_PDF_TEXT_MAIN, maxWidth: colW });
    ySR -= 12;
  }
  cursor.y = Math.min(ySL, ySR) - 8;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důvod storna", PREMIUM_INVOICE_CONTENT_W);
  cursor.y = drawWrappedText(cursor.page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, cursor.y, PREMIUM_INVOICE_CONTENT_W, 9.5, PREMIUM_PDF_TEXT_MAIN) - 6;
  cursor.page.drawText("Datum storna: " + formatAdminPragueDateTime(input.issued_at), {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y,
    size: 8.5,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  cursor.page.drawText("Storno provedl: " + input.issuer_display_name, {
    x: PREMIUM_INVOICE_MARGIN + colW,
    y: cursor.y,
    size: 8.5,
    font: fonts.regular,
    color: PREMIUM_PDF_TEXT_MAIN,
  });
  cursor.y -= 18;

  if (input.storno_kind === "cancellation") {
    cursor.ensureSpace(95);
    drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důsledek storna", PREMIUM_INVOICE_CONTENT_W);
    const bullets = [
      "Objednávka je stornována a reklamní služba nebude poskytována.",
      input.ad_turned_off_at ? "Reklama byla odstraněna z veřejného zobrazení." : "Reklamní zobrazení bylo ukončeno dle stavu objednávky.",
      "Reklamní pozice " + input.ctx.position_label + " v kategorii „" + input.ctx.category_title_cs + "“ byla uvolněna pro další objednávky.",
      "Tento dokument slouží jako potvrzení o stornování objednávky.",
      "Stav úhrady faktury: " + input.payment_status_label + (input.storno_amount_cents ? " · Stornovaná částka: " + fmtPremiumPdfMoney(input.storno_amount_cents, input.ctx.currency) : ""),
    ];
    for (const b of bullets) {
      cursor.y = drawWrappedText(cursor.page, fonts.regular, "• " + b, PREMIUM_INVOICE_MARGIN + 4, cursor.y, PREMIUM_INVOICE_CONTENT_W - 8, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.28) - 2;
    }
  }

  cursor.ensureSpace(PREMIUM_INVOICE_FOOTER_Y - PREMIUM_INVOICE_CONTENT_MIN_Y + 8);
  const footerPage = cursor.page;
  footerPage.drawText(
    "Tento dokument byl automaticky vytvořen administrátorským systémem infoUzel.cz. Všechny uvedené údaje jsou v místním čase České republiky (Praha).",
    {
      x: PREMIUM_INVOICE_MARGIN,
      y: PREMIUM_INVOICE_FOOTER_Y - 4,
      size: 7,
      font: fonts.regular,
      color: PREMIUM_PDF_TEXT_MUTED,
      maxWidth: PREMIUM_INVOICE_CONTENT_W - 80,
    }
  );
  drawPremiumPdfBrandLogo(footerPage, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_FOOTER_Y - 8);

  return pdf.save();
}
