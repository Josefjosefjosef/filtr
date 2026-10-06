/** Semantic premium creative display modes (order, admin, approved creative, live). */

export const PREMIUM_CREATIVE_MODES = [
  "logo",
  "image_small",
  "image_medium",
  "image_large",
  "full_bleed_banner",
] as const;

export type PremiumCreativeMode = (typeof PREMIUM_CREATIVE_MODES)[number];

export const PREMIUM_CREATIVE_MODE_SET: ReadonlySet<string> = new Set(PREMIUM_CREATIVE_MODES);

/** Legacy alias kept for historical rows that stored format-only banner slug. */
const LEGACY_ALIASES: Record<string, PremiumCreativeMode> = {
  banner: "full_bleed_banner",
};

export function normalizePremiumCreativeMode(raw: string | null | undefined): PremiumCreativeMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (LEGACY_ALIASES[v]) return LEGACY_ALIASES[v];
  if (PREMIUM_CREATIVE_MODE_SET.has(v)) return v as PremiumCreativeMode;
  if (v === "full_bleed_banner" || v.includes("banner")) return "full_bleed_banner";
  return "logo";
}

export function isPremiumCreativeMode(raw: string): raw is PremiumCreativeMode {
  return PREMIUM_CREATIVE_MODE_SET.has(raw);
}

/** 0 = logo/contain endpoint, 1 = banner/cover endpoint. */
export function premiumCreativeFillFraction(mode: string): number {
  switch (normalizePremiumCreativeMode(mode)) {
    case "logo":
      return 0;
    case "image_small":
      return 0.25;
    case "image_medium":
      return 0.5;
    case "image_large":
      return 0.75;
    case "full_bleed_banner":
      return 1;
    default:
      return 0;
  }
}

export function premiumCreativeModeLabelCs(mode: string): string {
  switch (normalizePremiumCreativeMode(mode)) {
    case "logo":
      return "Logo";
    case "image_small":
      return "Menší obrázek";
    case "image_medium":
      return "Střední obrázek";
    case "image_large":
      return "Velký obrázek";
    case "full_bleed_banner":
      return "Banner (celá plocha)";
    default:
      return "Logo";
  }
}

/** Stored on creatives.format — same semantic slug as creative_mode. */
export function premiumCreativeModeToCreativeFormat(mode: string): PremiumCreativeMode {
  return normalizePremiumCreativeMode(mode);
}

export function premiumCreativeSlotClassSuffix(mode: string): "logo" | "banner" | "blend" {
  const m = normalizePremiumCreativeMode(mode);
  if (m === "logo") return "logo";
  if (m === "full_bleed_banner") return "banner";
  return "blend";
}
