import { describe, expect, it } from "vitest";
import { PREMIUM_CREATIVE_MODES, premiumCreativeFillFraction, premiumCreativeModeLabelCs } from "../src/premium-creative-mode";
import {
  assertMonotonicScale,
  computePremiumCreativeLayout,
  PREMIUM_LOGO_IMAGE_INSET,
  PREMIUM_SLOT_PAD_X,
  PREMIUM_SLOT_PAD_Y,
} from "../src/premium-creative-render";

describe("premium creative modes", () => {
  it("exposes five semantic modes", () => {
    expect(PREMIUM_CREATIVE_MODES).toHaveLength(5);
    expect(premiumCreativeModeLabelCs("image_medium")).toBe("Střední obrázek");
  });

  it("keeps logo and banner endpoints on CSS", () => {
    const slot = { w: 294, h: 110 };
    const img = { w: 800, h: 400 };
    const logo = computePremiumCreativeLayout({
      slotWidth: slot.w,
      slotHeight: slot.h,
      imgNaturalWidth: img.w,
      imgNaturalHeight: img.h,
      mode: "logo",
    });
    const banner = computePremiumCreativeLayout({
      slotWidth: slot.w,
      slotHeight: slot.h,
      imgNaturalWidth: img.w,
      imgNaturalHeight: img.h,
      mode: "full_bleed_banner",
    });
    expect(logo.useEndpointCss).toBe(true);
    expect(banner.useEndpointCss).toBe(true);
    expect(logo.objectFit).toBe("contain");
    expect(banner.objectFit).toBe("cover");
    expect(logo.slotPaddingLeft).toBe(PREMIUM_SLOT_PAD_X);
    expect(banner.slotPaddingLeft).toBe(0);
  });

  it("monotonically increases visible scale between modes", () => {
    const ok = assertMonotonicScale({ w: 294, h: 110 }, { w: 1200, h: 370 }, [...PREMIUM_CREATIVE_MODES]);
    expect(ok).toBe(true);
  });

  it("interpolates blend layout with symmetric padding", () => {
    const layout = computePremiumCreativeLayout({
      slotWidth: 294,
      slotHeight: 110,
      imgNaturalWidth: 1200,
      imgNaturalHeight: 370,
      mode: "image_medium",
    });
    expect(layout.useEndpointCss).toBe(false);
    expect(layout.slotPaddingLeft).toBe(layout.slotPaddingRight);
    expect(layout.imgWidth).toBeGreaterThan(0);
    expect(premiumCreativeFillFraction("image_small")).toBe(0.25);
  });

  it("preserves logo inner inset constant at endpoint", () => {
    expect(PREMIUM_LOGO_IMAGE_INSET).toBe(10);
    expect(PREMIUM_SLOT_PAD_Y).toBe(16);
  });
});
