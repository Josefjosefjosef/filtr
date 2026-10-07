import { beforeEach, describe, expect, it } from "vitest";
import { executePremiumApproveAndPublish } from "../src/premium-publish";
import {
  countPendingPremiumOrders,
  formatAdminPragueDateTime,
  isPremiumOrderPendingStatus,
  premiumWorkflowStatusLabelCs,
  serializePremiumOrderAdminListRow,
} from "../src/premium-order-workflow";
import {
  PREMIUM_AFFILIATE_CATEGORY_SLUGS,
  premiumPlacementId,
  resolveAuthoritativePriceCents,
} from "../src/premium-selected-services";
import type { Env } from "../src/types";

describe("premium admin workflow presentation", () => {
  it("labels pending and published states in Czech", () => {
    expect(premiumWorkflowStatusLabelCs("submitted", { creative_id: null, target_url: "https://x.test/" })).toBe(
      "Čeká na nahrání kreativy"
    );
    expect(premiumWorkflowStatusLabelCs("under_review", { creative_id: "crv_x", target_url: "https://x.test/" })).toBe(
      "Čeká na posouzení"
    );
    expect(premiumWorkflowStatusLabelCs("published")).toBe("Schváleno a zveřejněno");
    expect(isPremiumOrderPendingStatus("submitted")).toBe(true);
    expect(isPremiumOrderPendingStatus("published")).toBe(false);
  });

  it("formats admin timestamps in Europe/Prague", () => {
    const label = formatAdminPragueDateTime("2026-10-06T20:48:00.000Z");
    expect(label).toMatch(/6\.?\s*10\.?\s*2026/);
    expect(label).toMatch(/22:48|23:48/);
  });

  it("serializes human-readable list rows without technical ids as primary fields", () => {
    const row = serializePremiumOrderAdminListRow({
      order_id: "ord_test",
      client_id: "cli_test",
      company_name: "ABC s.r.o.",
      ico: "27074358",
      category_slug: "aff-auto-moto",
      position: 1,
      workflow_status: "submitted",
      created_at: "2026-10-06T20:48:00.000Z",
      payload_json: JSON.stringify({ agreed_price_cents: 599000 }),
      target_url: "https://example.test/",
      creative_mode: "image_large",
    });
    expect(row.company_name).toBe("ABC s.r.o.");
    expect(row.ico).toBe("27074358");
    expect(row.category_title_cs).toContain("Auto");
    expect(row.position_label).toBe("P1");
    expect(row.workflow_status_label_cs).toBe("Čeká na nahrání kreativy");
    expect(row.publishable).toBe(false);
    expect(row.missing_publish_fields).toContain("creative");
    expect(row.price_label_cs).toContain("990");
    expect(row.pending_review).toBe(true);
  });
});

describe("premium catalog coverage (authoritative registry)", () => {
  it("covers all affiliate categories × P1–P8 pricing", () => {
    expect(PREMIUM_AFFILIATE_CATEGORY_SLUGS.length).toBeGreaterThan(20);
    for (const slug of PREMIUM_AFFILIATE_CATEGORY_SLUGS) {
      for (let pos = 1; pos <= 8; pos++) {
        const id = premiumPlacementId(slug, pos as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
        const cents = resolveAuthoritativePriceCents(id, pos as 1, null, null);
        expect(cents).toBeGreaterThan(0);
      }
    }
  });
});

type Row = Record<string, unknown>;

class PremiumPublishTestDb {
  premiumOrders = new Map<string, Row>();
  orders = new Map<string, Row>();
  creatives = new Map<string, Row>();
  placements = new Map<string, Row>();
  publishEvents = new Map<string, string>();
  campaigns = new Map<string, Row>();
  invoices: Row[] = [];
  campaignPlacements: Row[] = [];

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
    if (sql.includes("FROM premium_publish_events WHERE idempotency_key")) {
      const key = String(params[0]);
      const hit = this.publishEvents.get(key);
      return mode === "first" ? (hit ? { result_json: hit } : null) : [];
    }
    if (sql.includes("FROM premium_selected_orders WHERE order_id = ?") && sql.includes("workflow_status")) {
      const id = String(params[0]);
      return this.premiumOrders.get(id) || null;
    }
    if (sql.includes("FROM creatives WHERE creative_id = ?")) {
      return this.creatives.get(String(params[0])) || null;
    }
    if (sql.includes("FROM orders WHERE order_id = ?") && sql.includes("payload_json")) {
      return this.orders.get(String(params[0])) || null;
    }
    if (sql.includes("FROM orders WHERE order_id = ?")) {
      return this.orders.get(String(params[0])) || null;
    }
    if (sql.includes("FROM premium_selected_placements WHERE placement_id = ?") && sql.includes("current_price_cents")) {
      return this.placements.get(String(params[0])) || null;
    }
    if (sql.includes("FROM premium_selected_placements p") && sql.includes("active_campaign_id")) {
      const pid = String(params[0]);
      const p = this.placements.get(pid);
      if (!p) return null;
      const campId = p.active_campaign_id;
      const camp = campId ? this.campaigns.get(String(campId)) : null;
      return {
        active_campaign_id: campId ?? null,
        status: camp?.status ?? null,
        end_at: camp?.end_at ?? null,
      };
    }
    if (sql.includes("UPDATE premium_selected_orders SET workflow_status = 'published'")) {
      const [campaignId, publishedAt, idem, updatedAt, orderId] = params;
      const po = this.premiumOrders.get(String(orderId));
      if (po) {
        po.workflow_status = "published";
        po.published_campaign_id = campaignId;
        po.published_at = publishedAt;
        po.publish_idempotency_key = idem;
        po.updated_at = updatedAt;
      }
      return mode === "run" ? { success: true } : null;
    }
    if (sql.includes("INSERT INTO premium_publish_events")) {
      const [, orderId, key, resultJson] = params;
      this.publishEvents.set(String(key), String(resultJson));
      void orderId;
      return mode === "run" ? { success: true } : null;
    }
    if (sql.includes("INSERT INTO campaigns")) {
      const campaignId = params[0];
      this.campaigns.set(String(campaignId), {
        campaign_id: campaignId,
        status: params[6],
        target_url: params[11],
        end_at: params[8],
      });
      return mode === "run" ? { success: true } : null;
    }
    if (sql.includes("UPDATE premium_selected_placements SET active_campaign_id")) {
      const [campaignId, , placementId] = params;
      const p = this.placements.get(String(placementId));
      if (p && (!p.active_campaign_id || p.active_campaign_id === campaignId)) {
        p.active_campaign_id = campaignId;
        return mode === "run" ? { success: true, meta: { changes: 1 } } : null;
      }
      return mode === "run" ? { success: true, meta: { changes: 0 } } : null;
    }
    if (sql.startsWith("INSERT INTO")) return mode === "run" ? { success: true } : null;
    if (sql.startsWith("UPDATE")) return mode === "run" ? { success: true } : null;
    if (sql.includes("COUNT(*) AS cnt FROM premium_selected_orders")) {
      let n = 0;
      for (const po of this.premiumOrders.values()) {
        if (po.workflow_status === "submitted" || po.workflow_status === "under_review") n++;
      }
      return mode === "first" ? { cnt: n } : [];
    }
    if (mode === "all") return [];
    if (mode === "run") return { success: true };
    return null;
  }
}

describe("premium approve and publish lifecycle", () => {
  let db: PremiumPublishTestDb;
  const orderId = "ord_pub1";
  const placementId = premiumPlacementId("aff-auto-moto", 3);

  beforeEach(() => {
    db = new PremiumPublishTestDb();
    db.placements.set(placementId, {
      placement_id: placementId,
      current_price_cents: 539000,
      currency: "CZK",
      active_campaign_id: null,
    });
    db.orders.set(orderId, {
      order_id: orderId,
      client_id: "cli_1",
      order_number: "PO-TEST",
      payload_json: JSON.stringify({
        agreed_price_cents: 539000,
        category_slug: "aff-auto-moto",
        position: 3,
        creative_mode: "image_large",
      }),
    });
    db.premiumOrders.set(orderId, {
      order_id: orderId,
      placement_id: placementId,
      category_slug: "aff-auto-moto",
      position: 3,
      workflow_status: "under_review",
      target_url: "https://example.test/premium",
      creative_id: "crv_1",
      creative_mode: "image_large",
      published_campaign_id: null,
      client_contact_email: "buyer@example.test",
    });
    db.creatives.set("crv_1", {
      creative_id: "crv_1",
      client_id: "cli_1",
      review_status: "pending",
      content_hash: "abc",
      format: "image",
      campaign_id: null,
      r2_key: "k/crv.png",
    });
  });

  it("publishes once and returns idempotent replay for same key", async () => {
    const env = { DB: db as unknown as D1Database, ADS_CODE_PEPPER: "test-pepper-min-16-chars" } as Env;
    const first = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_1",
      idempotencyKey: "test:idem:1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.already).toBe(false);
    const po = db.premiumOrders.get(orderId);
    expect(po?.workflow_status).toBe("published");
    expect(po?.published_at).toBeTruthy();
    expect(po?.position).toBe(3);
    expect(po?.creative_mode).toBe("image_large");

    const second = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_1",
      idempotencyKey: "test:idem:1",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.already).toBe(true);
    expect(db.campaigns.size).toBe(1);
  });

  it("rejects second publish with different idempotency key after published", async () => {
    const env = { DB: db as unknown as D1Database, ADS_CODE_PEPPER: "test-pepper-min-16-chars" } as Env;
    await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_1",
      idempotencyKey: "test:idem:a",
    });
    const dup = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_1",
      idempotencyKey: "test:idem:b",
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toBe("already_published");
    expect(db.campaigns.size).toBe(1);
  });

  it("counts only submitted/under_review as pending", async () => {
    db.premiumOrders.set("ord_p2", {
      order_id: "ord_p2",
      workflow_status: "submitted",
    });
    db.premiumOrders.set("ord_p3", {
      order_id: "ord_p3",
      workflow_status: "published",
    });
    const n = await countPendingPremiumOrders(db as unknown as D1Database);
    expect(n).toBe(2);
  });
});
