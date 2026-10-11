import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPremiumCampaignLiveNow } from "../src/premium-display";
import {
  executePremiumExtendNewOrder,
  premiumOrderEligibleForExtendNewOrder,
} from "../src/premium-admin-extend-new-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import type { Env } from "../src/types";

const docsMock = vi.fn(async () => undefined);
vi.mock("../src/premium-order-documents", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/premium-order-documents")>();
  return { ...mod, ensurePremiumOrderDocumentsAfterPublish: (...args: unknown[]) => docsMock(...args) };
});

type Row = Record<string, unknown>;

class ExtendIntegrationDb {
  premiumOrders = new Map<string, Row>();
  orders = new Map<string, Row>();
  campaigns = new Map<string, Row>();
  placements = new Map<string, Row>();
  renewals = new Map<string, Row>();
  invoices: Row[] = [];
  campaignPlacements: Row[] = [];
  events: Row[] = [];

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
            return { success: true, meta: { changes: 1 } };
          },
        };
      },
    };
  }

  query(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): unknown {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("FROM premium_selected_orders po WHERE po.order_id = ?") && sql.includes("workflow_status")) {
      const id = String(params[0]);
      const po = this.premiumOrders.get(id);
      if (!po) return null;
      return {
        workflow_status: po.workflow_status,
        ad_turned_off_at: po.ad_turned_off_at ?? null,
        accounting_cancelled_at: po.accounting_cancelled_at ?? null,
        published_campaign_id: po.published_campaign_id ?? null,
        placement_id: po.placement_id,
      };
    }

    if (sql.includes("FROM campaigns WHERE campaign_id = ?") && sql.includes("status, end_at")) {
      const c = this.campaigns.get(String(params[0]));
      return c ? { status: c.status, end_at: c.end_at } : null;
    }

    if (sql.includes("FROM premium_selected_placements WHERE placement_id = ?") && sql.includes("active_campaign_id")) {
      const p = this.placements.get(String(params[0]));
      return p ? { active_campaign_id: p.active_campaign_id ?? null } : null;
    }

    if (sql.includes("workflow_status IN ('submitted','under_review')")) {
      const [placementId, excludeId] = params;
      for (const po of this.premiumOrders.values()) {
        if (
          po.placement_id === placementId &&
          po.order_id !== excludeId &&
          (po.workflow_status === "submitted" || po.workflow_status === "under_review")
        ) {
          return mode === "first" ? { order_id: po.order_id } : [{ order_id: po.order_id }];
        }
      }
      return mode === "first" ? null : [];
    }

    if (sql.includes("FROM premium_order_renewals WHERE idempotency_key = ?")) {
      const key = String(params[0]);
      const r = this.renewals.get(key);
      return r ? { follow_up_order_id: r.follow_up_order_id, new_end_at: r.new_end_at } : null;
    }

    if (sql.includes("FROM invoices WHERE order_id = ?") && sql.includes("invoice_number")) {
      const oid = String(params[0]);
      const inv = this.invoices.filter((i) => i.order_id === oid).slice(-1)[0];
      return inv ? { invoice_id: inv.invoice_id, invoice_number: inv.invoice_number } : null;
    }

    if (sql.includes("FROM orders WHERE order_id = ?") && sql.includes("customer_order_code")) {
      return this.orders.get(String(params[0])) || null;
    }

    if (sql.includes("JOIN campaigns camp ON camp.campaign_id = po.published_campaign_id") && sql.includes("WHERE po.order_id = ?")) {
      const po = this.premiumOrders.get(String(params[0]));
      if (!po) return null;
      const ord = this.orders.get(String(params[0]));
      const camp = this.campaigns.get(String(po.published_campaign_id));
      return { ...po, ...ord, camp_end_at: camp?.end_at, campaign_id: po.published_campaign_id };
    }

    if (sql.startsWith("INSERT INTO orders")) {
      const [orderId] = params;
      this.orders.set(String(orderId), {
        order_id: orderId,
        client_id: params[1],
        order_number: params[2],
        customer_order_code: params[5],
        payload_json: params[6],
      });
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("INSERT INTO premium_selected_orders")) {
      const orderId = String(params[0]);
      this.premiumOrders.set(orderId, {
        order_id: orderId,
        placement_id: params[1],
        category_slug: params[2],
        position: params[3],
        workflow_status: params[4],
        target_url: params[5],
        creative_mode: params[6],
        creative_id: params[7],
        published_campaign_id: params[10],
        parent_order_id: params[13],
        billed_service_start_at: params[14],
        billed_service_end_at: params[15],
      });
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("INSERT INTO premium_order_price_snapshots")) {
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("INSERT INTO invoices")) {
      this.invoices.push({
        invoice_id: params[0],
        order_id: params[2],
        invoice_number: params[4],
        total_cents: params[10],
      });
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("UPDATE campaigns SET target_url = ?")) {
      const [url, , campId] = params;
      const c = this.campaigns.get(String(campId));
      if (c) c.target_url = url;
      return mode === "run" ? { success: true } : null;
    }
    if (sql.includes("UPDATE campaigns SET end_at = ?")) {
      const [endAt, , campId] = params;
      const c = this.campaigns.get(String(campId));
      if (c) c.end_at = endAt;
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("UPDATE campaign_placements SET end_at = ?")) {
      const [endAt, , campId] = params;
      for (const cp of this.campaignPlacements) {
        if (cp.campaign_id === campId) cp.end_at = endAt;
      }
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("INSERT INTO premium_order_renewals")) {
      const key = String(params[12]);
      this.renewals.set(key, {
        follow_up_order_id: params[13],
        new_end_at: params[5],
        order_id: params[1],
      });
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("INSERT INTO premium_order_events") || sql.includes("INSERT INTO audit_logs")) {
      return mode === "run" ? { success: true } : null;
    }

    if (mode === "all") return [];
    if (mode === "run") return { success: true };
    return null;
  }

  countChildOrders(): number {
    let n = 0;
    for (const po of this.premiumOrders.values()) {
      if (po.parent_order_id) n++;
    }
    return n;
  }
}

describe("premium extend new order integration", () => {
  const sourceOrderId = "ord_src";
  const campaignId = "camp_1";
  const placementId = premiumPlacementId("aff-auto-moto", 2);
  const campEnd = "2027-04-10T00:00:00.000Z";
  const campStart = "2026-10-10T00:00:00.000Z";
  const newEnd = "2027-10-10T00:00:00.000Z";
  let db: ExtendIntegrationDb;

  beforeEach(() => {
    docsMock.mockClear();
    db = new ExtendIntegrationDb();
    db.campaigns.set(campaignId, {
      campaign_id: campaignId,
      status: "active",
      start_at: campStart,
      end_at: campEnd,
      target_url: "https://example.invalid/ad",
    });
    db.placements.set(placementId, { placement_id: placementId, active_campaign_id: campaignId });
    db.campaignPlacements.push({ campaign_id: campaignId, start_at: campStart, end_at: campEnd });
    db.orders.set(sourceOrderId, {
      order_id: sourceOrderId,
      client_id: "cli_1",
      payload_json: JSON.stringify({ agreed_price_cents: 599000, iu_dev_test: true }),
      contact_person: "Tester",
    });
    db.premiumOrders.set(sourceOrderId, {
      order_id: sourceOrderId,
      placement_id: placementId,
      category_slug: "aff-auto-moto",
      position: 2,
      workflow_status: "published",
      published_campaign_id: campaignId,
      target_url: "https://example.invalid/ad",
      creative_id: "crv_1",
      creative_mode: "image_large",
      parent_order_id: null,
    });
  });

  it("allows extend only for active published campaign", async () => {
    const ok = await premiumOrderEligibleForExtendNewOrder(
      db as unknown as D1Database,
      sourceOrderId,
      "2027-03-01T12:00:00.000Z"
    );
    expect(ok.ok).toBe(true);

    db.premiumOrders.get(sourceOrderId)!.workflow_status = "submitted";
    const bad = await premiumOrderEligibleForExtendNewOrder(
      db as unknown as D1Database,
      sourceOrderId,
      "2027-03-01T12:00:00.000Z"
    );
    expect(bad.ok).toBe(false);
  });

  it("creates child order, invoice, extends campaign, idempotent replay", async () => {
    const env = { DB: db as unknown as D1Database } as Env;
    const idem = "test:extend:1";
    const first = await executePremiumExtendNewOrder(env, {
      sourceOrderId,
      actorUserId: "adm_1",
      periodStartAt: campEnd,
      periodEndAt: newEnd,
      priceKc: "5 990",
      idempotencyKey: idem,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(db.countChildOrders()).toBe(1);
    expect(db.invoices.length).toBe(1);
    expect(db.invoices[0].order_id).toBe(first.new_order_id);
    expect(db.campaigns.get(campaignId)?.end_at).toBe(newEnd);
    expect(docsMock).toHaveBeenCalledTimes(1);

    const live = isPremiumCampaignLiveNow({
      campaign_status: "active",
      target_url: "https://example.invalid/ad",
      start_at: campStart,
      end_at: String(db.campaigns.get(campaignId)?.end_at),
      nowIso: "2027-05-01T00:00:00.000Z",
    });
    expect(live).toBe(true);

    const second = await executePremiumExtendNewOrder(env, {
      sourceOrderId,
      actorUserId: "adm_1",
      periodStartAt: campEnd,
      periodEndAt: newEnd,
      priceKc: "5 990",
      idempotencyKey: idem,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.idempotent).toBe(true);
    expect(db.countChildOrders()).toBe(1);
    expect(db.invoices.length).toBe(1);
    expect(db.placements.get(placementId)?.active_campaign_id).toBe(campaignId);
    const child = [...db.premiumOrders.values()].find((po) => po.parent_order_id === sourceOrderId);
    expect(child?.placement_id).toBe(placementId);
    expect(child?.creative_id).toBe("crv_1");
    expect(child?.category_slug).toBe("aff-auto-moto");
    expect(child?.position).toBe(2);
  });

  it("chains second extension from updated campaign end", async () => {
    const env = { DB: db as unknown as D1Database } as Env;
    await executePremiumExtendNewOrder(env, {
      sourceOrderId,
      actorUserId: "adm_1",
      periodStartAt: campEnd,
      periodEndAt: newEnd,
      priceKc: "5990",
      idempotencyKey: "chain:1",
    });
    const nextStart = newEnd;
    const nextEnd = "2028-04-10T00:00:00.000Z";
    const second = await executePremiumExtendNewOrder(env, {
      sourceOrderId,
      actorUserId: "adm_1",
      periodStartAt: nextStart,
      periodEndAt: nextEnd,
      priceKc: "5990",
      idempotencyKey: "chain:2",
    });
    expect(second.ok).toBe(true);
    expect(db.countChildOrders()).toBe(2);
    expect(db.invoices.length).toBe(2);
    expect(db.campaigns.get(campaignId)?.end_at).toBe(nextEnd);
  });

  it("blocks when placement has pending reservation", async () => {
    db.premiumOrders.set("ord_pending", {
      order_id: "ord_pending",
      placement_id: placementId,
      workflow_status: "under_review",
    });
    const env = { DB: db as unknown as D1Database } as Env;
    const r = await executePremiumExtendNewOrder(env, {
      sourceOrderId,
      actorUserId: "adm_1",
      periodStartAt: campEnd,
      periodEndAt: newEnd,
      priceKc: "5990",
      idempotencyKey: "blocked:1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("placement_reserved");
    expect(db.countChildOrders()).toBe(0);
  });
});
