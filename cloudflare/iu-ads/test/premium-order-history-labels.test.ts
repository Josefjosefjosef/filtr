import { describe, expect, it } from "vitest";
import { formatPremiumOrderEventLineCs } from "../src/premium-order-history";

describe("premium order history Czech labels", () => {
  it("maps document_pdf_replaced and payment to readable Czech", () => {
    const replaced = formatPremiumOrderEventLineCs({
      event_type: "document_pdf_replaced",
      payload: { doc_kind: "order_confirmation", version: 2 },
      created_at_label_cs: "11. 10. 2026 18:31",
      actor_user_id: null,
    });
    expect(replaced.toLowerCase()).toContain("verze 2");
    expect(replaced).not.toContain("document_pdf_replaced");

    const paid = formatPremiumOrderEventLineCs({
      event_type: "payment_status_changed",
      payload: { from: "unpaid", to: "paid", actor_label: "Jan Admin" },
      created_at_label_cs: "11. 10. 2026 18:31",
      actor_user_id: "usr_x",
    });
    expect(paid).toContain("Úhrada faktury");
    expect(paid).not.toContain("usr_");
  });

  it("admin_edit lists changed fields in Czech", () => {
    const line = formatPremiumOrderEventLineCs({
      event_type: "admin_edit",
      payload: {
        fields: ["target_url", "price"],
        confirmation_regenerated: true,
        confirmation_version: 2,
        actor_label: "Eva Správce",
      },
      created_at_label_cs: "11. 10. 2026 18:31",
      actor_user_id: "usr_y",
    });
    expect(line).toContain("Objednávka upravena");
    expect(line).toContain("cílová URL");
    expect(line).toContain("verze 2");
    expect(line).not.toContain("usr_y");
  });
});
