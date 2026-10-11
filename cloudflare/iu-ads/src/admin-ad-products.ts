/**
 * Reklamní produkty v administraci (tlačítka P1–P8, připravovaný banner PC).
 */
export const AD_PRODUCT_PREMIUM_BUTTONS = "premium_buttons" as const;
export const AD_PRODUCT_BANNER_PC_RIGHT = "banner_pc_right" as const;

export type AdProductId = typeof AD_PRODUCT_PREMIUM_BUTTONS | typeof AD_PRODUCT_BANNER_PC_RIGHT;

export const AD_PRODUCT_LABEL_CS: Record<AdProductId, string> = {
  [AD_PRODUCT_PREMIUM_BUTTONS]: "Reklamní tlačítka – Vybrané služby a odkazy (PC, mobil, tablet)",
  [AD_PRODUCT_BANNER_PC_RIGHT]: "Bannerová reklama – pravý sloupec PC",
};

export function parseAdProductFilter(raw: string | null): AdProductId | "all" {
  if (raw === AD_PRODUCT_BANNER_PC_RIGHT) return AD_PRODUCT_BANNER_PC_RIGHT;
  if (raw === AD_PRODUCT_PREMIUM_BUTTONS) return AD_PRODUCT_PREMIUM_BUTTONS;
  return "all";
}
