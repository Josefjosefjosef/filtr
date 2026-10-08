import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { PREMIUM_INVOICE_SUPPLIER } from "./premium-invoice-supplier";
import { premiumCreativeModeLabelCs } from "./premium-creative-mode";
import {
  premiumOrderAdWebPlacementForPdf,
  type PremiumOrderPdfContext,
} from "./premium-order-pdf-fields";
import {
  PREMIUM_INVOICE_CONTENT_MIN_Y,
  PREMIUM_INVOICE_CONTENT_W,
  PREMIUM_INVOICE_MARGIN,
  PREMIUM_INVOICE_PAGE,
  PremiumInvoicePdfCursor,
  drawWrappedText,
  measureWrappedHeight,
  wrapTextLines,
} from "./premium-invoice-pdf-layout";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { registerPremiumPdfFonts, type PremiumPdfFonts } from "./premium-pdf-font";

const TEXT_MAIN = rgb(0.12, 0.12, 0.14);
const TEXT_MUTED = rgb(0.42, 0.42, 0.48);
const LINE_GRAY = rgb(0.82, 0.84, 0.88);
const BG_BOX_HEAD = rgb(0.92, 0.95, 1);

function hexRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK" }).format(major);
  } catch {
    return String(major) + " " + currency;
  }
}

function drawBrandLogo(page: PDFPage, fonts: PremiumPdfFonts, rightX: number, topY: number, brand: ReturnType<typeof hexRgb>) {
  const size = 24;
  const infoW = fonts.bold.widthOfTextAtSize("info", size);
  const uzelW = fonts.bold.widthOfTextAtSize("Uzel.cz", size);
  const startX = rightX - (infoW + uzelW);
  page.drawText("info", { x: startX, y: topY, size, font: fonts.bold, color: rgb(0, 0, 0) });
  page.drawText("Uzel.cz", { x: startX + infoW, y: topY, size, font: fonts.bold, color: brand });
}

/** Footer band for order confirmation (3 note lines + page number). */
/** Reserved bottom band for footer notes (content must end above). */
export const PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y = PREMIUM_INVOICE_MARGIN + 58;

const FOOTER_NOTES = [
  "Potvrzení objednávky vzniklo automaticky po schválení a zveřejnění reklamní služby.",
  "Všechny uvedené časy jsou v místním čase České republiky (Praha).",
  "Přístupový kód klientského portálu není součástí tohoto dokumentu.",
];

function drawPageFooters(pages: PDFPage[], fonts: PremiumPdfFonts, brand: ReturnType<typeof hexRgb>) {
  const total = pages.length;
  const noteSize = 7.5;
  const noteW = PREMIUM_INVOICE_CONTENT_W - 60;
  pages.forEach((page, idx) => {
    let y = PREMIUM_INVOICE_MARGIN + 8;
    for (const line of FOOTER_NOTES) {
      page.drawText(line, { x: PREMIUM_INVOICE_MARGIN, y, size: noteSize, font: fonts.regular, color: TEXT_MUTED, maxWidth: noteW });
      y += 9;
    }
    const label = String(idx + 1) + " / " + String(total);
    page.drawText(label, {
      x: PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN - fonts.bold.widthOfTextAtSize(label, 10),
      y: PREMIUM_INVOICE_MARGIN + 10,
      size: 10,
      font: fonts.bold,
      color: brand,
    });
  });
}

type KvRow = { label: string; value: string; valueBold?: boolean; linkBlue?: boolean };

function measureSectionBody(rows: KvRow[], fonts: PremiumPdfFonts, innerW: number, bodySize: number): number {
  let h = 12;
  for (const row of rows) {
    const labelW = 148;
    const valueW = Math.max(80, innerW - labelW - 8);
    const lines = wrapTextLines(fonts.regular, row.value, bodySize, valueW);
    h += measureWrappedHeight(Math.max(1, lines.length), bodySize, 1.32) + 4;
  }
  return h;
}

function drawSectionBox(
  cursor: PremiumInvoicePdfCursor,
  fonts: PremiumPdfFonts,
  brand: ReturnType<typeof hexRgb>,
  title: string,
  rows: KvRow[],
  opts?: { rightInset?: number; x?: number; w?: number; bodySize?: number; labelW?: number; skipEnsureSpace?: boolean }
): void {
  const pad = 8;
  const rightInset = opts?.rightInset ?? 0;
  const w = opts?.w ?? PREMIUM_INVOICE_CONTENT_W - rightInset;
  const x = opts?.x ?? PREMIUM_INVOICE_MARGIN;
  const innerW = w - pad * 2;
  const titleSize = 10.5;
  const bodySize = opts?.bodySize ?? 9;
  const headH = titleSize * 1.4 + 5;
  const bodyH = measureSectionBody(rows, fonts, innerW, bodySize);
  const blockH = headH + bodyH + 6;
  if (!opts?.skipEnsureSpace) cursor.ensureSpace(blockH + 6);
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
    y: yTop - headH,
    width: w,
    height: headH,
    color: BG_BOX_HEAD,
    borderColor: LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawText(title, {
    x: x + pad,
    y: yTop - titleSize - 5,
    size: titleSize,
    font: fonts.bold,
    color: brand,
  });

  let y = yTop - headH - 8;
  const labelW = opts?.labelW ?? 132;
  for (const row of rows) {
    cursor.page.drawText(row.label, { x: x + pad, y, size: bodySize, font: fonts.regular, color: TEXT_MUTED });
    const valueFont = row.valueBold ? fonts.bold : fonts.regular;
    const valueColor = row.linkBlue ? brand : TEXT_MAIN;
    const valueW = innerW - labelW - 8;
    y = drawWrappedText(cursor.page, valueFont, row.value, x + pad + labelW, y, valueW, bodySize, valueColor, 1.32);
    y -= 6;
  }
  cursor.y = yBottom - 6;
  cursor.recordBlock("section_" + title.slice(0, 24), yTop, yBottom, x, w);
}

function drawMetaLine(
  page: PDFPage,
  fonts: PremiumPdfFonts,
  y: number,
  label: string,
  value: string,
  valueBold = false
): number {
  const labelSize = 9;
  const valueSize = 9.5;
  page.drawText(label, { x: PREMIUM_INVOICE_MARGIN, y, size: labelSize, font: fonts.regular, color: TEXT_MUTED });
  const vx = PREMIUM_INVOICE_MARGIN + 168;
  page.drawText(value, {
    x: vx,
    y,
    size: valueSize,
    font: valueBold ? fonts.bold : fonts.regular,
    color: TEXT_MAIN,
    maxWidth: PREMIUM_INVOICE_CONTENT_W - 168,
  });
  return y - 14;
}

type PartyLine = { text: string; bold?: boolean; linkBlue?: boolean };

function measurePartyBlock(fonts: PremiumPdfFonts, innerW: number, lines: PartyLine[], titleSize: number, bodySize: number): number {
  const headH = titleSize * 1.6 + 8;
  let bodyH = 10;
  for (const line of lines) {
    const wrapped = wrapTextLines(fonts.regular, line.text, bodySize, innerW);
    bodyH += measureWrappedHeight(wrapped.length || 1, bodySize, 1.32);
  }
  return headH + bodyH + 10;
}

function drawPartyBox(
  cursor: PremiumInvoicePdfCursor,
  fonts: PremiumPdfFonts,
  brand: ReturnType<typeof hexRgb>,
  x: number,
  w: number,
  title: string,
  lines: PartyLine[],
  opts?: { skipEnsureSpace?: boolean }
): number {
  const titleSize = 11;
  const bodySize = 9;
  const pad = 8;
  const innerW = w - pad * 2;
  const blockH = measurePartyBlock(
    fonts,
    innerW,
    lines,
    titleSize,
    bodySize
  );
  if (!opts?.skipEnsureSpace) cursor.ensureSpace(blockH + 8);
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
  const headH = titleSize * 1.6 + 6;
  cursor.page.drawRectangle({
    x,
    y: yTop - headH,
    width: w,
    height: headH,
    color: BG_BOX_HEAD,
    borderColor: LINE_GRAY,
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
    const color = line.linkBlue ? brand : TEXT_MAIN;
    y = drawWrappedText(cursor.page, font, line.text, x + pad, y, innerW, bodySize, color, 1.32);
    y -= 2;
  }
  cursor.recordBlock("party_" + title, yTop, yBottom, x, w);
  return yBottom;
}

function supplierPartyLines(): PartyLine[] {
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
    { text: sup.email, linkBlue: true },
    { text: "www.infouzel.cz", linkBlue: true },
  ];
}

function buyerPartyLines(ctx: PremiumOrderPdfContext): PartyLine[] {
  const lines: PartyLine[] = [{ text: ctx.company_name, bold: true }];
  const idLine = ctx.dic ? "IČO: " + ctx.ico + "  |  DIČ: " + ctx.dic : "IČO: " + ctx.ico;
  lines.push({ text: idLine });
  const addr = [ctx.billing_street, ctx.billing_zip + " " + ctx.billing_city, ctx.billing_country].filter(Boolean).join(", ");
  if (addr) lines.push({ text: addr });
  if (ctx.customer_registry?.display_line_cs) lines.push({ text: ctx.customer_registry.display_line_cs });
  return lines;
}

function vatNoticeCs(): string {
  const sup = PREMIUM_INVOICE_SUPPLIER;
  if (sup.vatPayer) return "Cena je uvedena v režimu plátce DPH.";
  return "Cena je uvedena bez DPH (poskytovatel není plátce DPH).";
}

function drawPriceBand(cursor: PremiumInvoicePdfCursor, fonts: PremiumPdfFonts, brand: ReturnType<typeof hexRgb>, ctx: PremiumOrderPdfContext) {
  const bandH = 44;
  cursor.ensureSpace(bandH + 8);
  const x = PREMIUM_INVOICE_MARGIN;
  const w = PREMIUM_INVOICE_CONTENT_W;
  const yTop = cursor.y;
  const yBottom = yTop - bandH;
  cursor.page.drawRectangle({
    x,
    y: yBottom,
    width: w,
    height: bandH,
    color: BG_BOX_HEAD,
    borderColor: LINE_GRAY,
    borderWidth: 0.6,
  });
  cursor.page.drawText("Celková cena reklamní služby", {
    x: x + 12,
    y: yTop - 22,
    size: 11,
    font: fonts.bold,
    color: brand,
  });
  const amount = fmtMoney(ctx.price_cents, ctx.currency);
  const amountSize = 16;
  cursor.page.drawText(amount, {
    x: x + w - 12 - fonts.bold.widthOfTextAtSize(amount, amountSize),
    y: yTop - 26,
    size: amountSize,
    font: fonts.bold,
    color: brand,
  });
  cursor.page.drawText(vatNoticeCs(), {
    x: x + 12,
    y: yBottom + 10,
    size: 8,
    font: fonts.regular,
    color: TEXT_MUTED,
    maxWidth: w - 24,
  });
  cursor.y = yBottom - 8;
  cursor.recordBlock("price_band", yTop, yBottom, x, w);
}

function drawServiceSection(cursor: PremiumInvoicePdfCursor, fonts: PremiumPdfFonts, brand: ReturnType<typeof hexRgb>, ctx: PremiumOrderPdfContext) {
  const placementUrl = premiumOrderAdWebPlacementForPdf(ctx) || "—";
  const periodBoxW = 162;
  const pad = 8;
  const w = PREMIUM_INVOICE_CONTENT_W;
  const innerW = w - pad * 2;
  const leftW = innerW - periodBoxW - 10;
  const titleSize = 10.5;
  const bodySize = 9;
  const headH = titleSize * 1.4 + 5;
  const labelW = 138;
  const valueW = leftW - labelW;

  const besidePeriodRows: { label: string; value: string }[] = [
    { label: "Kategorie:", value: ctx.category_title_cs },
    { label: "Reklamní pozice:", value: ctx.position_label },
    { label: "Délka poskytování:", value: String(ctx.duration_months) + " měsíců" },
    {
      label: "Režim kreativy:",
      value: ctx.creative_mode_label_cs || premiumCreativeModeLabelCs(ctx.creative_mode),
    },
  ];
  const fullWidthRows: { label: string; value: string; link?: boolean }[] = [
    { label: "Webové umístění reklamy:", value: placementUrl, link: true },
    { label: "Cílová URL reklamního tlačítka:", value: ctx.target_url, link: true },
  ];

  let bodyH = 10;
  for (const row of besidePeriodRows) {
    const lines = wrapTextLines(fonts.regular, row.value, bodySize, valueW);
    bodyH += measureWrappedHeight(Math.max(1, lines.length), bodySize, 1.28) + 4;
  }
  const periodH = 64;
  bodyH = Math.max(bodyH, periodH + 8);
  for (const row of fullWidthRows) {
    const lines = wrapTextLines(fonts.regular, row.value, bodySize, innerW - labelW);
    bodyH += measureWrappedHeight(Math.max(1, lines.length), bodySize, 1.28) + 4;
  }
  const blockH = headH + bodyH + 6;
  cursor.ensureSpace(blockH + 6);
  const x = PREMIUM_INVOICE_MARGIN;
  const yTop = cursor.y;
  const yBottom = yTop - blockH;

  cursor.page.drawRectangle({ x, y: yBottom, width: w, height: blockH, borderColor: LINE_GRAY, borderWidth: 0.6, color: rgb(1, 1, 1) });
  cursor.page.drawRectangle({ x, y: yTop - headH, width: w, height: headH, color: BG_BOX_HEAD, borderColor: LINE_GRAY, borderWidth: 0.6 });
  cursor.page.drawText("Objednaná reklamní služba", {
    x: x + pad,
    y: yTop - titleSize - 5,
    size: titleSize,
    font: fonts.bold,
    color: brand,
  });

  const periodX = x + w - pad - periodBoxW;
  const periodTop = yTop - headH - 6;
  cursor.page.drawRectangle({
    x: periodX,
    y: periodTop - periodH,
    width: periodBoxW,
    height: periodH,
    borderColor: LINE_GRAY,
    borderWidth: 0.5,
    color: rgb(0.98, 0.99, 1),
  });
  cursor.page.drawText("Období poskytování", {
    x: periodX + 8,
    y: periodTop - 13,
    size: 8.5,
    font: fonts.bold,
    color: brand,
  });
  cursor.page.drawText("Od:", { x: periodX + 8, y: periodTop - 27, size: 8, font: fonts.regular, color: TEXT_MUTED });
  drawWrappedText(
    cursor.page,
    fonts.regular,
    formatAdminPragueDateTime(ctx.campaign_start_at),
    periodX + 26,
    periodTop - 27,
    periodBoxW - 34,
    8,
    TEXT_MAIN,
    1.22
  );
  cursor.page.drawText("Do:", { x: periodX + 8, y: periodTop - 46, size: 8, font: fonts.regular, color: TEXT_MUTED });
  drawWrappedText(
    cursor.page,
    fonts.regular,
    formatAdminPragueDateTime(ctx.campaign_end_at),
    periodX + 26,
    periodTop - 46,
    periodBoxW - 34,
    8,
    TEXT_MAIN,
    1.22
  );

  let y = yTop - headH - 8;
  for (const row of besidePeriodRows) {
    cursor.page.drawText(row.label, { x: x + pad, y, size: bodySize, font: fonts.regular, color: TEXT_MUTED });
    y = drawWrappedText(cursor.page, fonts.regular, row.value, x + pad + labelW, y, valueW, bodySize, TEXT_MAIN, 1.28);
    y -= 4;
  }
  const urlStartY = yTop - headH - periodH - 12;
  y = Math.min(y, urlStartY);
  for (const row of fullWidthRows) {
    cursor.page.drawText(row.label, { x: x + pad, y, size: bodySize, font: fonts.regular, color: TEXT_MUTED });
    const color = row.link ? brand : TEXT_MAIN;
    y = drawWrappedText(cursor.page, fonts.regular, row.value, x + pad + labelW, y, innerW - labelW, bodySize, color, 1.28);
    y -= 4;
  }

  cursor.y = yBottom - 6;
  cursor.recordBlock("service_section", yTop, yBottom, x, w);
}

function drawPage1Header(cursor: PremiumInvoicePdfCursor, fonts: PremiumPdfFonts, brand: ReturnType<typeof hexRgb>, ctx: PremiumOrderPdfContext) {
  const titleSize = 20;
  const subSize = 11;
  cursor.page.drawText("Potvrzení objednávky", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y - 4,
    size: titleSize,
    font: fonts.bold,
    color: brand,
  });
  cursor.page.drawText("— Vybrané služby a odkazy", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y - titleSize - 6,
    size: subSize,
    font: fonts.regular,
    color: brand,
  });
  drawBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y - 2, brand);
  cursor.y -= titleSize + subSize + 14;

  let y = cursor.y;
  y = drawMetaLine(cursor.page, fonts, y, "Referenční číslo kampaně:", ctx.evidence_reference, true);
  y = drawMetaLine(cursor.page, fonts, y, "Produkt:", ctx.product_label);
  y = drawMetaLine(cursor.page, fonts, y, "Vytvořeno:", formatAdminPragueDateTime(ctx.order_created_at));
  y = drawMetaLine(cursor.page, fonts, y, "Odesláno:", formatAdminPragueDateTime(ctx.order_submitted_at));
  cursor.y = y - 4;
}

function drawPage2Header(cursor: PremiumInvoicePdfCursor, fonts: PremiumPdfFonts, brand: ReturnType<typeof hexRgb>, ctx: PremiumOrderPdfContext) {
  const titleSize = 20;
  const subSize = 11.5;
  cursor.page.drawText("Schválený reklamní podklad", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y - 4,
    size: titleSize,
    font: fonts.bold,
    color: brand,
  });
  cursor.page.drawText("— Příloha k potvrzení objednávky", {
    x: PREMIUM_INVOICE_MARGIN,
    y: cursor.y - titleSize - 4,
    size: subSize,
    font: fonts.regular,
    color: brand,
  });
  drawBrandLogo(cursor.page, fonts, PREMIUM_INVOICE_PAGE.w - PREMIUM_INVOICE_MARGIN, cursor.y - 2, brand);
  cursor.y -= titleSize + subSize + 16;

  let y = cursor.y;
  y = drawMetaLine(cursor.page, fonts, y, "Referenční číslo kampaně:", ctx.evidence_reference, true);
  y = drawMetaLine(cursor.page, fonts, y, "Produkt:", ctx.product_label);
  y = drawMetaLine(cursor.page, fonts, y, "Kategorie:", ctx.category_title_cs);
  y = drawMetaLine(cursor.page, fonts, y, "Reklamní pozice:", ctx.position_label);
  cursor.y = y - 10;
}

async function embedCreativeImage(
  pdfDoc: PDFDocument,
  creativeBytes: Uint8Array,
  creativeMime: string
): Promise<{ img: Awaited<ReturnType<PDFDocument["embedPng"]>>; w: number; h: number } | null> {
  try {
    if (creativeMime === "image/png") {
      const img = await pdfDoc.embedPng(creativeBytes);
      return { img, w: img.width, h: img.height };
    }
    if (creativeMime === "image/jpeg" || creativeMime === "image/jpg") {
      const img = await pdfDoc.embedJpg(creativeBytes);
      return { img, w: img.width, h: img.height };
    }
  } catch {
    return null;
  }
  return null;
}

/** Searchable plain-text snapshot (completeness guard). */
export function buildOrderConfirmationPlainLines(ctx: PremiumOrderPdfContext): string[] {
  const placementUrl = premiumOrderAdWebPlacementForPdf(ctx);
  const priceOnce =
    "Celková cena reklamní služby za " + String(ctx.duration_months) + " měsíců: " + fmtMoney(ctx.price_cents, ctx.currency);
  return [
    "Potvrzení objednávky — Vybrané služby a odkazy",
    "Reference kampaně: " + ctx.evidence_reference,
    "Firma / podnikatel: " + ctx.company_name,
    "IČO: " + ctx.ico,
    ctx.dic ? "DIČ: " + ctx.dic : "",
    "Kontaktní osoba: " + ctx.contact_name,
    "E-mail: " + ctx.contact_email,
    ctx.contact_phone ? "Telefon: " + ctx.contact_phone : "",
    "Objednávající osoba: " + (ctx.ordering_person_name || "—"),
    ctx.authorization_confirmed ? "Potvrzení oprávnění objednat: ano" : "",
    "Kategorie: " + ctx.category_title_cs,
    "Pozice: " + ctx.position_label,
    priceOnce,
    placementUrl ? "Webové umístění reklamy: " + placementUrl : "",
    "Cílová URL reklamního tlačítka: " + ctx.target_url,
    "Délka poskytování reklamní služby: " + String(ctx.duration_months) + " měsíců",
    "Režim kreativy: " + (ctx.creative_mode_label_cs || ctx.creative_mode),
    ctx.terms_version ? "Obchodní podmínky verze: " + ctx.terms_version : "",
    ctx.terms_effective_at ? "Účinnost podmínek: " + ctx.terms_effective_at : "",
    ctx.authorization_confirmed ? "Souhlas s obchodními podmínkami: ano" : "",
    ctx.b2b_only ? "B2B režim: ano" : "",
    ctx.invoice_number ? "Související faktura: " + ctx.invoice_number : "",
    "Schválení: " + formatAdminPragueDateTime(ctx.approved_at),
    "Zveřejnění: " + formatAdminPragueDateTime(ctx.published_at),
    "Začátek období: " + formatAdminPragueDateTime(ctx.campaign_start_at),
    "Konec období: " + formatAdminPragueDateTime(ctx.campaign_end_at),
    ctx.approver_display_name ? "Schválil: " + ctx.approver_display_name : "",
    ctx.creative_id ? "ID kreativy: " + ctx.creative_id : "",
    ctx.creative_content_hash ? "Hash kreativy: " + ctx.creative_content_hash : "",
    ctx.billing_street,
    ctx.billing_city,
    ctx.billing_zip,
    ctx.customer_registry?.display_line_cs ? ctx.customer_registry.display_line_cs : "",
    ctx.note ? "Poznámka objednatele: " + ctx.note : "",
  ].filter(Boolean);
}

export async function buildPremiumOrderConfirmationPdfWithLayout(
  ctx: PremiumOrderPdfContext,
  creativeBytes: Uint8Array | null,
  creativeMime: string | null
): Promise<{ pdfBytes: Uint8Array; pageCount: number; blocks: import("./premium-invoice-pdf-layout").LayoutBlockMetric[] }> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await registerPremiumPdfFonts(pdfDoc);
  const brand = hexRgb(PREMIUM_INVOICE_BRAND_HEX);
  const pages: PDFPage[] = [];
  const page1 = pdfDoc.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  pages.push(page1);
  const cursor = new PremiumInvoicePdfCursor(
    page1,
    pages,
    pdfDoc,
    PREMIUM_INVOICE_PAGE.h - 40,
    PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y
  );
  cursor.lockPageCount = true;

  drawPage1Header(cursor, fonts, brand, ctx);

  const gap = 10;
  const colW = (PREMIUM_INVOICE_CONTENT_W - gap) / 2;
  const partyRowY = cursor.y;
  const supplierLines = supplierPartyLines();
  const buyerLines = buyerPartyLines(ctx);
  const pad = 10;
  const innerColW = colW - pad * 2;
  const leftH = measurePartyBlock(fonts, innerColW, supplierLines, 11, 9.5);
  const rightH = measurePartyBlock(fonts, innerColW, buyerLines, 11, 9.5);
  cursor.ensureSpace(Math.max(leftH, rightH) + 8);
  cursor.y = partyRowY;
  const leftBottom = drawPartyBox(
    cursor,
    fonts,
    brand,
    PREMIUM_INVOICE_MARGIN,
    colW,
    "Poskytovatel (provozovatel)",
    supplierLines,
    { skipEnsureSpace: true }
  );
  cursor.y = partyRowY;
  const rightBottom = drawPartyBox(
    cursor,
    fonts,
    brand,
    PREMIUM_INVOICE_MARGIN + colW + gap,
    colW,
    "Objednatel",
    buyerLines,
    { skipEnsureSpace: true }
  );
  cursor.y = Math.min(leftBottom, rightBottom) - 6;

  drawSectionBox(cursor, fonts, brand, "Kontaktní a objednávkové údaje", [
    { label: "Kontaktní osoba:", value: ctx.contact_name },
    { label: "E-mail:", value: ctx.contact_email, linkBlue: true },
    { label: "Telefon:", value: ctx.contact_phone || "—" },
    { label: "Objednávající osoba:", value: ctx.ordering_person_name || "—" },
    { label: "Oprávnění objednat:", value: ctx.authorization_confirmed ? "ano" : "ne" },
    ...(ctx.note ? [{ label: "Poznámka objednatele:", value: ctx.note }] : []),
  ]);

  drawServiceSection(cursor, fonts, brand, ctx);
  drawPriceBand(cursor, fonts, brand, ctx);

  const halfGap = 8;
  const halfW = (PREMIUM_INVOICE_CONTENT_W - halfGap) / 2;
  const twinRowY = cursor.y;
  const termsRows: KvRow[] = [
    { label: "Verze OP:", value: ctx.terms_version || "—" },
    { label: "Účinnost:", value: ctx.terms_effective_at ? formatAdminPragueDateTime(ctx.terms_effective_at) : "—" },
    { label: "Souhlas OP:", value: ctx.authorization_confirmed ? "ano" : "ne" },
    { label: "B2B režim:", value: ctx.b2b_only ? "ano" : "ne" },
  ];
  const approvalRows: KvRow[] = [
    { label: "Schválení:", value: formatAdminPragueDateTime(ctx.approved_at) },
    { label: "Zveřejnění:", value: formatAdminPragueDateTime(ctx.published_at) },
    { label: "Zahájení:", value: formatAdminPragueDateTime(ctx.campaign_start_at) },
    { label: "Ukončení:", value: formatAdminPragueDateTime(ctx.campaign_end_at) },
    { label: "Schválil:", value: ctx.approver_display_name || "—" },
    { label: "Faktura:", value: ctx.invoice_number || "—", valueBold: !!ctx.invoice_number },
  ];
  const termsInner = halfW - 16;
  const termsH =
    10.5 * 1.4 +
    5 +
    6 +
    measureSectionBody(termsRows, fonts, termsInner, 8.5) +
    6;
  const approvalH =
    10.5 * 1.4 +
    5 +
    6 +
    measureSectionBody(approvalRows, fonts, termsInner, 8.5) +
    6;
  cursor.ensureSpace(Math.max(termsH, approvalH) + 6);
  cursor.y = twinRowY;
  drawSectionBox(cursor, fonts, brand, "Obchodní podmínky a souhlasy", termsRows, {
    x: PREMIUM_INVOICE_MARGIN,
    w: halfW,
    bodySize: 8.5,
    labelW: 72,
    skipEnsureSpace: true,
  });
  const termsBottom = cursor.y;
  cursor.y = twinRowY;
  drawSectionBox(cursor, fonts, brand, "Schválení a zveřejnění reklamní služby", approvalRows, {
    x: PREMIUM_INVOICE_MARGIN + halfW + halfGap,
    w: halfW,
    bodySize: 8.5,
    labelW: 72,
    skipEnsureSpace: true,
  });
  cursor.y = Math.min(termsBottom, cursor.y) - 6;

  const techRows: KvRow[] = [
    { label: "ID objednávky:", value: ctx.evidence_reference, valueBold: true },
  ];
  if (ctx.creative_id) techRows.push({ label: "ID kreativy:", value: ctx.creative_id });
  if (ctx.creative_content_hash) techRows.push({ label: "Hash kreativy:", value: ctx.creative_content_hash });
  drawSectionBox(cursor, fonts, brand, "Technické údaje", techRows, { bodySize: 6.8, labelW: 92 });

  cursor.lockPageCount = false;
  cursor.blocks = [];

  const page2 = pdfDoc.addPage([PREMIUM_INVOICE_PAGE.w, PREMIUM_INVOICE_PAGE.h]);
  pages.push(page2);
  cursor.page = page2;
  cursor.pages = pages;
  cursor.contentMinY = PREMIUM_ORDER_CONFIRMATION_CONTENT_MIN_Y;
  cursor.y = PREMIUM_INVOICE_PAGE.h - PREMIUM_INVOICE_MARGIN;

  drawPage2Header(cursor, fonts, brand, ctx);

  const creativeZoneTop = cursor.y;
  const creativeZoneH = 300;
  const creativeZoneBottom = creativeZoneTop - creativeZoneH;
  const maxW = PREMIUM_INVOICE_CONTENT_W;
  let creativeNote = "Reklamní podklad není k dispozici v evidenci.";
  if (creativeBytes && creativeBytes.length > 0 && creativeMime) {
    const embedded = await embedCreativeImage(pdfDoc, creativeBytes, creativeMime);
    if (embedded) {
      const scale = Math.min(maxW / embedded.w, creativeZoneH / embedded.h, 1);
      const w = embedded.w * scale;
      const h = embedded.h * scale;
      const ix = PREMIUM_INVOICE_MARGIN + (maxW - w) / 2;
      const iy = creativeZoneTop - (creativeZoneH - h) / 2 - h;
      cursor.page.drawImage(embedded.img, { x: ix, y: iy, width: w, height: h });
      creativeNote = "";
    } else {
      creativeNote = "Náhled v PDF není pro tento typ souboru — originál je uložen v systému.";
    }
  }
  if (creativeNote) {
    cursor.page.drawText(creativeNote, {
      x: PREMIUM_INVOICE_MARGIN,
      y: creativeZoneTop - creativeZoneH / 2,
      size: 10,
      font: fonts.regular,
      color: TEXT_MUTED,
      maxWidth: maxW,
    });
  }
  cursor.y = creativeZoneBottom - 8;
  cursor.lockPageCount = true;

  const placementUrl = premiumOrderAdWebPlacementForPdf(ctx) || "—";
  drawSectionBox(cursor, fonts, brand, "Identifikace reklamního podkladu", [
    { label: "ID kreativity:", value: ctx.creative_id || "—" },
    { label: "Hash kreativity:", value: ctx.creative_content_hash || "—" },
    {
      label: "Režim kreativity:",
      value: ctx.creative_mode_label_cs || premiumCreativeModeLabelCs(ctx.creative_mode),
    },
    {
      label: "Datum nahrání:",
      value: ctx.creative_uploaded_at ? formatAdminPragueDateTime(ctx.creative_uploaded_at) : "—",
    },
    { label: "Datum schválení:", value: formatAdminPragueDateTime(ctx.approved_at) },
    { label: "Schválil:", value: ctx.approver_display_name || "—" },
  ]);

  drawSectionBox(cursor, fonts, brand, "Zobrazení a použití", [
    { label: "Umístění reklamy:", value: placementUrl, linkBlue: true },
    { label: "Cílová URL tlačítka:", value: ctx.target_url, linkBlue: true },
  ], { bodySize: 8.5, labelW: 118 });

  cursor.lockPageCount = false;

  drawPageFooters(pages, fonts, brand);

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, pageCount: pages.length, blocks: cursor.blocks };
}

export async function buildPremiumOrderConfirmationPdf(
  ctx: PremiumOrderPdfContext,
  creativeBytes: Uint8Array | null,
  creativeMime: string | null
): Promise<Uint8Array> {
  const { pdfBytes } = await buildPremiumOrderConfirmationPdfWithLayout(ctx, creativeBytes, creativeMime);
  return pdfBytes;
}
