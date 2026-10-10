import { describe, expect, it } from "vitest";
import { resolvePremiumOrderPdfBillingFields } from "../src/premium-order-pdf-fields";

describe("resolvePremiumOrderPdfBillingFields", () => {
  it("keeps structured payload billing when complete", () => {
    const out = resolvePremiumOrderPdfBillingFields({
      billing: { street: "Ulice 1", city: "Praha", zip: "110 00", country: "CZ" },
      clientAddress: null,
      clientBillingInfo: null,
    });
    expect(out.street).toBe("Ulice 1");
    expect(out.zip).toBe("110 00");
  });

  it("falls back to client billing_info lines", () => {
    const out = resolvePremiumOrderPdfBillingFields({
      billing: null,
      clientAddress: null,
      clientBillingInfo: "Hlavní 9\n602 00 Brno",
    });
    expect(out.street).toBe("Hlavní 9");
    expect(out.city).toContain("Brno");
  });
});
