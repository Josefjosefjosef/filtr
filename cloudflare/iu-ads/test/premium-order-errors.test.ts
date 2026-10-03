import { describe, expect, it } from "vitest";
import { PREMIUM_ORDER_ERROR_CS, premiumOrderErrorMessageCs } from "../src/premium-order-errors";

describe("premium order error Czech mapping", () => {
  it("maps known IČO codes", () => {
    expect(premiumOrderErrorMessageCs("ico_required")).toBe(PREMIUM_ORDER_ERROR_CS.ico_required);
    expect(premiumOrderErrorMessageCs("invalid_ico_format")).toBe(PREMIUM_ORDER_ERROR_CS.invalid_ico_format);
    expect(premiumOrderErrorMessageCs("invalid_ico_checksum")).toBe(PREMIUM_ORDER_ERROR_CS.invalid_ico_checksum);
    expect(PREMIUM_ORDER_ERROR_CS.invalid_ico_checksum).not.toContain("invalid_ico");
  });

  it("falls back for unknown codes", () => {
    expect(premiumOrderErrorMessageCs("unknown_code_xyz")).toMatch(/nezdařilo/i);
  });
});
