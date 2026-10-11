import { describe, expect, it } from "vitest";
import { serializePremiumOrderAdminListRow } from "../src/premium-order-workflow";

describe("premium admin list invoice fields", () => {
  it("exposes invoice payment badge labels for published orders with invoice", () => {
    const row = serializePremiumOrderAdminListRow({
      order_id: "ord_1",
      workflow_status: "published",
      payment_status: "unpaid",
      latest_invoice_id: "inv_1",
      latest_invoice_status: "issued",
      latest_invoice_paid_at: null,
      category_slug: "aff-test",
      position: 1,
      payload_json: "{}",
      company_name: "Test s.r.o.",
      created_at: "2026-10-01T10:00:00.000Z",
    });
    expect(row.invoice_issued).toBe(true);
    expect(row.invoice_paid).toBe(false);
    expect(row.invoice_payment_label_cs).toBe("Faktura neuhrazena");
  });

  it("does not show misleading invoice label without invoice", () => {
    const row = serializePremiumOrderAdminListRow({
      order_id: "ord_2",
      workflow_status: "published",
      payment_status: "unpaid",
      latest_invoice_id: null,
      category_slug: "aff-test",
      position: 2,
      payload_json: "{}",
      company_name: "Bez faktury s.r.o.",
      created_at: "2026-10-01T10:00:00.000Z",
    });
    expect(row.invoice_issued).toBe(false);
    expect(row.invoice_payment_label_cs).toBeNull();
  });
});
