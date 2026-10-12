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
  PREMIUM_PDF_HEADER_BODY_GAP_PT,
  wrapTextLines,
} from "./premium-invoice-pdf-layout";
import {
  drawPremiumPdfBrandLogo,
  drawPremiumPdfPartyBox,
  drawPremiumPdfPriceBodyRow,
  drawPremiumPdfSectionHeader,
  fmtPremiumPdfMoney,
  premiumPdfBrandRgb,
  premiumPdfBuyerLinesFromCtx,
  premiumPdfSupplierLines,
  PREMIUM_PDF_LINE_GRAY,
  PREMIUM_PDF_TEXT_MAIN,
  PREMIUM_PDF_TEXT_MUTED,
} from "./premium-pdf-party-blocks";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
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

const VAT_NOTICE_CS =
  PREMIUM_INVOICE_SUPPLIER.vatPayer
    ? "Cena je uvedena v režimu plátce DPH."
    : "Cena je uvedena bez DPH (poskytovatel není plátce DPH).";

function buildStornoConsequenceBullets(input: PremiumOrderCancellationPdfInput): string[] {
  const bullets: string[] = [];
  if (input.ad_was_published) {
    bullets.push("Objednávka byla stornována po zveřejnění reklamy.");
    bullets.push("Poskytování reklamní služby bylo ukončeno.");
    if (input.ad_turned_off_at) {
      bullets.push(
        "Reklama byla odstraněna z veřejného zobrazení dne " + formatAdminPragueDateTime(input.ad_turned_off_at) + "."
      );
    } else if (input.ctx.published_at) {
      bullets.push("Reklama byla zveřejněna dne " + formatAdminPragueDateTime(input.ctx.published_at) + ".");
    }
  } else {
    bullets.push("Objednávka byla stornována před zveřejněním reklamy.");
    bullets.push("Reklamní služba nebyla poskytnuta.");
    bullets.push("Reklama nebyla zveřejněna na webu infoUzel.cz.");
  }
  bullets.push(
    "Reklamní pozice " +
      input.ctx.position_label +
      " v kategorii „" +
      input.ctx.category_title_cs +
      "“ byla uvolněna pro další objednávky."
  );
  bullets.push("Tento dokument slouží jako potvrzení o stornu objednávky.");
  return bullets;
}

export async function buildPremiumOrderCancellationPdf(input: PremiumOrderCancellationPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  const pages = [page];
  const fonts = await registerPremiumPdfFonts(pdf);
  const brand = premiumPdfBrandRgb();
  const stornoRed = rgb(0.78, 0.12, 0.12);

  let cursor = new PremiumInvoicePdfCursor(page, pages, pdf, PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN, PREMIUM_INVOICE_CONTENT_MIN_Y);

  drawPremiumPdfBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y + 4);
  const docTitle = "Potvrzení o stornu objednávky";
  cursor.page.drawText(docTitle, {
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

  const boxW = 158;
  const boxX = PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - boxW;
  const metaStartY = cursor.y;
  const metaValueMaxW = Math.max(120, boxX - (PREMIUM_INVOICE_MARGIN + 118) - 10);
  const metaLines: { label: string; value: string }[] = [
    { label: "Číslo storna:", value: input.storno_number },
    { label: "Číslo objednávky:", value: input.ctx.evidence_reference },
  ];
  if (input.invoice_number) metaLines.push({ label: "Číslo faktury:", value: input.invoice_number });
  metaLines.push(
    { label: "Datum vystavení:", value: formatAdminPragueDateTime(input.issued_at) },
    { label: "Vystavil:", value: input.issuer_display_name }
  );
  let metaBottomY = metaStartY;
  for (const row of metaLines) {
    cursor.page.drawText(row.label, {
      x: PREMIUM_INVOICE_MARGIN,
      y: metaBottomY,
      size: 8.5,
      font: fonts.regular,
      color: PREMIUM_PDF_TEXT_MUTED,
    });
    metaBottomY = drawWrappedText(
      cursor.page,
      fonts.bold,
      row.value,
      PREMIUM_INVOICE_MARGIN + 118,
      metaBottomY,
      metaValueMaxW,
      9,
      PREMIUM_PDF_TEXT_MAIN,
      1.22
    );
    metaBottomY -= 4;
  }
  cursor.y = metaBottomY;

  const stornoNote = "Objednávka byla stornována.";
  const boxInnerW = boxW - 16;
  const boxH = Math.max(52, 34 + measureWrappedHeight(wrapTextLines(fonts.regular, stornoNote, 7.5, boxInnerW).length, 7.5, 1.2));
  const boxY = metaStartY - boxH + 6;
  cursor.page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, borderColor: stornoRed, borderWidth: 1.6, color: rgb(1, 1, 1) });
  cursor.page.drawText("STORNO", { x: boxX + 46, y: boxY + boxH - 26, size: 17, font: fonts.bold, color: stornoRed });
  drawWrappedText(cursor.page, fonts.regular, stornoNote, boxX + 8, boxY + boxH - 40, boxInnerW, 7.5, PREMIUM_PDF_TEXT_MUTED, 1.2);

  cursor.y = Math.min(cursor.y, boxY - 10);
  const colW = (PREMIUM_INVOICE_CONTENT_W - 12) / 2;
  const leftX = PREMIUM_INVOICE_MARGIN;
  const rightX = PREMIUM_INVOICE_MARGIN + colW + 12;
  const partyYBefore = cursor.y;
  const leftBottom = drawPremiumPdfPartyBox(cursor, fonts, brand, leftX, colW, "Poskytovatel (provozovatel)", premiumPdfSupplierLines());
  cursor.y = partyYBefore;
  const rightBottom = drawPremiumPdfPartyBox(cursor, fonts, brand, rightX, colW, "Objednatel", premiumPdfBuyerLinesFromCtx(input.ctx));
  cursor.y = Math.min(leftBottom, rightBottom) - 6;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Předmět objednané reklamní služby", PREMIUM_INVOICE_CONTENT_W);
  const serviceBodyTop = cursor.y;
  const serviceLeft = [
    "Kategorie: " + input.ctx.category_title_cs,
    "Reklamní pozice: " + input.ctx.position_label,
    "Délka poskytování: " + String(input.ctx.duration_months) + " měsíců",
    "Režim kreativy: " + input.ctx.creative_mode_label_cs,
    "Webové umístění: " + (input.ctx.ad_web_placement_url || PREMIUM_AD_WEB_PLACEMENT),
    "Cílová URL: " + input.ctx.target_url,
  ];
  const blockTop = serviceBodyTop;
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
  const periodTitle = input.ad_was_published ? "Období poskytování (původní)" : "Plánované období (neskutečně poskytnuto)";
  cursor.page.drawText(periodTitle, {
    x: periodX + 8,
    y: periodTop - 14,
    size: 9,
    font: fonts.bold,
    color: brand,
  });
  let periodLines: string[];
  if (input.ad_was_published && input.ctx.campaign_start_at && input.ctx.campaign_end_at) {
    periodLines = [
      "Od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at),
      "Do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at),
    ];
  } else if (!input.ad_was_published) {
    periodLines = [];
    if (input.ctx.campaign_start_at && input.ctx.campaign_end_at) {
      periodLines.push("Plánováno od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at));
      periodLines.push("Plánováno do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at));
    } else if (input.ctx.order_submitted_at) {
      periodLines.push("Objednáno: " + formatAdminPragueDateTime(input.ctx.order_submitted_at));
    }
    periodLines.push("Reklamní služba nebyla zveřejněna ani poskytnuta.");
  } else if (input.ctx.campaign_start_at && input.ctx.campaign_end_at) {
    periodLines = [
      "Od: " + formatAdminPragueDateTime(input.ctx.campaign_start_at),
      "Do: " + formatAdminPragueDateTime(input.ctx.campaign_end_at),
    ];
  } else {
    periodLines = ["Období reklamní služby není v evidenci k dispozici."];
  }
  let yP = periodTop - 28;
  for (const pl of periodLines) {
    yP = drawWrappedText(cursor.page, fonts.regular, pl, periodX + 8, yP, periodW - 16, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.25);
    yP -= 2;
  }
  cursor.y = Math.min(yLeft, yP, periodTop - periodH) - 10;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Cena reklamní služby (původní objednávka)", PREMIUM_INVOICE_CONTENT_W);
  drawPremiumPdfPriceBodyRow(
    cursor,
    fonts,
    brand,
    VAT_NOTICE_CS,
    input.ctx.price_cents,
    input.ctx.currency,
    PREMIUM_INVOICE_CONTENT_W
  );

  const statusLeft: string[] = ["Stav: Objednávka stornována"];
  statusLeft.push("Vytvořeno: " + formatAdminPragueDateTime(input.ctx.order_created_at));
  if (input.ctx.order_submitted_at) {
    statusLeft.push("Odesláno ke schválení: " + formatAdminPragueDateTime(input.ctx.order_submitted_at));
  }
  if (input.order_was_approved && input.ctx.approved_at) {
    statusLeft.push("Schváleno: " + formatAdminPragueDateTime(input.ctx.approved_at));
  }
  if (input.ad_was_published && input.ad_turned_off_at) {
    statusLeft.push("Reklama vypnuta na webu: " + formatAdminPragueDateTime(input.ad_turned_off_at));
  }
  statusLeft.push("Stornováno: " + formatAdminPragueDateTime(input.issued_at));

  const statusRight: string[] = ["Související doklady:"];
  statusRight.push("Objednávka: " + input.ctx.evidence_reference);
  if (input.invoice_number) statusRight.push("Faktura: " + input.invoice_number);
  if (input.variable_symbol) statusRight.push("Variabilní symbol: " + input.variable_symbol);
  if (input.credit_note_number) statusRight.push("Dobropis: " + input.credit_note_number);
  if (input.storno_kind === "cancellation") {
    statusRight.push("Stav úhrady faktury: " + input.payment_status_label);
    if (input.storno_amount_cents != null) {
      statusRight.push("Stornovaná částka: " + fmtPremiumPdfMoney(input.storno_amount_cents, input.ctx.currency));
    }
  }

  const stY = cursor.y;
  cursor.page.drawText("Stav objednávky", { x: leftX, y: stY, size: 10, font: fonts.bold, color: brand });
  cursor.page.drawText("Související doklady", { x: rightX, y: stY, size: 10, font: fonts.bold, color: brand });
  let ySL = stY - 14;
  let ySR = stY - 14;
  for (let i = 0; i < statusLeft.length; i++) {
    ySL = drawWrappedText(cursor.page, fonts.regular, statusLeft[i]!, leftX, ySL, colW, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.25);
    ySL -= 2;
  }
  for (let i = 1; i < statusRight.length; i++) {
    ySR = drawWrappedText(cursor.page, fonts.regular, statusRight[i]!, rightX, ySR, colW, 8.5, PREMIUM_PDF_TEXT_MAIN, 1.25);
    ySR -= 2;
  }
  cursor.y = Math.min(ySL, ySR) - 8;

  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důvod storna", PREMIUM_INVOICE_CONTENT_W);
  const reasonY = cursor.y;
  cursor.y =
    drawWrappedText(cursor.page, fonts.regular, input.reason, PREMIUM_INVOICE_MARGIN, reasonY, PREMIUM_INVOICE_CONTENT_W, 9.5, PREMIUM_PDF_TEXT_MAIN) - 6;
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
  cursor.y -= 10;

  const consequenceBullets = buildStornoConsequenceBullets(input);
  const consColGap = 8;
  const consColW = (PREMIUM_INVOICE_CONTENT_W - consColGap) / 2;
  const consLeftX = PREMIUM_INVOICE_MARGIN + 4;
  const consRightX = PREMIUM_INVOICE_MARGIN + consColW + consColGap;
  drawPremiumPdfSectionHeader(cursor, fonts, brand, "Důsledky storna", PREMIUM_INVOICE_CONTENT_W);
  let consLeftY = cursor.y;
  let consRightY = cursor.y;
  for (let i = 0; i < consequenceBullets.length; i++) {
    const useLeft = i % 2 === 0;
    const x = useLeft ? consLeftX : consRightX;
    const colW = consColW - 8;
    const yStart = useLeft ? consLeftY : consRightY;
    const nextY = drawWrappedText(
      cursor.page,
      fonts.regular,
      "• " + consequenceBullets[i]!,
      x,
      yStart,
      colW,
      8,
      PREMIUM_PDF_TEXT_MAIN,
      1.22
    );
    if (useLeft) consLeftY = nextY - 2;
    else consRightY = nextY - 2;
  }
  cursor.y = Math.min(consLeftY, consRightY) - 4;

  cursor.ensureSpace(PREMIUM_INVOICE_FOOTER_Y - PREMIUM_INVOICE_CONTENT_MIN_Y + 8);
  const footerPage = cursor.page;
  const footerText =
    "Tento dokument byl automaticky vytvořen administrátorským systémem infoUzel.cz. Všechny uvedené údaje jsou v místním čase České republiky (Praha).";
  const footerTextW = PREMIUM_INVOICE_CONTENT_W - 120;
  drawWrappedText(
    footerPage,
    fonts.regular,
    footerText,
    PREMIUM_INVOICE_MARGIN,
    PREMIUM_INVOICE_FOOTER_Y + 10,
    footerTextW,
    7,
    PREMIUM_PDF_TEXT_MUTED,
    1.2
  );
  return pdf.save();
}
