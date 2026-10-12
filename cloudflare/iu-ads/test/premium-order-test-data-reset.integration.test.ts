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
  db.prepare(
    `INSERT INTO placement_types (
       placement_type_id, name_cs, technical_type, insert_rule, anchor, devices_json, created_at, updated_at
     ) VALUES ('pt_1', 'Premium', 'banner', 'inline', 'top', '["pc"]', ?, ?)`
  ).run(NOW, NOW);
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

function seedRichPublishedOrder(db: ReturnType<typeof createIuAdsSchemaDb>, orderId: string, code: string) {
  const campId = "camp_" + orderId;
  seedOrder(db, orderId, code, campId, null);
  const clientId = "cli_" + orderId;
  sqliteSetPaid(db, orderId);
  db.prepare(
    `UPDATE premium_selected_placements SET active_campaign_id = ? WHERE placement_id = 'pl_1'`
  ).run(campId);
  db.prepare(
    `INSERT INTO placement_reservations (
       reservation_id, placement_type_id, placement_id, campaign_id, device_category,
       section_id, region_code, start_at, end_at, status, created_at
     ) VALUES (?, 'pt_1', 'pl_1', ?, 'pc', NULL, NULL, ?, ?, 'confirmed', ?)`
  ).run("res_" + orderId, campId, NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO creatives (
       creative_id, client_id, campaign_id, format, mime_type, content_hash, r2_key, created_at, updated_at
     ) VALUES (?, ?, ?, 'banner', 'image/png', 'hash', ?, ?, ?)`
  ).run("crv_" + orderId, clientId, campId, "creatives/" + orderId + ".png", NOW, NOW);
  db.prepare(`UPDATE premium_selected_orders SET creative_id = ? WHERE order_id = ?`).run("crv_" + orderId, orderId);
  db.prepare(
    `INSERT INTO document_content_revisions (
       revision_id, document_id, version, content_hash, r2_key, replacement_reason, created_at
     ) VALUES (?, ?, 2, 'h2', ?, 'test', ?)`
  ).run("rev_" + orderId, "doc_" + orderId, "docs/" + orderId + "-v2.pdf", NOW);
  db.prepare(
    `INSERT INTO invoices (
       invoice_id, client_id, order_id, invoice_number, status, total_cents, currency, created_at, updated_at, paid_at
     ) VALUES (?, ?, ?, ?, 'paid', 100000, 'CZK', ?, ?, ?)`
  ).run("inv_" + orderId, clientId, orderId, "INV-" + orderId, NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO premium_credit_notes (
       credit_note_id, order_id, invoice_id, credit_note_number, correction_cents, original_total_cents,
       new_total_cents, reason, issued_at, correction_effective_at, created_at, created_by
     ) VALUES (?, ?, ?, ?, 50000, 100000, 50000, 'test', ?, ?, ?, 'adm')`
  ).run("cn_" + orderId, orderId, "inv_" + orderId, "DOB-" + orderId, NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO premium_order_storno_records (
       storno_id, order_id, storno_number, storno_kind, reason, invoice_id, credit_note_id,
       correction_cents, created_at, created_by
     ) VALUES (?, ?, ?, 'cancellation', 'test', ?, ?, 50000, ?, 'adm')`
  ).run("sto_" + orderId, orderId, "STO-" + orderId, "inv_" + orderId, "cn_" + orderId, NOW);
  db.prepare(
    `INSERT INTO premium_order_events (event_id, order_id, event_type, payload_json, created_at)
     VALUES (?, ?, 'document_created', '{}', ?)`
  ).run("ev_" + orderId, orderId, NOW);
  const termsVersion = "v1-" + orderId;
  db.prepare(
    `INSERT INTO premium_terms_archives (archive_id, terms_version, effective_at, content_hash, r2_key, byte_size, created_at)
     VALUES (?, ?, ?, 'hash', ?, 100, ?)`
  ).run("arch_" + orderId, termsVersion, NOW, "terms/" + orderId + ".pdf", NOW);
  db.prepare(
    `INSERT INTO premium_order_terms_bindings (order_id, archive_id, terms_version, content_hash, bound_at)
     VALUES (?, ?, ?, 'hash', ?)`
  ).run(orderId, "arch_" + orderId, termsVersion, NOW);
}

function sqliteSetPaid(db: ReturnType<typeof createIuAdsSchemaDb>, orderId: string) {
  db.prepare("UPDATE premium_selected_orders SET payment_status = 'paid', paid_at = ? WHERE order_id = ?").run(NOW, orderId);
}

function countRow(db: ReturnType<typeof createIuAdsSchemaDb>, sql: string): number {
  const row = db.prepare(sql).get() as { c: number };
  return Number(row.c) || 0;
}

function expectNoPremiumOperationalRows(db: ReturnType<typeof createIuAdsSchemaDb>) {
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_selected_orders")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM orders")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM campaigns")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM documents")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM document_content_revisions")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM invoices")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_credit_notes")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_order_storno_records")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_order_events")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_order_terms_bindings")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM placement_reservations")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM creatives")).toBe(0);
  expect(countRow(db, "SELECT COUNT(*) AS c FROM premium_selected_placements WHERE active_campaign_id IS NOT NULL")).toBe(0);
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

  it("reset removes paid premium orders during dev bulk reset", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_paid", "IU-26-P", "camp_p", null);
    sqlite
      .prepare("UPDATE premium_selected_orders SET payment_status = 'paid', paid_at = ? WHERE order_id = 'ord_paid'")
      .run(NOW);

    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
      PREMIUM_DEV_OPERATIONAL_RESET_ENABLED: "1",
    } as Env;

    const stats = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats.orders_removed).toBe(1);
    const poCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number };
    expect(Number(poCount.c)).toBe(0);
  });

  it("reset is idempotent when run twice in a row", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_a", "IU-26-A", "camp_a", null);

    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
    } as Env;

    await resetAllPremiumTestOperationalData(env, "adm_test");
    seedOrder(sqlite, "ord_b", "IU-26-B", "camp_b", null);
    const stats2 = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats2.orders_removed).toBe(1);
    const poCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number };
    expect(Number(poCount.c)).toBe(0);
  });

  it("reset succeeds when premium_order_terms_bindings exist (FK)", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_tb", "IU-26-TB", null, null);
    sqlite
      .prepare(
        `INSERT INTO premium_terms_archives (archive_id, terms_version, effective_at, content_hash, r2_key, byte_size, created_at)
         VALUES ('arch_1', 'v1', ?, 'hash', 'terms/v1.pdf', 100, ?)`
      )
      .run(NOW, NOW);
    sqlite
      .prepare(
        `INSERT INTO premium_order_terms_bindings (order_id, archive_id, terms_version, content_hash, bound_at)
         VALUES ('ord_tb', 'arch_1', 'v1', 'hash', ?)`
      )
      .run(NOW);

    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: { delete: async () => undefined },
      CREATIVES: { delete: async () => undefined },
    } as Env;

    const stats = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats.orders_removed).toBe(1);
    const bindCount = sqlite.prepare("SELECT COUNT(*) AS c FROM premium_order_terms_bindings").get() as { c: number };
    expect(Number(bindCount.c)).toBe(0);
  });

  it("dev reset cycle clears paid invoice storno credit terms R2 and repeats safely", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    const r2Deleted: string[] = [];
    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: {
        delete: async (key: string) => {
          r2Deleted.push(String(key));
        },
      },
      CREATIVES: {
        delete: async (key: string) => {
          r2Deleted.push(String(key));
        },
      },
      PREMIUM_DEV_OPERATIONAL_RESET_ENABLED: "1",
    } as Env;

    seedRichPublishedOrder(sqlite, "ord_c1", "IU-C1");
    const stats1 = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats1.orders_removed).toBe(1);
    expect(r2Deleted.length).toBeGreaterThan(0);
    expectNoPremiumOperationalRows(sqlite);
    expect(countRow(sqlite, "SELECT COUNT(*) AS c FROM premium_selected_categories")).toBeGreaterThan(0);

    seedRichPublishedOrder(sqlite, "ord_c2", "IU-C2");
    const stats2 = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats2.orders_removed).toBe(1);
    expectNoPremiumOperationalRows(sqlite);

    const stats3 = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats3.orders_removed).toBe(0);
    expectNoPremiumOperationalRows(sqlite);
  });

  it("reset clears D1 operational rows even when R2 delete throws", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedRichPublishedOrder(sqlite, "ord_r2fail", "IU-R2");
    const env = {
      DB: d1FromSqlite(sqlite),
      DOCUMENTS: {
        delete: async () => {
          throw new Error("r2 unavailable");
        },
      },
      CREATIVES: {
        delete: async () => {
          throw new Error("r2 unavailable");
        },
      },
      PREMIUM_DEV_OPERATIONAL_RESET_ENABLED: "1",
    } as Env;

    const stats = await resetAllPremiumTestOperationalData(env, "adm_test");
    expect(stats.orders_removed).toBe(1);
    expectNoPremiumOperationalRows(sqlite);
    expect(countRow(sqlite, "SELECT COUNT(*) AS c FROM premium_selected_categories")).toBeGreaterThan(0);
  });
});
