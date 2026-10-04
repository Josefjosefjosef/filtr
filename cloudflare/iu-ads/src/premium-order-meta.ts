import { premiumOrderPositionExplanationCs, premiumPositionRankLabelCs } from "./premium-display";
import {
  isKnownAffiliateCategorySlug,
  parsePremiumPlacementId,
  premiumCategoryTitleCs,
  PREMIUM_DURATION_MONTHS,
  resolveAuthoritativePriceCents,
} from "./premium-selected-services";
import type { Env } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function formatPriceLabelCs(cents: number): string {
  return (cents / 100).toLocaleString("cs-CZ") + " Kč bez DPH / " + PREMIUM_DURATION_MONTHS + " měsíců";
}

export async function buildPremiumOrderMetaHtml(env: Env, category: string, placementId: string): Promise<string> {
  const cat = category.trim();
  const placement = placementId.trim();
  const parsed = parsePremiumPlacementId(placement);
  if (!parsed || !isKnownAffiliateCategorySlug(cat) || parsed.categorySlug !== cat) {
    return '<p class="err">Neplatná kategorie nebo pozice. Otevřete objednávku z tlačítka P1/P2 na InfoUzel.cz.</p>';
  }
  if (!env.DB) {
    return '<p class="err">Objednávkový systém dočasně nedostupný.</p>';
  }
  const row = await env.DB.prepare(
    "SELECT placement_id, category_slug, position, current_price_cents, currency FROM premium_selected_placements WHERE placement_id = ?"
  )
    .bind(placement)
    .first<{ placement_id: string; category_slug: string; position: number; current_price_cents: number; currency: string }>();
  if (!row) {
    return '<p class="err">Pozice není v katalogu.</p>';
  }
  const position = row.position as 1 | 2 | 3 | 4;
  const priceCents = resolveAuthoritativePriceCents(placement, position, row.current_price_cents, null);
  const title = premiumCategoryTitleCs(cat);
  const posLabel = "P" + position;
  return (
    "<h2 class=\"summary-h\">Prémiová reklamní pozice</h2>" +
    "<dl class=\"summary-dl\">" +
    "<dt>Služba</dt><dd>Premium Selected Services</dd>" +
    "<dt>Kategorie</dt><dd>" +
    esc(title) +
    "</dd>" +
    "<dt>Pozice</dt><dd>" +
    esc(posLabel) +
    " — " +
    esc(premiumPositionRankLabelCs(position)) +
    "</dd>" +
    "<dt>Cena</dt><dd>" +
    esc(formatPriceLabelCs(priceCents)) +
    "</dd>" +
    "<dt>Reklamní období</dt><dd>" +
    PREMIUM_DURATION_MONTHS +
    " měsíců</dd>" +
    "<dt>Prodloužení</dt><dd>Není automatické</dd>" +
    "</dl>" +
    '<p class="muted b2b">Reklamní služba je určena <strong>výhradně podnikatelům</strong> (IČO povinné).</p>' +
    '<p class="muted legal">' +
    esc(premiumOrderPositionExplanationCs(position)) +
    "</p>"
  );
}
