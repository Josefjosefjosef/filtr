import { describe, expect, it } from "vitest";
import { validatePremiumPhone } from "../src/czech-phone";

describe("premium phone validation", () => {
  it("requires non-empty phone", () => {
    expect(validatePremiumPhone("").ok).toBe(false);
  });

  it("accepts spaced CZ numbers", () => {
    const r = validatePremiumPhone("+420 777 123 456");
    expect(r.ok).toBe(true);
  });

  it("rejects too short numbers", () => {
    expect(validatePremiumPhone("12345").ok).toBe(false);
  });
});
