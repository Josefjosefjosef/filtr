import { describe, expect, it } from "vitest";
import { premiumOrderEligibleForExtendNewOrder } from "../src/premium-admin-extend-new-order";

describe("premium extend new order eligibility", () => {
  it("rejects when workflow is not published", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("premium_selected_orders po WHERE")) {
              return {
                workflow_status: "submitted",
                ad_turned_off_at: null,
                accounting_cancelled_at: null,
                published_campaign_id: null,
                placement_id: "p1",
              };
            }
            return null;
          },
        }),
      }),
    } as unknown as D1Database;
    const r = await premiumOrderEligibleForExtendNewOrder(db, "ord_x", new Date().toISOString());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_active");
  });
});
