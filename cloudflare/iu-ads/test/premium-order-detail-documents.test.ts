import { describe, expect, it } from "vitest";
import { filterPremiumOrderDocumentsForAdminView, type AdminOrderDocumentCard } from "../src/premium-order-documents";

function card(kind: AdminOrderDocumentCard["kind"], status: AdminOrderDocumentCard["status"] = "ready"): AdminOrderDocumentCard {
  return {
    kind,
    title: kind,
    subtitle: "",
    status,
    document_id: status === "ready" ? "doc_" + kind : null,
    last_error: null,
    preview_path: null,
    download_path: null,
  };
}

describe("premium order detail documents", () => {
  it("does not strip storno or credit note cards for cancelled orders", () => {
    const cards = [
      card("order_confirmation"),
      card("invoice_pdf"),
      card("order_cancellation"),
      card("credit_note_pdf"),
    ];
    const out = filterPremiumOrderDocumentsForAdminView(cards, {
      workflow_status: "cancelled",
      published_at: "2026-01-01T00:00:00.000Z",
    });
    expect(out.map((c) => c.kind)).toEqual([
      "order_confirmation",
      "invoice_pdf",
      "order_cancellation",
      "credit_note_pdf",
    ]);
  });

  it("shows only rejection confirmation for rejected-before-publish orders", () => {
    const cards = [
      card("order_confirmation", "missing"),
      card("invoice_pdf", "missing"),
      card("order_cancellation"),
    ];
    const out = filterPremiumOrderDocumentsForAdminView(cards, {
      workflow_status: "rejected",
      published_at: null,
    });
    expect(out.map((c) => c.kind)).toEqual(["order_cancellation"]);
  });
});
