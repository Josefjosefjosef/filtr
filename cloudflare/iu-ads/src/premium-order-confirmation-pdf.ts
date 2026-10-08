import { PDFDocument, rgb } from "pdf-lib";
import { PREMIUM_INVOICE_BRAND_HEX } from "./premium-invoice-brand";
import { formatAdminPragueDateTime } from "./premium-order-workflow";
import { premiumCreativeModeLabelCs } from "./premium-creative-mode";
import { PREMIUM_ORDER_AD_WEB_PLACEMENT, type PremiumOrderPdfContext } from "./premium-order-pdf-fields";
import { registerPremiumPdfFont } from "./premium-pdf-font";

function fmtMoney(cents: number, currency: string): string {
  const major = cents / 100;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK" }).format(major);
  } catch {
    return String(major) + " " + currency;
  }
}

/** Searchable plain-text snapshot (completeness guard). */
export function buildOrderConfirmationPlainLines(ctx: PremiumOrderPdfContext): string[] {
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
    "Fakturační ulice: " + ctx.billing_street,
    "Město: " + ctx.billing_city,
    "PSČ: " + ctx.billing_zip,
    "Stát: " + ctx.billing_country,
    ctx.note ? "Poznámka objednatele: " + ctx.note : "",
    "Kategorie: " + ctx.category_title_cs,
    "Pozice: " + ctx.position_label,
    priceOnce,
    "Webové umístění reklamy: " + PREMIUM_ORDER_AD_WEB_PLACEMENT,
    "Cílová URL reklamního tlačítka: " + ctx.target_url,
    "Délka poskytování reklamní služby: " + String(ctx.duration_months) + " měsíců",
    "Režim kreativy: " + (ctx.creative_mode_label_cs || ctx.creative_mode),
    ctx.terms_version ? "Obchodní podmínky verze: " + ctx.terms_version : "",
    ctx.invoice_number ? "Související faktura: " + ctx.invoice_number : "",
    "Schválení: " + formatAdminPragueDateTime(ctx.approved_at),
    "Zveřejnění: " + formatAdminPragueDateTime(ctx.published_at),
    "Začátek období: " + formatAdminPragueDateTime(ctx.campaign_start_at),
    "Konec období: " + formatAdminPragueDateTime(ctx.campaign_end_at),
    ctx.approver_display_name ? "Schválil: " + ctx.approver_display_name : "",
  ].filter(Boolean);
}

function drawLines(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<typeof registerPremiumPdfFont>>,
  startY: number,
  lines: string[],
  opts?: { size?: number; leading?: number; title?: string }
): number {
  const size = opts?.size ?? 10;
  const leading = opts?.leading ?? 14;
  let y = startY;
  if (opts?.title) {
    page.drawText(opts.title, { x: 48, y, size: 11, font, color: rgb(0, 60 / 255, 1) });
    y -= leading + 2;
  }
  for (const line of lines) {
    if (y < 72) break;
    page.drawText(line, { x: 48, y, size, font, color: rgb(0.1, 0.1, 0.12), maxWidth: 500 });
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
  const brand = (() => {
    const h = PREMIUM_INVOICE_BRAND_HEX.replace("#", "");
    const n = parseInt(h, 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  })();

  let page = pdfDoc.addPage([595.28, 841.89]);
  let y = 800;

  page.drawText("Potvrzení objednávky — Vybrané služby a odkazy", {
    x: 48,
    y,
    size: 16,
    font,
    color: brand,
  });
  y -= 28;

  y = drawLines(
    page,
    font,
    y,
    [
      "Reference kampaně: " + ctx.evidence_reference,
      "Produkt: " + ctx.product_label,
      "Vytvořeno: " + formatAdminPragueDateTime(ctx.order_created_at),
      "Odesláno: " + formatAdminPragueDateTime(ctx.order_submitted_at),
    ],
    { title: "Identifikace objednávky" }
  );
  y -= 6;

  y = drawLines(
    page,
    font,
    y,
    [
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
    ].filter(Boolean),
    { title: "Objednatel" }
  );
  y -= 6;

  const priceOnce =
    "Celková cena reklamní služby za " + String(ctx.duration_months) + " měsíců: " + fmtMoney(ctx.price_cents, ctx.currency);

  y = drawLines(
    page,
    font,
    y,
    [
      "Kategorie: " + ctx.category_title_cs,
      "Pozice: " + ctx.position_label,
      priceOnce,
      "Webové umístění reklamy: " + PREMIUM_ORDER_AD_WEB_PLACEMENT,
      "Cílová URL reklamního tlačítka: " + ctx.target_url,
      "Délka poskytování reklamní služby: " + String(ctx.duration_months) + " měsíců",
      "Režim kreativy: " + (ctx.creative_mode_label_cs || premiumCreativeModeLabelCs(ctx.creative_mode)),
      "Období poskytování: " +
        formatAdminPragueDateTime(ctx.campaign_start_at) +
        " – " +
        formatAdminPragueDateTime(ctx.campaign_end_at),
    ],
    { title: "Reklamní služba" }
  );
  y -= 6;

  y = drawLines(
    page,
    font,
    y,
    [
      ctx.terms_version ? "Obchodní podmínky verze: " + ctx.terms_version : "",
      ctx.terms_effective_at ? "Účinnost podmínek: " + ctx.terms_effective_at : "",
      ctx.authorization_confirmed ? "Souhlas s obchodními podmínkami a B2B režim: potvrzeno při objednávce" : "",
    ].filter(Boolean),
    { title: "Souhlasy" }
  );
  y -= 6;

  y = drawLines(
    page,
    font,
    y,
    [
      "Datum a čas schválení: " + formatAdminPragueDateTime(ctx.approved_at) + " (Europe/Prague)",
      "Datum a čas zveřejnění: " + formatAdminPragueDateTime(ctx.published_at) + " (Europe/Prague)",
      "Zahájení poskytování služby: " + formatAdminPragueDateTime(ctx.campaign_start_at) + " (Europe/Prague)",
      "Ukončení poskytování služby: " + formatAdminPragueDateTime(ctx.campaign_end_at) + " (Europe/Prague)",
      ctx.approver_display_name ? "Schválil: " + ctx.approver_display_name : "Schválil: —",
      ctx.invoice_number ? "Související faktura: " + ctx.invoice_number : "",
    ].filter(Boolean),
    { title: "Schválení a zveřejnění reklamy" }
  );
  y -= 6;

  const tech: string[] = [];
  if (ctx.creative_id) tech.push("ID kreativy: " + ctx.creative_id);
  if (ctx.creative_content_hash) tech.push("Hash kreativy: " + ctx.creative_content_hash);
  if (ctx.creative_original_filename) tech.push("Soubor kreativy: " + ctx.creative_original_filename);
  if (tech.length) y = drawLines(page, font, y, tech, { title: "Technické údaje", size: 8.5, leading: 12 });

  if (creativeBytes && creativeBytes.length > 0 && creativeMime) {
    if (y < 240) {
      page = pdfDoc.addPage([595.28, 841.89]);
      y = 780;
    }
    page.drawText("Reklamní podklad (schválená verze)", { x: 48, y, size: 11, font, color: brand });
    y -= 18;
    try {
      let img;
      if (creativeMime === "image/png") img = await pdfDoc.embedPng(creativeBytes);
      else if (creativeMime === "image/jpeg") img = await pdfDoc.embedJpg(creativeBytes);
      else img = null;
      if (img) {
        const maxW = 480;
        const maxH = Math.min(320, y - 80);
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: 48, y: y - h, width: w, height: h });
        y -= h + 12;
      } else {
        y = drawLines(page, font, y, ["Náhled v PDF není pro tento typ souboru — originál je uložen v systému.", "MIME: " + creativeMime]);
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
