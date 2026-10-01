import { describe, expect, it } from "vitest";
import { resolveAuthoritativePriceCents, premiumPlacementId } from "../src/premium-selected-services";
import { validateTargetUrl } from "../src/url-safety";

describe("premium security invariants", () => {
  it("rejects price tampering", () => {
    const id = premiumPlacementId("aff-finance", 1);
    expect(resolveAuthoritativePriceCents(id, 1, 599000, 100)).toBe(599000);
    expect(resolveAuthoritativePriceCents(id, 1, 599000, 1)).toBe(599000);
  });

  it("rejects javascript: URLs", () => {
    expect(validateTargetUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(validateTargetUrl("data:text/html,hello").ok).toBe(false);
  });
});
