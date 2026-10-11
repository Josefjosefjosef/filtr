import { describe, expect, it } from "vitest";
import { serializePremiumOrderAdminListRow } from "../src/premium-order-workflow";

describe("premium admin list turned-off presentation", () => {
  it("exposes turned-off flags and Czech label for list UI", () => {
    const row = serializePremiumOrderAdminListRow({
      order_id: "ord_1",
      company_name: "Test s.r.o.",
      category_slug: "aff-auto-moto",
      position: 1,
      workflow_status: "published",
      ad_turned_off_at: "2026-10-11T18:20:00.000Z",
      created_at: "2026-10-01T00:00:00.000Z",
      payload_json: "{}",
      target_url: "https://example.test/",
      creative_id: "crv_1",
      latest_invoice_id: "inv_1",
      latest_invoice_status: "paid",
      payment_status: "paid",
    });
    expect(row.is_ad_turned_off).toBe(true);
    expect(row.workflow_status_label_cs).toBe("Vypnuto administrátorem");
    expect(row.invoice_payment_label_cs).toBe("Faktura uhrazena");
  });
});
