import { describe, expect, it } from "vitest";
import { executePremiumOrderAmend } from "../src/premium-admin-order-amend";
import type { Env } from "../src/types";

function mockDb(
  workflow: string,
  opts?: { confReady?: boolean; campaignId?: string; adTurnedOff?: boolean }
) {
  const confReady = opts?.confReady !== false;
  const campaignId = opts?.campaignId ?? "camp_1";
  const adTurnedOff = opts?.adTurnedOff === true;
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes("premium_selected_orders po")) {
            return {
              workflow_status: workflow,
              payload_json: "{}",
              client_id: "c1",
              placement_id: "aff-test:1",
              category_slug: "aff-test",
              position: 1,
              published_campaign_id: campaignId,
              ad_turned_off_at: adTurnedOff ? "2026-10-11T12:00:00.000Z" : null,
            };
          }
          if (sql.includes("premium_order_document_jobs") && sql.includes("order_confirmation")) {
            return confReady ? { ok: 1 } : null;
          }
          if (sql.includes("FROM admin_users")) return { display_name: "Admin Test", email: null };
          return null;
        },
        run: async () => ({}),
      }),
    }),
  } as unknown as D1Database;
}

describe("premium order amend guards", () => {
  it("blocks pending review orders", async () => {
    const env = { DB: mockDb("under_review") } as Env;
    const r = await executePremiumOrderAmend(env, {
      orderId: "ord_1",
      actorUserId: "u1",
      target_url: "https://example.test/new",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("pending_review");
  });

  it("blocks when ad is definitively turned off", async () => {
    const env = { DB: mockDb("published", { adTurnedOff: true }) } as Env;
    const r = await executePremiumOrderAmend(env, {
      orderId: "ord_1",
      actorUserId: "u1",
      target_url: "https://example.test/new",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ad_turned_off");
  });

  it("blocks when confirmation PDF is not ready", async () => {
    const env = { DB: mockDb("published", { confReady: false }) } as Env;
    const r = await executePremiumOrderAmend(env, {
      orderId: "ord_1",
      actorUserId: "u1",
      target_url: "https://example.test/new",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("confirmation_missing");
  });
});
