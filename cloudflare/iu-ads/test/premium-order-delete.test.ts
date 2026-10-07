import { describe, expect, it } from "vitest";
import { handleAdminPremiumDeleteOrder } from "../src/premium-order-delete";
import type { Env } from "../src/types";

describe("premium order delete handler", () => {
  it("requires explicit confirm flag", async () => {
    const env = { DB: null } as unknown as Env;
    const req = new Request("https://ads.test/v1/admin/premium/orders/ord_x/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    const res = await handleAdminPremiumDeleteOrder(req, env, "ord_x");
    expect(res.status).toBe(503);
  });
});
