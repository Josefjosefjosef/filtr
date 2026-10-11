import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import { resetAllPremiumTestOperationalData, sortPremiumOrdersForPurge } from "../src/premium-order-test-data-reset";
import type { Env } from "../src/types";

const NOW = "2026-03-01T12:00:00.000Z";

function seedMinimalCatalog(db: ReturnType<typeof createIuAdsSchemaDb>) {
  db.prepare(
    `INSERT INTO premium_selected_categories (category_slug, premium_capacity, updated_at) VALUES ('travel', 8, ?)`
  ).run(NOW);
  db.prepare(
    `INSERT INTO premium_selected_placements (placement_id, category_slug, position, current_price_cents, currency, updated_at)
     VALUES ('pl_1', 'travel', 1, 100000, 'CZK', ?)`
  ).run(NOW);
}

function seedOrder(
  db: ReturnType<typeof createIuAdsSchemaDb>,
  orderId: string,
  code: string,
  campId: string | null,
  parent: string | null
) {
  const clientId = "cli_" + orderId;
  db.prepare(
    `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at) VALUES (?, 'Test Co', '{}', ?, ?)`
  ).run(clientId, NOW, NOW);
  db.prepare(
    `INSERT INTO orders (order_id, client_id, order_number, status, customer_order_code, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`
  ).run(orderId, clientId, "ON-" + orderId, code, NOW, NOW);
  if (campId) {
    db.prepare(
      `INSERT INTO campaigns (campaign_id, evidence_code, client_id, order_id, title, status, label_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'T', 'active', 'Reklama', ?, ?)`
    ).run(campId, "EV-" + orderId, clientId, orderId, NOW, NOW);
    db.prepare(
      `INSERT INTO campaign_status_events (event_id, campaign_id, to_status, created_at) VALUES (?, ?, 'active', ?)`
    ).run("cse_" + orderId, campId, NOW);
  }
  db.prepare(
    `INSERT INTO premium_selected_orders (
       order_id, placement_id, category_slug, position, workflow_status, published_campaign_id,
       order_token_hash, payment_status, parent_order_id, created_at, updated_at
     ) VALUES (?, 'pl_1', 'travel', 1, 'published', ?, 'hash', 'unpaid', ?, ?, ?)`
  ).run(orderId, campId, parent, NOW, NOW);
  db.prepare(
    `INSERT INTO documents (document_id, client_id, order_id, doc_type, title, version, content_hash, r2_key, created_at, updated_at)
     VALUES (?, ?, ?, 'premium_order_confirmation', 'Doc', 1, 'h', ?, ?, ?)`
  ).run("doc_" + orderId, clientId, orderId, "docs/" + orderId + ".pdf", NOW, NOW);
}

describe("premium test data reset", () => {
  it("sortPremiumOrdersForPurge deletes children before parents", () => {
    const sorted = sortPremiumOrdersForPurge([
      { order_id: "parent", parent_order_id: null },
      { order_id: "child", parent_order_id: "parent" },
    ]);
    expect(sorted.indexOf("child")).toBeLessThan(sorted.indexOf("parent"));
  });

  it("resetAllPremiumTestOperationalData clears orders and campaigns but keeps catalog", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_1", "IU-26-A", "camp_1", null);
    seedOrder(sqlite, "ord_2", "IU-26-B", "camp_2", null);

    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
    } as Env;

    const stats = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats.orders_removed).toBe(2);
    expect(stats.campaigns_removed).toBeGreaterThanOrEqual(2);

    const poCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number };
    const campCount = sqlite.prepare("SELECT COUNT(*) AS c FROM campaigns").get() as { c: number };
    const catCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_categories").get() as { c: number };
    const plCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_placements").get() as { c: number };
    expect(Number(poCount.c)).toBe(0);
    expect(Number(campCount.c)).toBe(0);
    expect(Number(catCount.c)).toBeGreaterThan(0);
    expect(Number(plCount.c)).toBeGreaterThan(0);
    const activePl = sqlite
      .prepare("SELECT COUNT(*) AS c FROM premium_selected_placements WHERE active_campaign_id IS NOT NULL")
      .get() as { c: number };
    expect(Number(activePl.c)).toBe(0);
  });
});
