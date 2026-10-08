import { PDFDocument, rgb } from "pdf-lib";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { premiumCreativeModeLabelCs } from "./premium-creative-mode";
import { formatPremiumTotalPriceLabelCs } from "./premium-selected-services";
import type { PremiumOrderPdfContext } from "./premium-order-pdf-fields";
import { registerPremiumPdfFont } from "./premium-pdf-font";

/** Searchable plain-text snapshot (also embedded in PDF streams). */
export function buildOrderConfirmationPlainLines(ctx: PremiumOrderPdfContext): string[] {
  const priceLabel = formatPremiumTotalPriceLabelCs(ctx.price_cents);
  return [
    "Potvrzení objednávky — Vybrané služby a odkazy",
    "Reference kampaně: " + ctx.evidence_reference,
    "Interní ID objednávky: " + ctx.order_id,
    "Firma / podnikatel: " + ctx.company_name,
    "IČO: " + ctx.ico,
    ctx.dic ? "DIČ: " + ctx.dic : "",
    "Kontaktní osoba: " + ctx.contact_name,
    "E-mail: " + ctx.contact_email,
    ctx.contact_phone ? "Telefon: " + ctx.contact_phone : "",
    "Objednávající osoba: " + (ctx.ordering_person_name || "—"),
    "Fakturační ulice: " + ctx.billing_street,
    "Město: " + ctx.billing_city,
    "PSČ: " + ctx.billing_zip,
    "Stát: " + ctx.billing_country,
    ctx.note ? "Poznámka objednatele: " + ctx.note : "",
    "Kategorie: " + ctx.category_title_cs,
    "Pozice: " + ctx.position_label,
    "Cena: " + priceLabel,
    "Cílová URL: " + ctx.target_url,
    "Režim kreativy: " + (ctx.creative_mode_label_cs || ctx.creative_mode),
    ctx.terms_version ? "Obchodní podmínky verze: " + ctx.terms_version : "",
    ctx.invoice_number ? "Související faktura: " + ctx.invoice_number : "",
    "Schváleno: " + formatAdminPragueDateTime(ctx.approved_at),
    "Zveřejněno: " + formatAdminPragueDateTime(ctx.published_at),
    "Konec období: " + formatAdminPragueDateTime(ctx.campaign_end_at),
  ].filter(Boolean);
}

function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK" }).format(major);
  } catch {
    return String(major) + " " + currency;
  }
}

function drawLines(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  startY: number,
  lines: string[],
  opts?: { size?: number; leading?: number }
): number {
  const size = opts?.size ?? 10;
  const leading = opts?.leading ?? 14;
  let y = startY;
  for (const line of lines) {
    if (y < 60) break;
    page.drawText(line, { x: 48, y, size, font, color: rgb(0.1, 0.1, 0.12) });
    y -= leading;
  }
  return y;
}

export async function buildPremiumOrderConfirmationPdf(
  ctx: PremiumOrderPdfContext,
  creativeBytes: Uint8Array | null,
  creativeMime: string | null
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await registerPremiumPdfFont(pdfDoc);
  const fontBold = font;

  let page = pdfDoc.addPage([595.28, 841.89]);
  let y = 800;

  page.drawText("Potvrzení objednávky — Vybrané služby a odkazy", {
    x: 48,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0, 60 / 255, 1),
  });
  y -= 28;
  page.drawText("InfoUzel Ads · historický dokument", { x: 48, y, size: 9, font, color: rgb(0.4, 0.4, 0.45) });
  y -= 24;

  const priceLabel = formatPremiumTotalPriceLabelCs(ctx.price_cents);

  const block1 = [
    "Identifikace objednávky",
    "Reference kampaně: " + ctx.evidence_reference,
    "Interní ID objednávky: " + ctx.order_id,
    "Produkt: " + ctx.product_label,
    "Vytvořeno: " + formatAdminPragueDateTime(ctx.order_created_at) + " (Europe/Prague)",
    "Odesláno: " + formatAdminPragueDateTime(ctx.order_submitted_at) + " (Europe/Prague)",
    "Stav při schválení: " + ctx.workflow_status_label,
  ];
  y = drawLines(page, font, y, block1, { size: 10, leading: 15 });
  y -= 8;

  const blockCustomer = [
    "Objednatel",
    "Firma / podnikatel: " + ctx.company_name,
    "IČO: " + ctx.ico,
    ctx.dic ? "DIČ: " + ctx.dic : "",
    "Kontaktní osoba: " + ctx.contact_name,
    "E-mail: " + ctx.contact_email,
    ctx.contact_phone ? "Telefon: " + ctx.contact_phone : "",
    "Objednávající osoba: " + (ctx.ordering_person_name || "—"),
    ctx.authorization_confirmed ? "Potvrzení oprávnění objednat: ano" : "",
    "Fakturační ulice: " + ctx.billing_street,
    "Město: " + ctx.billing_city,
    "PSČ: " + ctx.billing_zip,
    "Stát: " + ctx.billing_country,
    ctx.note ? "Poznámka objednatele: " + ctx.note : "",
  ].filter(Boolean);
  y = drawLines(page, font, y, blockCustomer);
  y -= 8;

  const blockService = [
    "Reklamní služba",
    "Kategorie: " + ctx.category_title_cs + " (" + ctx.category_slug + ")",
    "Pozice: " + ctx.position_label,
    "Cena (závazná v objednávce): " + priceLabel + " / " + fmtMoney(ctx.price_cents, ctx.currency),
    "Délka období: " + String(ctx.duration_months) + " měsíců",
    "Cílová URL: " + ctx.target_url,
    "Režim kreativy: " + (ctx.creative_mode_label_cs || premiumCreativeModeLabelCs(ctx.creative_mode)),
    ctx.creative_id ? "Schválená kreativa ID: " + ctx.creative_id : "",
    ctx.creative_content_hash ? "Hash kreativy: " + ctx.creative_content_hash : "",
    ctx.creative_original_filename ? "Soubor kreativy: " + ctx.creative_original_filename : "",
    ctx.creative_format ? "Formát: " + ctx.creative_format : "",
  ].filter(Boolean);
  y = drawLines(page, font, y, blockService);
  y -= 8;

  const blockTerms = [
    "Souhlasy",
    ctx.terms_version ? "Obchodní podmínky verze: " + ctx.terms_version : "",
    ctx.terms_effective_at ? "Účinnost podmínek: " + ctx.terms_effective_at : "",
    ctx.authorization_confirmed ? "Souhlas s obchodními podmínkami a B2B režim: potvrzeno při objednávce" : "",
  ].filter(Boolean);
  y = drawLines(page, font, y, blockTerms);
  y -= 8;

  const blockApproval = [
    "Schválení a zveřejnění",
    "Schváleno: " + formatAdminPragueDateTime(ctx.approved_at) + " (Europe/Prague)",
    "Zveřejněno: " + formatAdminPragueDateTime(ctx.published_at) + " (Europe/Prague)",
    "Začátek období: " + formatAdminPragueDateTime(ctx.campaign_start_at) + " (Europe/Prague)",
    "Konec období: " + formatAdminPragueDateTime(ctx.campaign_end_at) + " (Europe/Prague)",
    ctx.approver_user_id ? "Schvalující administrátor (ID): " + ctx.approver_user_id : "",
    ctx.invoice_number ? "Související faktura: " + ctx.invoice_number : "",
  ].filter(Boolean);
  y = drawLines(page, font, y, blockApproval);

  if (creativeBytes && creativeBytes.length > 0 && creativeMime) {
    if (y < 220) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 780;
    }
    page.drawText("Reklamní podklad (schválená verze)", { x: 48, y, size: 11, font: fontBold });
    y -= 18;
    try {
      let img;
      if (creativeMime === "image/png") img = await pdfDoc.embedPng(creativeBytes);
      else if (creativeMime === "image/jpeg") img = await pdfDoc.embedJpg(creativeBytes);
      else img = null;
      if (img) {
        const maxW = 480;
        const maxH = 200;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: 48, y: y - h, width: w, height: h });
        y -= h + 16;
      } else {
        y = drawLines(page, font, y, [
          "Náhled v PDF není pro tento typ souboru — originál je uložen v systému.",
          "MIME: " + creativeMime,
        ]);
      }
    } catch {
      y = drawLines(page, font, y, ["Reklamní podklad — náhled se nepodařilo vložit; originál zůstává v evidenci."]);
    }
  }

  page.drawText(
    "Dokument vznikl automaticky při schválení a zveřejnění. Přístupový kód klientského portálu není součástí tohoto PDF.",
    { x: 48, y: 40, size: 8, font, color: rgb(0.45, 0.45, 0.5), maxWidth: 500 }
  );

  return pdfDoc.save();
}
