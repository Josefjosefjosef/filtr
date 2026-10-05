import { describe, expect, it } from "vitest";
import {
  parsePremiumPlacementId,
  premiumPlacementId,
  resolveAuthoritativePriceCents,
} from "../src/premium-selected-services";
import { validateTargetUrl } from "../src/url-safety";

describe("premium security invariants", () => {
  it("rejects price tampering P1-P8", () => {
    for (let pos = 1; pos <= 8; pos++) {
      const p = pos as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
      const id = premiumPlacementId("aff-finance", p);
      const catalog = 599000 - (pos - 1) * 30000;
      expect(resolveAuthoritativePriceCents(id, p, catalog, 100)).toBe(catalog);
      expect(resolveAuthoritativePriceCents(id, p, catalog, 389000)).toBe(catalog);
    }
  });

  it("rejects invalid placement ids P9 and P0", () => {
    expect(parsePremiumPlacementId("selected_services.aff-finance.premium.09")).toBeNull();
    expect(parsePremiumPlacementId("selected_services.aff-finance.premium.00")).toBeNull();
  });

  it("rejects javascript: URLs", () => {
    expect(validateTargetUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(validateTargetUrl("data:text/html,hello").ok).toBe(false);
  });
});
