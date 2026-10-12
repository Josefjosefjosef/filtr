import { isKnownAffiliateCategorySlug } from "./premium-selected-services";

export const PREMIUM_SITE_ORIGIN = "https://infouzel.cz";
export const PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM = "iu_window";
export const PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE = "tool";

function isPremiumSiteHost(hostname: string): boolean {
  const h = String(hostname || "").trim().toLowerCase();
  return h === "infouzel.cz" || h === "www.infouzel.cz";
}

/** True when URL opens a known affiliate section in the desktop tool-window shell. */
export function isFunctionalPremiumAdWebPlacementUrl(rawUrl: string): boolean {
  const normalized = normalizePremiumAdWebPlacementUrl(rawUrl);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const section = String(url.searchParams.get("section") || "").trim();
    if (!isKnownAffiliateCategorySlug(section)) return false;
    return (
      String(url.searchParams.get(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM) || "")
        .trim()
        .toLowerCase() === PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE
    );
  } catch {
    return false;
  }
}

/**
 * Ensure frozen order snapshots and legacy URLs gain ?iu_window=tool for affiliate sections.
 * Preserves unrelated query parameters on infouzel.cz.
 */
export function normalizePremiumAdWebPlacementUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isPremiumSiteHost(url.hostname)) return trimmed;
  const section = String(url.searchParams.get("section") || "").trim();
  if (!section || !isKnownAffiliateCategorySlug(section)) return trimmed;
  const current = String(url.searchParams.get(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM) || "")
    .trim()
    .toLowerCase();
  if (current !== PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE) {
    url.searchParams.set(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM, PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE);
  }
  return url.toString();
}

/** Authoritative section URL for a known premium affiliate category slug. */
export function buildPremiumAdWebPlacementUrl(categorySlug: string): string | null {
  const slug = String(categorySlug || "").trim();
  if (!slug || !isKnownAffiliateCategorySlug(slug)) return null;
  const url = new URL("/", PREMIUM_SITE_ORIGIN);
  url.searchParams.set("section", slug);
  url.searchParams.set(PREMIUM_AD_WEB_PLACEMENT_WINDOW_PARAM, PREMIUM_AD_WEB_PLACEMENT_WINDOW_VALUE);
  return url.toString();
}

/**
 * Use frozen snapshot from order payload when present; otherwise derive only for known slugs.
 * Never invent URLs for unknown categories. Snapshots are normalized for display without DB rewrite.
 */
export function resolvePremiumAdWebPlacementUrl(input: {
  category_slug: string;
  snapshot_url?: string | null;
}): string | null {
  const snap = typeof input.snapshot_url === "string" ? input.snapshot_url.trim() : "";
  if (snap.startsWith("https://") || snap.startsWith("http://")) {
    const normalized = normalizePremiumAdWebPlacementUrl(snap);
    if (normalized && isFunctionalPremiumAdWebPlacementUrl(normalized)) return normalized;
  }
  return buildPremiumAdWebPlacementUrl(input.category_slug);
}
