import { describe, expect, it, vi } from "vitest";
import { handleAdminPremiumSetPayment } from "../src/premium-admin-order-lifecycle";
import type { Env } from "../src/types";

vi.mock("../src/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin-auth")>();
  return {
    ...actual,
    requireAdminPermission: vi.fn(async () => ({ ok: true as const, userId: "admin_1" })),
  };
});

describe("premium admin payment confirmation", () => {
  it("returns idempotent ok when invoice already marked paid", async () => {
    let eventCount = 0;
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("FROM premium_selected_orders po WHERE")) {
              return { workflow_status: "published", payment_status: "paid", invoice_id: "inv_1" };
            }
            if (sql.includes("FROM admin_users")) {
              return { display_name: "Admin", email: null };
            }
            return null;
          },
          run: async () => {
            if (sql.includes("premium_order_events")) eventCount += 1;
            return {};
          },
        }),
      }),
    } as unknown as D1Database;

    const env = { DB: db } as Env;
    const res = await handleAdminPremiumSetPayment(
      new Request("https://ads.test/v1/admin/premium/orders/ord_1/payment", {
        method: "PATCH",
        body: JSON.stringify({ payment_status: "paid" }),
      }),
      env,
      "ord_1"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent?: boolean };
    expect(body.idempotent).toBe(true);
    expect(eventCount).toBe(0);
  });
});
