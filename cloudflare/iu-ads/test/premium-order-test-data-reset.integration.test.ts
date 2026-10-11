import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import {
  buildPremiumTestDataResetPreview,
  resetAllPremiumTestOperationalData,
  sortPremiumOrdersForPurge,
} from "../src/premium-order-test-data-reset";
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

function seedTermsArchive(db: ReturnType<typeof createIuAdsSchemaDb>, orderId: string) {
  const archiveId = "arch_" + orderId;
  const version = "v_" + orderId;
  db.prepare(
    `INSERT INTO premium_terms_archives (archive_id, terms_version, effective_at, content_hash, r2_key, byte_size, created_at)
     VALUES (?, ?, ?, 'hash', ?, 100, ?)`
  ).run(archiveId, version, NOW, "terms/" + orderId + ".pdf", NOW);
  db.prepare(
    `INSERT INTO premium_order_terms_bindings (order_id, archive_id, terms_version, content_hash, bound_at)
     VALUES (?, ?, ?, 'hash', ?)`
  ).run(orderId, archiveId, version, NOW);
}

function seedOrder(
  db: ReturnType<typeof createIuAdsSchemaDb>,
  orderId: string,
  code: string,
  campId: string | null,
  parent: string | null,
  opts?: { company?: string; marked?: boolean }
) {
  const company = opts?.company ?? (opts?.marked === false ? "Reálná firma s.r.o." : "IU_TEST s.r.o.");
  const clientId = "cli_" + orderId;
  db.prepare(
    `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at) VALUES (?, ?, '{}', ?, ?)`
  ).run(clientId, company, NOW, NOW);
  db.prepare(
    `INSERT INTO orders (order_id, client_id, order_number, status, customer_order_code, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(
    orderId,
    clientId,
    "ON-" + orderId,
    code,
    opts?.marked === false ? "{}" : JSON.stringify({ iu_dev_test: true }),
    NOW,
    NOW
  );
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
  seedTermsArchive(db, orderId);
}

function makeEnv(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    DOCUMENTS: { delete: async () => undefined },
    CREATIVES: { delete: async () => undefined },
  } as Env;
}

describe("premium test data reset", () => {
  it("sortPremiumOrdersForPurge deletes children before parents", () => {
    const sorted = sortPremiumOrdersForPurge([
      { order_id: "parent", parent_order_id: null },
      { order_id: "child", parent_order_id: "parent" },
    ]);
    expect(sorted.indexOf("child")).toBeLessThan(sorted.indexOf("parent"));
  });

  it("cycle 1–2: repeatable reset with terms bindings (production schema)", async () => {
    for (let cycle = 1; cycle <= 2; cycle++) {
      const sqlite = createIuAdsSchemaDb();
      seedMinimalCatalog(sqlite);
      seedOrder(sqlite, "ord_1", "IU-TEST-A", "camp_1", null);
      seedOrder(sqlite, "ord_2", "IU-TEST-B", "camp_2", null);
      const env = makeEnv(sqlite);
      const stats = await resetAllPremiumTestOperationalData(env, "adm_test", "ptr_c" + String(cycle));
      expect(stats.stats.orders_removed).toBe(2);
      expect(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM premium_order_terms_bindings").get() as { c: number }).c)).toBe(0);
      expect(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number }).c)).toBe(0);
    }
  });

  it("cycle 3: empty eligible set returns nothing_to_remove", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_prod", "IU-26-REAL", "camp_x", null, { marked: false, company: "Skutečný klient s.r.o." });
    const env = makeEnv(sqlite);
    const preview = await buildPremiumTestDataResetPreview(env);
    expect(preview.eligible_orders).toBe(0);
    expect(preview.skipped_not_marked).toBe(1);
    const result = await resetAllPremiumTestOperationalData(env, "adm_test", "ptr_empty");
    expect(result.nothing_to_remove).toBe(true);
    expect(result.stats.orders_removed).toBe(0);
    expect(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number }).c)).toBe(1);
  });

  it("cycle 4: retry after partial purge (terms FK) succeeds once bindings are cleared", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_u8", "IU-TEST-U8", "camp_u8", null);
    const env = makeEnv(sqlite);
    await resetAllPremiumTestOperationalData(env, "adm_test", "ptr_retry1");
    expect(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_orders").get() as { c: number }).c)).toBe(0);
    seedOrder(sqlite, "ord_u9", "IU-TEST-U9", "camp_u9", null);
    const result = await resetAllPremiumTestOperationalData(env, "adm_test", "ptr_retry2");
    expect(result.nothing_to_remove).toBe(false);
    expect(result.stats.orders_removed).toBe(1);
  });

  it("skips paid marked orders and keeps catalog", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMinimalCatalog(sqlite);
    seedOrder(sqlite, "ord_paid", "IU-TEST-P", "camp_p", null);
    sqlite
      .prepare("UPDATE premium_selected_orders SET payment_status = 'paid', paid_at = ? WHERE order_id = 'ord_paid'")
      .run(NOW);
    const env = makeEnv(sqlite);
    const preview = await buildPremiumTestDataResetPreview(env);
    expect(preview.eligible_orders).toBe(0);
    expect(preview.skipped_paid_accounting).toBe(1);
    const result = await resetAllPremiumTestOperationalData(env, "adm_test", "ptr_paid");
    expect(result.nothing_to_remove).toBe(true);
    expect(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM premium_selected_categories").get() as { c: number }).c)).toBeGreaterThan(0);
  });
});
