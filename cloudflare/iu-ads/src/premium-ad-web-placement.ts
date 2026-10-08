import { isKnownAffiliateCategorySlug } from "./premium-selected-services";

export const PREMIUM_SITE_ORIGIN = "https://infouzel.cz";

/** Authoritative section URL for a known premium affiliate category slug. */
export function buildPremiumAdWebPlacementUrl(categorySlug: string): string | null {
  const slug = String(categorySlug || "").trim();
  if (!slug || !isKnownAffiliateCategorySlug(slug)) return null;
  return PREMIUM_SITE_ORIGIN + "/?section=" + encodeURIComponent(slug);
}

/**
 * Use frozen snapshot from order payload when present; otherwise derive only for known slugs.
 * Never invent URLs for unknown categories.
 */
export function resolvePremiumAdWebPlacementUrl(input: {
  category_slug: string;
  snapshot_url?: string | null;
}): string | null {
  const snap = typeof input.snapshot_url === "string" ? input.snapshot_url.trim() : "";
  if (snap.startsWith("https://") || snap.startsWith("http://")) return snap;
  return buildPremiumAdWebPlacementUrl(input.category_slug);
}
