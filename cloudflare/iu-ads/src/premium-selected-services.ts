/**
 * Premium placements in „Vybrané služby a odkazy“ — shared catalog rules (server-authoritative).
 * No impression/click analytics; direct target URLs only at render time (wired in public handler).
 */

export const PREMIUM_PRODUCT_TYPE = "premium_selected_services_v1" as const;
export const PREMIUM_DURATION_MONTHS = 6;
export const PREMIUM_INVOICE_DUE_CALENDAR_DAYS = 3;

export const DEFAULT_POSITION_PRICES_CZK: Readonly<Record<1 | 2 | 3 | 4, number>> = {
  1: 5990,
  2: 4990,
  3: 3990,
  4: 2990,
};

export type PremiumCapacity = 2 | 4;

export function premiumPlacementId(categorySlug: string, position: 1 | 2 | 3 | 4): string {
  const slug = categorySlug.trim();
  const pos = String(position).padStart(2, "0");
  return "selected_services." + slug + ".premium." + pos;
}

export function parsePremiumPlacementId(placementId: string): { categorySlug: string; position: 1 | 2 | 3 | 4 } | null {
  const m = /^selected_services\.(.+)\.premium\.(0[1-4])$/.exec(placementId);
  if (!m) return null;
  const position = Number(m[2]) as 1 | 2 | 3 | 4;
  if (position < 1 || position > 4) return null;
  return { categorySlug: m[1], position };
}

export function defaultPriceCentsForPosition(position: 1 | 2 | 3 | 4): number {
  return DEFAULT_POSITION_PRICES_CZK[position] * 100;
}

/** Positions 3–4 are hidden until category premium_capacity becomes 4 (monotonic). */
export function isPremiumSlotPubliclyListed(capacity: PremiumCapacity, position: 1 | 2 | 3 | 4): boolean {
  if (position <= 2) return true;
  return capacity === 4;
}

/** Monotonic: first successful P2 publish permanently unlocks P3/P4 for the category. */
export function capacityAfterP2FirstPublish(current: PremiumCapacity): PremiumCapacity {
  if (current === 4) return 4;
  return 4;
}

export function resolveAuthoritativePriceCents(
  placementId: string,
  position: 1 | 2 | 3 | 4,
  catalogPriceCents: number | null,
  clientSubmittedPriceCents: unknown
): number {
  void clientSubmittedPriceCents;
  if (catalogPriceCents != null && Number.isFinite(catalogPriceCents) && catalogPriceCents > 0) {
    return Math.round(catalogPriceCents);
  }
  const parsed = parsePremiumPlacementId(placementId);
  const pos = parsed?.position ?? position;
  return defaultPriceCentsForPosition(pos);
}

export function addCalendarMonthsFromIso(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_iso");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export function addCalendarDaysFromIso(iso: string, days: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_iso");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export type PriceSnapshot = {
  placement_id: string;
  catalog_price_cents: number;
  agreed_price_cents: number;
  currency: string;
  duration_months: number;
  ordered_at: string;
};

export function buildPriceSnapshot(input: {
  placementId: string;
  catalogPriceCents: number;
  agreedPriceCents: number;
  currency: string;
  orderedAt: string;
}): PriceSnapshot {
  return {
    placement_id: input.placementId,
    catalog_price_cents: input.catalogPriceCents,
    agreed_price_cents: input.agreedPriceCents,
    currency: input.currency,
    duration_months: PREMIUM_DURATION_MONTHS,
    ordered_at: input.orderedAt,
  };
}

/** Affiliate category keys in assets/iu-affiliate-catalog.js (aff-*). */
export const PREMIUM_AFFILIATE_CATEGORY_SLUGS: readonly string[] = [
  "aff-cestovni-kancelare",
  "aff-ubytovani-hotely",
  "aff-letenky",
  "aff-letenky-letecka-doprava",
  "aff-cestovni-pojisteni",
  "aff-auto-moto",
  "aff-pneu-pneuservis",
  "aff-pojisteni",
  "aff-finance",
  "aff-energie-uspor",
  "aff-lekarny",
  "aff-zdravi-doplnky",
  "aff-kosmetika",
  "aff-drogerie",
  "aff-moda",
  "aff-boty",
  "aff-deti-hracky",
  "aff-sportovni-obleceni",
  "aff-sport-outdoor",
  "aff-dum-zahrada",
  "aff-nabytek",
  "aff-kuchyn",
  "aff-elektro",
  "aff-mobily",
  "aff-software",
  "aff-knihy",
  "aff-jidlo",
  "aff-zvirata",
  "aff-kvetiny-darky",
  "aff-sperky-hodinky",
  "aff-tv-streamovani",
  "aff-dilna-naradi",
  "aff-inzerce-bazary",
  "aff-realitni-kancelare",
  "aff-reality-nemovitosti",
  "aff-kancelarske-potreby",
];

export function isKnownAffiliateCategorySlug(slug: string): boolean {
  return PREMIUM_AFFILIATE_CATEGORY_SLUGS.includes(slug);
}
