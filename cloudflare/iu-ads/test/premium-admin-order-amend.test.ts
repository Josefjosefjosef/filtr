import { describe, expect, it } from "vitest";
import { executePremiumOrderAmend } from "../src/premium-admin-order-amend";
import type { Env } from "../src/types";

describe("premium order amend", () => {
  it("rejects invalid IČO before writes", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes("premium_selected_orders po")) {
              return {
                workflow_status: "published",
                payload_json: "{}",
                client_id: "c1",
                placement_id: "cat-a:1",
                category_slug: "cat-a",
                position: 1,
                published_campaign_id: "camp1",
              };
            }
            return null;
          },
          run: async () => ({}),
        }),
      }),
    } as unknown as D1Database;
    const env = { DB: db } as Env;
    const r = await executePremiumOrderAmend(env, {
      orderId: "ord_1",
      actorUserId: "u1",
      ico: "12345678",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid_ico");
  });

  it("rejects rejected workflow", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            workflow_status: "rejected",
            payload_json: "{}",
            client_id: "c1",
          }),
        }),
      }),
    } as unknown as D1Database;
    const env = { DB: db } as Env;
    const r = await executePremiumOrderAmend(env, { orderId: "ord_1", actorUserId: "u1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("rejected");
  });
});
