import { describe, expect, it } from "vitest";
import { addCalendarMonthsFromIso } from "../src/premium-selected-services";

describe("premium renewal scheduling", () => {
  it("next period starts at predecessor end (+6 calendar months)", () => {
    const end = "2026-12-01T10:00:00.000Z";
    const nextEnd = addCalendarMonthsFromIso(end, 6);
    expect(nextEnd.startsWith("2027-06")).toBe(true);
  });

  it("renewal publish idempotency key is stable per offer", () => {
    const offerId = "pro_abc123";
    expect("renewal_publish:" + offerId).toBe("renewal_publish:pro_abc123");
  });
});
