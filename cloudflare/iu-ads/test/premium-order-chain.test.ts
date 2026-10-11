import { describe, expect, it } from "vitest";
import {
  loadPremiumOrderChainMembers,
  premiumOrderChainArchive,
  premiumOrderChainTip,
  premiumOrderReference,
} from "../src/premium-order-chain";

describe("premium order chain", () => {
  it("walks parent chain to root and collects children in period order", async () => {
    const rows = new Map<string, Record<string, unknown>>([
      [
        "ord_root",
        {
          order_id: "ord_root",
          parent_order_id: null,
          created_at: "2026-04-01T00:00:00.000Z",
          billed_service_start_at: "2026-04-11T18:12:00.000Z",
          billed_service_end_at: "2026-10-11T18:12:00.000Z",
          workflow_status: "published",
          payment_status: "paid",
          accounting_cancelled_at: null,
          ad_turned_off_at: null,
          customer_order_code: "IU-ROOT",
          order_number: "IU-ROOT",
        },
      ],
      [
        "ord_child",
        {
          order_id: "ord_child",
          parent_order_id: "ord_root",
          created_at: "2026-10-11T18:15:00.000Z",
          billed_service_start_at: "2026-10-11T18:12:00.000Z",
          billed_service_end_at: "2027-04-11T18:12:00.000Z",
          workflow_status: "published",
          payment_status: "unpaid",
          accounting_cancelled_at: null,
          ad_turned_off_at: null,
          customer_order_code: "IU-CHILD",
          order_number: "IU-CHILD",
        },
      ],
    ]);

    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            if (sql.includes("parent_order_id FROM premium_selected_orders")) {
              const id = String(params[0]);
              const row = rows.get(id);
              return row ? { parent_order_id: row.parent_order_id } : null;
            }
            if (sql.includes("JOIN orders o")) {
              const id = String(params[0]);
              return rows.get(id) ?? null;
            }
            return null;
          },
          all: async () => {
            if (sql.includes("WHERE parent_order_id = ?")) {
              const parent = String(params[0]);
              const out: { order_id: string }[] = [];
              for (const row of rows.values()) {
                if (row.parent_order_id === parent) out.push({ order_id: String(row.order_id) });
              }
              return { results: out };
            }
            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Database;

    const fromChild = await loadPremiumOrderChainMembers(db, "ord_child");
    expect(fromChild).toHaveLength(2);
    expect(premiumOrderReference(fromChild[0]!)).toBe("IU-ROOT");
    expect(premiumOrderReference(fromChild[1]!)).toBe("IU-CHILD");

    const tip = premiumOrderChainTip(fromChild);
    expect(tip?.order_id).toBe("ord_child");

    const archive = premiumOrderChainArchive(fromChild, "ord_child");
    expect(archive).toHaveLength(1);
    expect(archive[0]?.order_id).toBe("ord_root");
  });
});
