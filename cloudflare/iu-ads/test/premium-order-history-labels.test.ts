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
    expect(replaced).toContain("Potvrzení objednávky");
    expect(replaced).not.toContain("document_pdf_replaced");
    expect(replaced).not.toContain("Dokument aktualizován");

    const stornoReplaced = formatPremiumOrderEventLineCs({
      event_type: "document_pdf_replaced",
      payload: {
        doc_type: "premium_order_cancellation",
        title: "Storno objednávky STO-2026-000006",
        new_version: 2,
      },
      created_at_label_cs: "11. 10. 2026 22:44",
      actor_user_id: null,
    });
    expect(stornoReplaced).toContain("STO-2026-000006");
    expect(stornoReplaced).toContain("aktualizováno");

    const stornoCreated = formatPremiumOrderEventLineCs({
      event_type: "storno_pdf_created",
      payload: { storno_number: "STO-2026-000006", title: "Storno objednávky STO-2026-000006" },
      created_at_label_cs: "11. 10. 2026 22:44",
      actor_user_id: null,
    });
    expect(stornoCreated).toContain("STO-2026-000006 vytvořeno");

    const creditCreated = formatPremiumOrderEventLineCs({
      event_type: "credit_note_pdf_created",
      payload: { credit_note_number: "DOB-2026-000001", title: "Dobropis DOB-2026-000001" },
      created_at_label_cs: "11. 10. 2026 22:44",
      actor_user_id: null,
    });
    expect(creditCreated).toContain("DOB-2026-000001 vystaven");

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
