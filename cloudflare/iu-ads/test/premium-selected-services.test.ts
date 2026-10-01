import { describe, expect, it } from "vitest";
import {
  PREMIUM_DURATION_MONTHS,
  addCalendarDaysFromIso,
  addCalendarMonthsFromIso,
  capacityAfterP2FirstPublish,
  defaultPriceCentsForPosition,
  isPremiumSlotPubliclyListed,
  parsePremiumPlacementId,
  premiumPlacementId,
  resolveAuthoritativePriceCents,
} from "../src/premium-selected-services";

describe("premium placement ids", () => {
  it("builds stable selected_services ids", () => {
    expect(premiumPlacementId("aff-deti-hracky", 1)).toBe("selected_services.aff-deti-hracky.premium.01");
    expect(parsePremiumPlacementId("selected_services.aff-deti-hracky.premium.02")).toEqual({
      categorySlug: "aff-deti-hracky",
      position: 2,
    });
  });
});

describe("capacity listing", () => {
  it("lists P1+P2 only when capacity=2", () => {
    expect(isPremiumSlotPubliclyListed(2, 1)).toBe(true);
    expect(isPremiumSlotPubliclyListed(2, 2)).toBe(true);
    expect(isPremiumSlotPubliclyListed(2, 3)).toBe(false);
    expect(isPremiumSlotPubliclyListed(2, 4)).toBe(false);
  });

  it("lists all four when capacity=4", () => {
    expect(isPremiumSlotPubliclyListed(4, 3)).toBe(true);
    expect(isPremiumSlotPubliclyListed(4, 4)).toBe(true);
  });

  it("unlock is monotonic to 4", () => {
    expect(capacityAfterP2FirstPublish(2)).toBe(4);
    expect(capacityAfterP2FirstPublish(4)).toBe(4);
  });
});

describe("server-authoritative pricing", () => {
  it("uses catalog price and ignores tampered client price", () => {
    const id = premiumPlacementId("aff-finance", 1);
    expect(resolveAuthoritativePriceCents(id, 1, 599000, 100)).toBe(599000);
    expect(defaultPriceCentsForPosition(1)).toBe(599000);
    expect(PREMIUM_DURATION_MONTHS).toBe(6);
  });
});

describe("calendar time", () => {
  it("adds calendar months (not fixed 180 days)", () => {
    const end = addCalendarMonthsFromIso("2026-01-31T12:00:00.000Z", 6);
    expect(end.startsWith("2026-07-31")).toBe(true);
  });

  it("invoice due +3 calendar days", () => {
    const due = addCalendarDaysFromIso("2026-09-25T10:00:00.000Z", 3);
    expect(due.startsWith("2026-09-28")).toBe(true);
  });
});
