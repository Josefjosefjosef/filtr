import { describe, expect, it } from "vitest";
import {
  PREMIUM_DURATION_MONTHS,
  PREMIUM_MAX_POSITION,
  PREMIUM_POSITION_COUNT,
  PREMIUM_PRICE_STEP_CENTS,
  addCalendarDaysFromIso,
  addCalendarMonthsFromIso,
  defaultPriceCentsForPosition,
  formatPremiumTotalPriceLabelCs,
  isPremiumPosition,
  isPremiumSlotPubliclyListed,
  type PremiumPosition,
  parsePremiumPlacementId,
  premiumPlacementId,
  resolveAuthoritativePriceCents,
} from "../src/premium-selected-services";

describe("premium placement ids", () => {
  it("builds stable selected_services ids P1-P8", () => {
    expect(premiumPlacementId("aff-deti-hracky", 1)).toBe("selected_services.aff-deti-hracky.premium.01");
    expect(premiumPlacementId("aff-deti-hracky", 8)).toBe("selected_services.aff-deti-hracky.premium.08");
    expect(parsePremiumPlacementId("selected_services.aff-deti-hracky.premium.02")).toEqual({
      categorySlug: "aff-deti-hracky",
      position: 2,
    });
    expect(parsePremiumPlacementId("selected_services.aff-deti-hracky.premium.09")).toBeNull();
    expect(parsePremiumPlacementId("selected_services.aff-deti-hracky.premium.00")).toBeNull();
  });

  it("exposes eight positions", () => {
    expect(PREMIUM_MAX_POSITION).toBe(8);
    expect(PREMIUM_POSITION_COUNT).toBe(8);
    for (let i = 1; i <= 8; i++) expect(isPremiumPosition(i)).toBe(true);
    expect(isPremiumPosition(0)).toBe(false);
    expect(isPremiumPosition(9)).toBe(false);
  });
});

describe("sales catalog listing", () => {
  it("always lists P1–P8 (independent of premium_capacity)", () => {
    for (const cap of [2, 4, 8] as const) {
      for (let pos = 1; pos <= 8; pos++) {
        expect(isPremiumSlotPubliclyListed(cap, pos as PremiumPosition)).toBe(true);
      }
    }
  });
});

describe("customer price labels", () => {
  it("states total price for full 6-month period", () => {
    expect(formatPremiumTotalPriceLabelCs(599000)).toContain("Celková cena za 6 měsíců:");
    expect(formatPremiumTotalPriceLabelCs(599000)).toContain("990");
    expect(formatPremiumTotalPriceLabelCs(599000)).toContain("bez DPH");
    expect(formatPremiumTotalPriceLabelCs(389000)).toContain("890");
    expect(formatPremiumTotalPriceLabelCs(389000)).not.toMatch(/\/\s*6 měsíců/);
  });
});

describe("server-authoritative pricing", () => {
  const expected: Record<number, number> = {
    1: 599000,
    2: 569000,
    3: 539000,
    4: 509000,
    5: 479000,
    6: 449000,
    7: 419000,
    8: 389000,
  };

  it("uses catalog price and ignores tampered client price for all positions", () => {
    for (let pos = 1; pos <= 8; pos++) {
      const p = pos as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
      const id = premiumPlacementId("aff-finance", p);
      const cents = expected[pos];
      expect(defaultPriceCentsForPosition(p)).toBe(cents);
      expect(resolveAuthoritativePriceCents(id, p, cents, 100)).toBe(cents);
      expect(resolveAuthoritativePriceCents(id, p, cents, expected[8])).toBe(cents);
    }
    expect(PREMIUM_DURATION_MONTHS).toBe(6);
    expect(PREMIUM_PRICE_STEP_CENTS).toBe(30000);
  });

  it("price step invariant", () => {
    for (let n = 1; n < 8; n++) {
      const p = n as PremiumPosition;
      const next = (n + 1) as PremiumPosition;
      expect(defaultPriceCentsForPosition(next)).toBe(defaultPriceCentsForPosition(p) - PREMIUM_PRICE_STEP_CENTS);
    }
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

describe("historical contract price immutability (logic)", () => {
  it("authoritative resolver uses catalog snapshot, not client tampering", () => {
    const historicalP4 = 299000;
    const id = premiumPlacementId("aff-finance", 4);
    expect(resolveAuthoritativePriceCents(id, 4, historicalP4, 509000)).toBe(historicalP4);
    expect(resolveAuthoritativePriceCents(id, 4, 509000, historicalP4)).toBe(509000);
  });
});
