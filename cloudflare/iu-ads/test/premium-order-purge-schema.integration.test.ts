import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import { deleteExclusiveCampaignForPurge, purgePremiumOrderPhysically } from "../src/premium-order-purge";
import type { Env } from "../src/types";

const NOW = "2026-03-01T12:00:00.000Z";

function seedPublishedPremiumOrder(db: ReturnType<typeof createIuAdsSchemaDb>) {
  db.prepare(
    `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at)
     VALUES ('cli_res', 'RESISTANCE s.r.o.', '{}', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO orders (order_id, client_id, order_number, status, customer_order_code, created_at, updated_at)
     VALUES ('ord_u8b2', 'cli_res', 'ON-U8B2', 'active', 'IU-26-DGRF-U8B2', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO premium_selected_categories (category_slug, premium_capacity, updated_at)
     VALUES ('travel_agencies', 8, ?)`
  ).run(NOW);
  db.prepare(
    `INSERT INTO premium_selected_placements (placement_id, category_slug, position, current_price_cents, currency, updated_at)
     VALUES ('pl_p2', 'travel_agencies', 2, 500000, 'CZK', ?)`
  ).run(NOW);
  db.prepare(
    `INSERT INTO premium_selected_orders (
       order_id, placement_id, category_slug, position, workflow_status, target_url,
       creative_id, published_campaign_id, order_token_hash, payment_status, created_at, updated_at
     ) VALUES ('ord_u8b2', 'pl_p2', 'travel_agencies', 2, 'published', 'https://example.test/',
       'cr_1', 'camp_1', 'hash', 'unpaid', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO campaigns (campaign_id, evidence_code, client_id, order_id, title, status, label_type, created_at, updated_at)
     VALUES ('camp_1', 'EV-U8B2', 'cli_res', 'ord_u8b2', 'Premium P2', 'active', 'Reklama', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO campaign_status_events (event_id, campaign_id, from_status, to_status, created_at)
     VALUES ('cse_1', 'camp_1', NULL, 'active', ?)`
  ).run(NOW);
  db.prepare(
    `INSERT INTO campaign_placements (campaign_placement_id, campaign_id, placement_id, placement_type_id, device_category, status, created_at, updated_at)
     VALUES ('cp_1', 'camp_1', 'pl_p2', 'pt_premium_selected_services', 'pc', 'active', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO placement_reservations (reservation_id, placement_type_id, placement_id, campaign_id, device_category, start_at, end_at, status, created_at)
     VALUES ('res_1', 'pt_premium_selected_services', 'pl_p2', 'camp_1', 'pc', ?, ?, 'reserved', ?)`
  ).run(NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO creatives (creative_id, client_id, campaign_id, format, mime_type, content_hash, r2_key, review_status, device_category, created_at, updated_at)
     VALUES ('cr_1', 'cli_res', 'camp_1', 'logo', 'image/png', 'abc', 'creatives/cr_1.png', 'approved', 'pc', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO invoices (invoice_id, client_id, order_id, campaign_id, invoice_number, status, total_cents, created_at, updated_at)
     VALUES ('inv_1', 'cli_res', 'ord_u8b2', 'camp_1', 'FV2026001', 'issued', 500000, ?, ?)`
  ).run(NOW, NOW);
  for (let i = 0; i < 4; i++) {
    const docId = `doc_${i}`;
    db.prepare(
      `INSERT INTO documents (document_id, client_id, campaign_id, order_id, doc_type, title, version, content_hash, r2_key, created_at, updated_at)
       VALUES (?, 'cli_res', 'camp_1', 'ord_u8b2', ?, ?, 1, 'h', ?, ?, ?)`
    ).run(docId, `premium_kind_${i}`, `Doc ${i}`, `docs/${docId}.pdf`, NOW, NOW);
    db.prepare(
      `INSERT INTO document_content_revisions (revision_id, document_id, version, content_hash, r2_key, replacement_reason, created_at)
       VALUES (?, ?, 1, 'h', ?, 'seed', ?)`
    ).run(`rev_${i}`, docId, `docs/${docId}-v1.pdf`, NOW);
  }
  db.prepare(
    `INSERT INTO premium_order_document_jobs (job_id, order_id, doc_kind, status, idempotency_key, created_at, updated_at)
     VALUES ('job_1', 'ord_u8b2', 'order_confirmation', 'ready', 'idem_1', ?, ?)`
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO premium_order_storno_records (storno_id, order_id, storno_number, storno_kind, invoice_id, created_at)
     VALUES ('sto_1', 'ord_u8b2', 'STORNO-1', 'rejection', 'inv_1', ?)`
  ).run(NOW);
  db.prepare(
    `INSERT INTO premium_publish_events (event_id, order_id, idempotency_key, result_json, created_at)
     VALUES ('pe_1', 'ord_u8b2', 'pub_idem', '{}', ?)`
  ).run(NOW);
}

function countSql(db: ReturnType<typeof createIuAdsSchemaDb>, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return Number(row?.c) || 0;
}

describe("premium purge on production D1 schema (migrations)", () => {
  it("reproduces pre-fix failure: wrong table name campaign_state_events", () => {
    const db = createIuAdsSchemaDb();
    expect(() => db.prepare("DELETE FROM campaign_state_events WHERE campaign_id = ?").run("camp_1")).toThrow(
      /no such table: campaign_state_events/
    );
  });

  it("deleteExclusiveCampaignForPurge removes campaign_status_events and campaign row", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedPublishedPremiumOrder(sqlite);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM campaign_status_events WHERE campaign_id = ?", "camp_1")).toBe(1);

    const env = {
      DB: d1FromSqlite(sqlite),
      CREATIVES: { delete: async () => undefined },
    } as Env;

    await deleteExclusiveCampaignForPurge(env, "camp_1", "ord_u8b2");

    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM campaigns WHERE campaign_id = ?", "camp_1")).toBe(0);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM campaign_status_events WHERE campaign_id = ?", "camp_1")).toBe(0);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM creatives WHERE campaign_id = ?", "camp_1")).toBe(0);
  });

  it("purgePremiumOrderPhysically clears order graph; retry-safe after partial campaign step", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedPublishedPremiumOrder(sqlite);
    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
    } as Env;

    const first = await purgePremiumOrderPhysically(env, "ord_u8b2");
    expect(first.documents_removed).toBe(4);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM documents WHERE order_id = ?", "ord_u8b2")).toBe(0);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?", "ord_u8b2")).toBe(0);
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE order_id = ?", "ord_u8b2")).toBe(1);

    await deleteExclusiveCampaignForPurge(env, "camp_1", "ord_u8b2");
    expect(countSql(sqlite, "SELECT COUNT(*) AS c FROM campaigns WHERE campaign_id = ?", "camp_1")).toBe(0);

    const second = await purgePremiumOrderPhysically(env, "ord_u8b2");
    expect(second.documents_removed).toBe(0);
  });
});
