import { describe, expect, it } from "vitest";
import { buildAdminPremiumPreviewScopedCss, wrapAdminPremiumPreviewHtml } from "../src/premium-admin-preview-css";
import { generateCustomerOrderCode, normalizeCustomerOrderCode } from "../src/premium-order-access-code";

describe("premium admin order contact + preview", () => {
  it("customer order code is non-sequential IU-YY format", () => {
    const { plaintext } = generateCustomerOrderCode(new Date("2026-10-07T12:00:00Z"));
    expect(plaintext).toMatch(/^IU-26-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(normalizeCustomerOrderCode("iu-26-abcd-efgh")).toBe("IU-26-ABCD-EFGH");
  });

  it("admin preview scoped css constrains slot height", () => {
    const css = buildAdminPremiumPreviewScopedCss();
    expect(css).toContain("--iuChipH:110px");
    expect(css).toContain(".admin-premium-preview-scope");
  });

  it("preview html wraps slot for geometry", () => {
    const html = wrapAdminPremiumPreviewHtml('<a class="iuPremiumSlot"></a>');
    expect(html).toContain("admin-premium-preview-scope");
  });
});
