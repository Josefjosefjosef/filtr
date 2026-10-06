/**
 * Deterministic premium creative layout: interpolate between logo (contain) and banner (cover).
 * Shared by preview, admin, and live (browser bundle mirrors this module).
 */
import { premiumCreativeFillFraction, type PremiumCreativeMode } from "./premium-creative-mode";

export const PREMIUM_SLOT_PAD_Y = 16;
export const PREMIUM_SLOT_PAD_X = 12;
export const PREMIUM_LOGO_IMAGE_INSET = 10;
export const PREMIUM_SLOT_GAP = 10;

export type PremiumCreativeLayout = {
  slotPaddingTop: number;
  slotPaddingRight: number;
  slotPaddingBottom: number;
  slotPaddingLeft: number;
  clipWidth: number;
  clipHeight: number;
  imgWidth: number;
  imgHeight: number;
  imgLeft: number;
  imgTop: number;
  objectFit: "contain" | "cover";
  useEndpointCss: boolean;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function computePremiumCreativeLayout(input: {
  slotWidth: number;
  slotHeight: number;
  imgNaturalWidth: number;
  imgNaturalHeight: number;
  mode: string;
}): PremiumCreativeLayout {
  const t = premiumCreativeFillFraction(input.mode);
  const iw = input.imgNaturalWidth;
  const ih = input.imgNaturalHeight;
  if (!(input.slotWidth > 0 && input.slotHeight > 0 && iw > 0 && ih > 0)) {
    return {
      slotPaddingTop: PREMIUM_SLOT_PAD_Y,
      slotPaddingRight: PREMIUM_SLOT_PAD_X,
      slotPaddingBottom: PREMIUM_SLOT_PAD_Y,
      slotPaddingLeft: PREMIUM_SLOT_PAD_X,
      clipWidth: Math.max(0, input.slotWidth - 2 * PREMIUM_SLOT_PAD_X),
      clipHeight: Math.max(0, input.slotHeight - 2 * PREMIUM_SLOT_PAD_Y),
      imgWidth: 0,
      imgHeight: 0,
      imgLeft: 0,
      imgTop: 0,
      objectFit: "contain",
      useEndpointCss: true,
    };
  }

  if (t <= 0) {
    return {
      slotPaddingTop: PREMIUM_SLOT_PAD_Y,
      slotPaddingRight: PREMIUM_SLOT_PAD_X,
      slotPaddingBottom: PREMIUM_SLOT_PAD_Y,
      slotPaddingLeft: PREMIUM_SLOT_PAD_X,
      clipWidth: 0,
      clipHeight: 0,
      imgWidth: 0,
      imgHeight: 0,
      imgLeft: 0,
      imgTop: 0,
      objectFit: "contain",
      useEndpointCss: true,
    };
  }
  if (t >= 1) {
    return {
      slotPaddingTop: 0,
      slotPaddingRight: 0,
      slotPaddingBottom: 0,
      slotPaddingLeft: 0,
      clipWidth: 0,
      clipHeight: 0,
      imgWidth: 0,
      imgHeight: 0,
      imgLeft: 0,
      imgTop: 0,
      objectFit: "cover",
      useEndpointCss: true,
    };
  }

  const padY = lerp(PREMIUM_SLOT_PAD_Y, 0, t);
  const padX = lerp(PREMIUM_SLOT_PAD_X, 0, t);
  const imgInset = lerp(PREMIUM_LOGO_IMAGE_INSET, 0, t);

  const innerW = input.slotWidth - 2 * padX;
  const innerH = input.slotHeight - 2 * padY;
  const availW = Math.max(0, innerW - 2 * imgInset);
  const availH = Math.max(0, innerH - 2 * imgInset);

  const sContain = Math.min(availW / iw, availH / ih);
  const sCover = Math.max(innerW / iw, innerH / ih);
  const scale = lerp(sContain, sCover, t);

  const dispW = iw * scale;
  const dispH = ih * scale;
  const imgLeft = padX + imgInset + (availW - dispW) / 2;
  const imgTop = padY + imgInset + (availH - dispH) / 2;

  return {
    slotPaddingTop: padY,
    slotPaddingRight: padX,
    slotPaddingBottom: padY,
    slotPaddingLeft: padX,
    clipWidth: innerW,
    clipHeight: innerH,
    imgWidth: dispW,
    imgHeight: dispH,
    imgLeft,
    imgTop,
    objectFit: "cover",
    useEndpointCss: false,
  };
}

export function premiumCreativeModeUsesBlendLayout(mode: string): boolean {
  const t = premiumCreativeFillFraction(mode);
  return t > 0 && t < 1;
}

export function assertMonotonicScale(
  slot: { w: number; h: number },
  img: { w: number; h: number },
  modes: PremiumCreativeMode[]
): boolean {
  let prev = -1;
  for (const m of modes) {
    const layout = computePremiumCreativeLayout({
      slotWidth: slot.w,
      slotHeight: slot.h,
      imgNaturalWidth: img.w,
      imgNaturalHeight: img.h,
      mode: m,
    });
    let visible = 0;
    if (layout.useEndpointCss && m === "logo") {
      const innerW = slot.w - 2 * PREMIUM_SLOT_PAD_X - 2 * PREMIUM_LOGO_IMAGE_INSET;
      const innerH = slot.h - 2 * PREMIUM_SLOT_PAD_Y - 2 * PREMIUM_LOGO_IMAGE_INSET;
      visible = Math.min(innerW / img.w, innerH / img.h);
    } else if (layout.useEndpointCss && m === "full_bleed_banner") {
      visible = Math.max(slot.w / img.w, slot.h / img.h);
    } else {
      visible = layout.imgWidth / img.w;
    }
    if (visible < prev - 1e-6) return false;
    prev = visible;
  }
  return true;
}
