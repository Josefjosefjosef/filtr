import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdminPremiumDeleteOrder } from "../src/premium-order-delete";
import { deleteExclusiveCampaignForPurge } from "../src/premium-order-purge";
import type { Env } from "../src/types";

vi.mock("../src/admin-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/admin-auth")>();
  return {
    ...mod,
    requireAdminPermission: vi.fn(async () => ({
      ok: true as const,
      userId: "adm_main",
      roles: ["main_admin"],
    })),
    insertAuditLog: vi.fn(async () => undefined),
    newId: (p: string) => p + "_test",
  };
});

type Row = Record<string, unknown>;

class PurgeDeleteDb {
  premiumOrders = new Map<string, Row>();
  orders = new Map<string, Row>();
  campaigns = new Map<string, Row>();
  creatives: Row[] = [];
  rights: Row[] = [];
  placements: Row[] = [];
  runLog: string[] = [];

  prepare(sql: string) {
    const self = this;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>() {
            return self.query(sql, params, "first") as T | null;
          },
          async all<T>() {
            return { results: (self.query(sql, params, "all") as T[]) || [] };
          },
          async run() {
            self.query(sql, params, "run");
            return { success: true };
          },
        };
      },
    };
  }

  query(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): unknown {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();
    if (mode === "run") this.runLog.push(sql.slice(0, 72));

    if (sql.includes("published_campaign_id = ? AND order_id != ?")) {
      return null;
    }

    if (sql.includes("FROM creatives WHERE campaign_id = ?")) {
      const campId = String(params[0]);
      const rows = this.creatives.filter((c) => c.campaign_id === campId);
      return mode === "all" ? rows : rows[0] || null;
    }

    if (sql.includes("DELETE FROM creatives WHERE creative_id = ?")) {
      const id = String(params[0]);
      this.creatives = this.creatives.filter((c) => c.creative_id !== id);
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("DELETE FROM campaigns WHERE campaign_id = ?")) {
      const id = String(params[0]);
      const blocked = this.creatives.some((c) => c.campaign_id === id);
      if (blocked) throw new Error("SQLITE_CONSTRAINT: creatives still reference campaign");
      this.campaigns.delete(id);
      return mode === "run" ? { success: true } : null;
    }

    if (sql.startsWith("DELETE FROM")) {
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("FROM premium_selected_orders po JOIN orders o") && sql.includes("WHERE po.order_id = ?")) {
      const id = String(params[0]);
      const po = this.premiumOrders.get(id);
      const ord = this.orders.get(id);
      if (!po || !ord) return null;
      return { ...po, client_id: ord.client_id, customer_order_code: ord.customer_order_code, order_number: ord.order_number };
    }

    if (sql.includes("COALESCE(payment_status") && sql.includes("premium_selected_orders WHERE order_id")) {
      const po = this.premiumOrders.get(String(params[0]));
      return po ? { payment_status: "unpaid", paid_at: null } : null;
    }

    if (sql.includes("FROM invoices WHERE order_id = ? ORDER BY created_at DESC LIMIT 1")) {
      return null;
    }

    if (sql.includes("JOIN clients c ON") && sql.includes("WHERE po.order_id = ?")) {
      return {
        target_url: "https://example.test/",
        payload_json: "{}",
        company_name: "Test s.r.o.",
        contact_email: "t@test.cz",
      };
    }

    if (sql.includes("SELECT invoice_id FROM invoices WHERE order_id = ? LIMIT 1")) {
      return { invoice_id: "inv_1" };
    }

    if (sql.includes("COUNT(*) AS c FROM premium_selected_orders WHERE creative_id = ?")) {
      return { c: 0 };
    }

    if (sql.includes("COUNT(*) AS c FROM orders WHERE client_id = ?")) {
      return { c: 0 };
    }

    if (sql.includes("parent_order_id = ?")) {
      return null;
    }

    if (mode === "all") return [];
    if (mode === "run") return { success: true };
    return null;
  }
}

describe("premium order purge delete integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleteExclusiveCampaignForPurge removes creatives before campaigns", async () => {
    const db = new PurgeDeleteDb();
    db.campaigns.set("camp_1", { campaign_id: "camp_1" });
    db.creatives.push({ creative_id: "cr_1", campaign_id: "camp_1", r2_key: "c/a.png", client_id: "cli_1" });
    const env = {
      DB: db as unknown as D1Database,
      CREATIVES: { delete: async () => undefined },
    } as Env;
    await deleteExclusiveCampaignForPurge(env, "camp_1", "ord_1");
    expect(db.creatives.length).toBe(0);
    expect(db.campaigns.has("camp_1")).toBe(false);
    const campIdx = db.runLog.findIndex((l) => l.includes("DELETE FROM campaigns"));
    const crIdx = db.runLog.findIndex((l) => l.includes("DELETE FROM creatives"));
    const statusEvIdx = db.runLog.findIndex((l) => l.includes("DELETE FROM campaign_status_events"));
    expect(crIdx).toBeGreaterThanOrEqual(0);
    expect(statusEvIdx).toBeGreaterThanOrEqual(0);
    expect(campIdx).toBeGreaterThan(crIdx);
  });

  it("main admin purge POST returns ok when eligibility passes", async () => {
    const db = new PurgeDeleteDb();
    const orderId = "ord_purge_ui";
    db.orders.set(orderId, { order_id: orderId, client_id: "cli_1", customer_order_code: "IU-26-TEST" });
    db.premiumOrders.set(orderId, {
      order_id: orderId,
      placement_id: "pl_1",
      published_campaign_id: "camp_1",
      creative_id: "cr_1",
    });
    db.campaigns.set("camp_1", { campaign_id: "camp_1" });
    db.creatives.push({ creative_id: "cr_1", campaign_id: "camp_1", r2_key: "c/x.png", client_id: "cli_1" });

    const env = {
      DB: db as unknown as D1Database,
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
    } as Env;

    const req = new Request("https://ads.test/v1/admin/premium/orders/" + orderId + "/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: true,
        purge_system_record: true,
        explicit_test_purge_confirmed: true,
      }),
    });
    const res = await handleAdminPremiumDeleteOrder(req, env, orderId);
    const body = (await res.json()) as { ok?: boolean; mode?: string; message_cs?: string; error?: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("purge_system");
  });

  it("purge rejection returns message_cs for paid accounting", async () => {
    const db = new PurgeDeleteDb();
    const orderId = "ord_paid";
    db.orders.set(orderId, { order_id: orderId, client_id: "cli_1" });
    db.premiumOrders.set(orderId, { order_id: orderId, payment_status: "paid", paid_at: "2026-01-01" });

    const origQuery = db.query.bind(db);
    db.query = (sql, params, mode) => {
      if (sql.includes("COALESCE(payment_status") && sql.includes("premium_selected_orders WHERE order_id")) {
        return mode === "first" ? { payment_status: "paid", paid_at: "2026-01-01" } : null;
      }
      return origQuery(sql, params, mode);
    };

    const env = { DB: db as unknown as D1Database } as Env;
    const req = new Request("https://ads.test/v1/admin/premium/orders/" + orderId + "/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, purge_system_record: true, explicit_test_purge_confirmed: true }),
    });
    const res = await handleAdminPremiumDeleteOrder(req, env, orderId);
    const body = (await res.json()) as { error?: string; message_cs?: string };
    expect(res.status).toBe(403);
    expect(body.error).toBe("purge_paid_accounting");
    expect(body.message_cs).toMatch(/úhrad/i);
  });
});
