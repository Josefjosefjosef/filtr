import { describe, expect, it } from "vitest";
import { computeAccountingSettlementRecap } from "../src/premium-accounting-settlement";
import { executePremiumOrderAccountingCancel } from "../src/premium-order-accounting-cancel";
import { filterPremiumOrderDocumentsForAdminView } from "../src/premium-order-documents";
import type { AdminOrderDocumentCard } from "../src/premium-order-documents";

describe("accounting cancel — full invoice storno", () => {
  it("recap uses 100% storno for typical invoice", () => {
    const recap = computeAccountingSettlementRecap({
      originalInvoiceCents: 389000,
      priorCorrectedCents: 0,
      stornoAmountCents: 389000,
      paymentMode: "unpaid",
      amountPaidCents: 0,
    });
    expect(recap.credit_note_cents).toBe(-389000);
    expect(recap.new_service_price_cents).toBe(0);
    expect(recap.remaining_due_cents).toBe(0);
  });

  it("rejects paid settlement when system shows unpaid", async () => {
    const orderId = "ord_pay_guard";
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("premium_order_storno_records WHERE order_id")) return null;
            if (sql.includes("FROM premium_selected_orders po")) {
              return {
                order_id: orderId,
                workflow_status: "published",
                placement_id: "pl_1",
                published_campaign_id: "cmp_1",
                ad_turned_off_at: "2026-10-10T00:00:00.000Z",
                payment_status: "unpaid",
                published_at: "2026-10-02T00:00:00.000Z",
                campaign_status: "ended",
              };
            }
            if (sql.includes("FROM invoices WHERE order_id")) {
              return {
                invoice_id: "inv_1",
                invoice_number: "INV-1",
                total_cents: 100000,
                currency: "CZK",
                status: "issued",
                paid_at: null,
              };
            }
            if (sql.includes("FROM premium_selected_placements")) return { placement_id: "pl_1" };
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;
    const env = { DB: db } as import("../src/types").Env;
    const r = await executePremiumOrderAccountingCancel(env, {
      orderId,
      actorUserId: "admin_1",
      reason: "Test guard proti falešné úhradě při stornu.",
      paymentSettlement: "paid",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("payment_evidence_unpaid");
  });
});

describe("rejected order document list", () => {
  const sampleCards: AdminOrderDocumentCard[] = [
    {
      kind: "order_confirmation",
      title: "Potvrzení objednávky",
      subtitle: "",
      status: "ready",
      document_id: "d1",
      last_error: null,
      preview_path: null,
      download_path: null,
    },
    {
      kind: "order_cancellation",
      title: "Potvrzení o stornování objednávky",
      subtitle: "",
      status: "ready",
      document_id: "d2",
      last_error: null,
      preview_path: null,
      download_path: null,
    },
  ];

  it("hides invoice and confirmation for rejected-before-publish", () => {
    const out = filterPremiumOrderDocumentsForAdminView(sampleCards, {
      workflow_status: "rejected",
      published_at: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("order_cancellation");
  });
});
