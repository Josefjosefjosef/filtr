import { describe, expect, it } from "vitest";
import { normalizeCustomerOrderCode } from "../src/premium-order-access-code";
import { parsePremiumPortalScope, premiumPortalScopeJson } from "../src/premium-order-portal";

describe("premium order portal scope", () => {
  it("normalizes customer order codes case-insensitively", () => {
    expect(normalizeCustomerOrderCode("iu-26-abcd-efgh")).toBe("IU-26-ABCD-EFGH");
  });

  it("serializes and parses premium portal scope", () => {
    const json = premiumPortalScopeJson("ord_test");
    expect(parsePremiumPortalScope(json)).toEqual({
      product: "premium_selected",
      premium_order_id: "ord_test",
    });
    expect(parsePremiumPortalScope(null)).toBeNull();
  });
});
