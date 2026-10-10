import { beforeEach, describe, expect, it } from "vitest";
import {
  assessPremiumCampaignPublicAuthority,
  executePremiumOrderReject,
  repairPremiumPublicationConsistency,
  scanPremiumPublicationConsistency,
} from "../src/premium-publication-consistency";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class ConsistencyTestDb {
  campaigns = new Map<string, Row>();
  premiumOrders = new Map<string, Row>();
  placements = new Map<string, Row>();
  statusEvents: Row[] = [];

  prepare(sql: string) {
    const self = this;
    const bound = (...params: unknown[]) => ({
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
    });
    return {
      bind: (...params: unknown[]) => bound(...params),
      first: <T>() => bound().first<T>(),
      all: <T>() => bound().all<T>(),
      run: () => bound().run(),
    };
  }

  query(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): unknown {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("FROM campaigns WHERE campaign_id = ?") && sql.includes("order_id")) {
      const id = String(params[0]);
      const row = this.campaigns.get(id);
      return mode === "first" ? row || null : row ? [row] : [];
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      const id = String(params[0]);
      const row = this.campaigns.get(id);
      return mode === "first" ? row || null : row ? [row] : [];
    }
    if (sql.includes("FROM campaigns WHERE order_id = ?")) {
      const orderId = String(params[0]);
      const rows = [...this.campaigns.values()].filter(
        (c) => c.order_id === orderId && ["active", "scheduled", "paused"].includes(String(c.status))
      );
      return mode === "first" ? rows[0] || null : rows;
    }
    if (sql.includes("FROM premium_selected_orders WHERE published_campaign_id = ?")) {
      const campId = String(params[0]);
      const rows = [...this.premiumOrders.values()].filter((o) => o.published_campaign_id === campId);
      return mode === "first" ? rows[0] || null : rows;
    }
    if (sql.includes("FROM premium_selected_orders WHERE order_id = ?")) {
      const id = String(params[0]);
      const row = this.premiumOrders.get(id);
      return mode === "first" ? row || null : row ? [row] : [];
    }
    if (sql.includes("FROM premium_selected_placements WHERE placement_id = ?")) {
      const id = String(params[0]);
      const row = this.placements.get(id);
      return mode === "first" ? row || null : row ? [row] : [];
    }
    if (sql.includes("FROM premium_selected_placements WHERE active_campaign_id IS NOT NULL")) {
      const rows = [...this.placements.values()].filter((p) => p.active_campaign_id);
      return mode === "first" ? rows[0] || null : rows;
    }
    if (sql.startsWith("UPDATE campaigns SET status")) {
      const [nowIso, campaignId] = params;
      const row = this.campaigns.get(String(campaignId));
      if (row && ["active", "scheduled", "paused"].includes(String(row.status))) {
        row.status = "cancelled";
        row.updated_at = nowIso;
      }
      return mode === "run" ? undefined : null;
    }
    if (sql.includes("UPDATE premium_selected_placements SET active_campaign_id = NULL")) {
      const [nowIso, placementId, campaignId] = params;
      const row = this.placements.get(String(placementId));
      if (row && row.active_campaign_id === campaignId) {
        row.active_campaign_id = null;
        row.updated_at = nowIso;
      }
      return mode === "run" ? undefined : null;
    }
    if (sql.includes("UPDATE premium_selected_orders SET workflow_status = 'rejected'")) {
      const [reason, nowIso, orderId] = params;
      const row = this.premiumOrders.get(String(orderId));
      if (row) {
        row.workflow_status = "rejected";
        row.rejection_reason = reason;
        row.updated_at = nowIso;
      }
      return mode === "run" ? undefined : null;
    }
    if (sql.includes("INSERT INTO campaign_status_events")) {
      this.statusEvents.push({ campaign_id: params[1], reason: params[5] });
      return mode === "run" ? undefined : null;
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return mode === "run" ? undefined : null;
    }
    if (sql.includes("INSERT INTO premium_order_events")) {
      return mode === "run" ? undefined : null;
    }
    return mode === "first" ? null : [];
  }
}

function seedLiveCampaign(db: ConsistencyTestDb, campaignId: string, orderId: string) {
  const now = new Date();
  const end = new Date(now.getTime() + 86400000 * 30).toISOString();
  const start = new Date(now.getTime() - 86400000).toISOString();
  db.campaigns.set(campaignId, {
    campaign_id: campaignId,
    order_id: orderId,
    status: "active",
    start_at: start,
    end_at: end,
    target_url: "https://example.test/",
  });
}

describe("premium publication consistency", () => {
  let db: ConsistencyTestDb;
  let env: Env;

  beforeEach(() => {
    db = new ConsistencyTestDb();
    env = { DB: db as unknown as D1Database } as Env;
  });

  it("authorizes only published orders with live campaigns", async () => {
    seedLiveCampaign(db, "cmp_ok", "ord_ok");
    db.premiumOrders.set("ord_ok", {
      order_id: "ord_ok",
      workflow_status: "published",
      published_campaign_id: "cmp_ok",
      placement_id: "pl_1",
    });
    const auth = await assessPremiumCampaignPublicAuthority(db as unknown as D1Database, "cmp_ok", new Date().toISOString());
    expect(auth.authorized).toBe(true);
    expect(auth.reason_code).toBe("ok");
  });

  it("rejects public authority when governing order is rejected", async () => {
    seedLiveCampaign(db, "cmp_bad", "ord_bad");
    db.premiumOrders.set("ord_bad", {
      order_id: "ord_bad",
      workflow_status: "rejected",
      published_campaign_id: "cmp_bad",
      placement_id: "pl_1",
    });
    const auth = await assessPremiumCampaignPublicAuthority(db as unknown as D1Database, "cmp_bad", new Date().toISOString());
    expect(auth.authorized).toBe(false);
    expect(auth.reason_code).toBe("linked_order_rejected");
  });

  it("blocks reject on published workflow", async () => {
    db.premiumOrders.set("ord_pub", {
      order_id: "ord_pub",
      placement_id: "pl_ck_p1",
      workflow_status: "published",
      published_campaign_id: "cmp_iaf",
    });
    const blocked = await executePremiumOrderReject(env, {
      orderId: "ord_pub",
      actorUserId: "admin_test",
      reason: "x",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("cannot_reject_published");
  });

  it("reject unpublishes active campaign and clears placement", async () => {
    seedLiveCampaign(db, "cmp_iaf", "ord_iaf");
    db.placements.set("pl_ck_p1", {
      placement_id: "pl_ck_p1",
      category_slug: "aff-cestovni-kancelare",
      active_campaign_id: "cmp_iaf",
    });
    db.premiumOrders.set("ord_iaf", {
      order_id: "ord_iaf",
      placement_id: "pl_ck_p1",
      workflow_status: "under_review",
      published_campaign_id: "cmp_iaf",
    });

    const result = await executePremiumOrderReject(env, {
      orderId: "ord_iaf",
      actorUserId: "admin_test",
      reason: "test_reject",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unpublished_campaign_ids).toContain("cmp_iaf");
    expect(db.premiumOrders.get("ord_iaf")?.workflow_status).toBe("rejected");
    expect(db.placements.get("pl_ck_p1")?.active_campaign_id).toBeNull();
    expect(db.campaigns.get("cmp_iaf")?.status).toBe("cancelled");
  });

  it("reject is idempotent when order already rejected", async () => {
    db.premiumOrders.set("ord_x", {
      order_id: "ord_x",
      placement_id: "pl_x",
      workflow_status: "rejected",
      published_campaign_id: null,
    });
    const result = await executePremiumOrderReject(env, {
      orderId: "ord_x",
      actorUserId: "admin_test",
      reason: "again",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idempotent).toBe(true);
  });

  it("maintenance repair clears unauthorized placement lock", async () => {
    seedLiveCampaign(db, "cmp_orphan", "ord_orphan");
    db.placements.set("pl_ck_p1", {
      placement_id: "pl_ck_p1",
      category_slug: "aff-cestovni-kancelare",
      active_campaign_id: "cmp_orphan",
    });
    db.premiumOrders.set("ord_orphan", {
      order_id: "ord_orphan",
      workflow_status: "rejected",
      published_campaign_id: "cmp_orphan",
      placement_id: "pl_ck_p1",
    });

    const scan = await scanPremiumPublicationConsistency(db as unknown as D1Database, new Date().toISOString());
    expect(scan.ok).toBe(false);
    expect(scan.issues[0]?.reason_code).toBe("linked_order_rejected");

    const repair = await repairPremiumPublicationConsistency(env, { actorUserId: "system:test" });
    expect(repair.repaired).toBe(1);
    expect(db.placements.get("pl_ck_p1")?.active_campaign_id).toBeNull();
  });
});
