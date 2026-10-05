/**
 * Premium placements in „Vybrané služby a odkazy“ — shared catalog rules (server-authoritative).
 * No impression/click analytics; direct target URLs only at render time (wired in public handler).
 */

export const PREMIUM_PRODUCT_TYPE = "premium_selected_services_v1" as const;
export const PREMIUM_DURATION_MONTHS = 6;
export const PREMIUM_INVOICE_DUE_CALENDAR_DAYS = 3;

export const PREMIUM_MAX_POSITION = 8 as const;
export const PREMIUM_POSITION_COUNT = PREMIUM_MAX_POSITION;
export const PREMIUM_PRICE_STEP_CZK = 300;
export const PREMIUM_PRICE_STEP_CENTS = PREMIUM_PRICE_STEP_CZK * 100;
export const PREMIUM_BASE_PRICE_CZK = 5990;

export type PremiumPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const POSITIONS: PremiumPosition[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function isPremiumPosition(value: number): value is PremiumPosition {
  return Number.isInteger(value) && value >= 1 && value <= PREMIUM_MAX_POSITION;
}

function priceCzkForPosition(position: PremiumPosition): number {
  return PREMIUM_BASE_PRICE_CZK - (position - 1) * PREMIUM_PRICE_STEP_CZK;
}

export const DEFAULT_POSITION_PRICES_CZK: Readonly<Record<PremiumPosition, number>> = Object.fromEntries(
  POSITIONS.map((p) => [p, priceCzkForPosition(p)])
) as Readonly<Record<PremiumPosition, number>>;

export type PremiumCapacity = 2 | 4 | 8;

export function premiumPlacementId(categorySlug: string, position: PremiumPosition): string {
  const slug = categorySlug.trim();
  const pos = String(position).padStart(2, "0");
  return "selected_services." + slug + ".premium." + pos;
}

export function parsePremiumPlacementId(placementId: string): { categorySlug: string; position: PremiumPosition } | null {
  const m = /^selected_services\.(.+)\.premium\.(0[1-8])$/.exec(placementId);
  if (!m) return null;
  const position = Number(m[2]);
  if (!isPremiumPosition(position)) return null;
  return { categorySlug: m[1], position };
}

export function defaultPriceCentsForPosition(position: PremiumPosition): number {
  return DEFAULT_POSITION_PRICES_CZK[position] * 100;
}

/** Sales catalog always offers P1–P8; availability is occupancy-only (not premium_capacity). */
export function isPremiumSlotPubliclyListed(_capacity: PremiumCapacity, position: PremiumPosition): boolean {
  return isPremiumPosition(position);
}

export function resolveAuthoritativePriceCents(
  placementId: string,
  position: PremiumPosition,
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

const PREMIUM_CATEGORY_TITLES_CS: Record<string, string> = {
  "aff-cestovni-kancelare": "Cestovní kanceláře",
  "aff-zdravi-doplnky": "Zdraví a doplňky",
  "aff-finance": "Finance",
  "aff-lekarny": "Lékárny",
};

export function premiumCategoryTitleCs(slug: string): string {
  const key = slug.trim();
  if (PREMIUM_CATEGORY_TITLES_CS[key]) return PREMIUM_CATEGORY_TITLES_CS[key];
  return key
    .replace(/^aff-/, "")
    .split("-")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
