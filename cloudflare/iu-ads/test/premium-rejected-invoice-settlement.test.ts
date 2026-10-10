import { describe, expect, it } from "vitest";
import { executePremiumRejectedOrderInvoiceSettlement } from "../src/premium-order-accounting-cancel";
import { executePremiumOrderReject } from "../src/premium-publication-consistency";
import { executePremiumAdTurnOff } from "../src/premium-ad-turnoff";

describe("reject + invoice settlement guards", () => {
  it("blocks reject on published workflow", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM premium_selected_orders WHERE order_id")) {
              return {
                order_id: params[0],
                placement_id: "pl_p1",
                workflow_status: "published",
                published_campaign_id: "cmp_1",
              };
            }
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;
    const env = { DB: db } as import("../src/types").Env;
    const r = await executePremiumOrderReject(env, { orderId: "ord_x", actorUserId: "u", reason: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("cannot_reject_published");
  });

  it("requires explicit correction for rejected invoice settlement", async () => {
    const env = { DB: {} as D1Database } as import("../src/types").Env;
    const r = await executePremiumRejectedOrderInvoiceSettlement(env, {
      orderId: "ord_x",
      actorUserId: "u",
      reason: "test",
      correctionCents: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("correction_required");
  });
});

describe("ad turn-off placement release (unit)", () => {
  it("clears active_campaign_id on placement after turn-off", async () => {
    const placement = { placement_id: "aff-x-P1", active_campaign_id: "cmp_live" };
    const campaigns = new Map([
      [
        "cmp_live",
        { campaign_id: "cmp_live", order_id: "ord_old", status: "active", end_at: "2099-01-01T00:00:00.000Z" },
      ],
    ]);
    const orders = new Map([
      [
        "ord_old",
        {
          order_id: "ord_old",
          placement_id: "aff-x-P1",
          workflow_status: "published",
          published_campaign_id: "cmp_live",
          ad_turned_off_at: null,
        },
      ],
    ]);
    let cleared = false;
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            if (sql.includes("ad_turned_off_at") && sql.includes("FROM premium_selected_orders")) {
              return orders.get(String(params[0])) || null;
            }
            if (sql.includes("FROM premium_selected_placements")) {
              return placement;
            }
            if (sql.includes("FROM campaigns WHERE campaign_id")) {
              return campaigns.get(String(params[0])) || null;
            }
            if (sql.includes("FROM campaigns WHERE order_id")) {
              return { campaign_id: "cmp_live" };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM campaigns WHERE order_id")) return { results: [{ campaign_id: "cmp_live" }] };
            return { results: [] };
          },
          run: async () => {
            if (sql.includes("UPDATE premium_selected_placements SET active_campaign_id = NULL")) {
              if (placement.active_campaign_id === params[2]) {
                placement.active_campaign_id = null;
                cleared = true;
              }
            }
            if (sql.includes("UPDATE premium_selected_orders SET ad_turned_off_at")) {
              const row = orders.get(String(params[4]));
              if (row) row.ad_turned_off_at = params[0];
            }
            return { meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    const env = { DB: db } as import("../src/types").Env;
    const r = await executePremiumAdTurnOff(env, {
      orderId: "ord_old",
      actorUserId: "admin",
      reason: "test release",
    });
    expect(r.ok).toBe(true);
    expect(cleared).toBe(true);
    expect(placement.active_campaign_id).toBeNull();
  });
});
