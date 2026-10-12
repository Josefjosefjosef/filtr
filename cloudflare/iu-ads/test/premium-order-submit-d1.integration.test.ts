import { describe, expect, it } from "vitest";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

const placementId = premiumPlacementId("aff-zdravi-doplnky", 1);

function makeEnv(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    ADS_CODE_PEPPER: "test-pepper-min-16-chars",
  } as Env;
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    placement_id: placementId,
    company_name: "Podnikatel s.r.o.",
    contact_name: "Jan Novák",
    email: "jan@example.test",
    phone: "+420 777 123 456",
    target_url: "https://example.test/landing",
    creative_mode: "logo",
    billing_street: "Ulice 1",
    billing_city: "Praha",
    billing_zip: "11000",
    billing_country: "Česká republika",
    terms_version: PREMIUM_TERMS_VERSION,
    terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
    b2b_only: true,
    authorization_confirmed: true,
    ordering_person_name: "Marie Objednávková",
    ico: "27074358",
    ...overrides,
  };
}

function post(body: Record<string, unknown>) {
  return new Request("https://ads.test/v1/public/premium/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("premium order submit — D1 integration (B2 freeze)", () => {
  it("creates submitted order with authoritative catalog price despite client tampering", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const res = await handlePublicPremiumOrderSubmit(post(orderBody({ price_cents: 100 })), env);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { order_id: string; price_cents: number; placement_id: string };
    expect(json.placement_id).toBe(placementId);
    expect(json.price_cents).toBe(599000);

    const row = sqlite
      .prepare(
        "SELECT workflow_status, placement_id, position, category_slug FROM premium_selected_orders WHERE order_id = ?"
      )
      .get(json.order_id) as {
      workflow_status: string;
      placement_id: string;
      position: number;
      category_slug: string;
    };
    expect(row.workflow_status).toBe("submitted");
    expect(row.placement_id).toBe(placementId);
    expect(row.position).toBe(1);
    expect(row.category_slug).toBe("aff-zdravi-doplnky");
  });

  it("blocks second order on same P1 while first is submitted (placement_reserved)", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const first = await handlePublicPremiumOrderSubmit(post(orderBody({ email: "a@example.test" })), env);
    expect(first.status).toBe(201);
    const second = await handlePublicPremiumOrderSubmit(post(orderBody({ email: "b@example.test", ico: "27074358" })), env);
    expect(second.status).toBe(409);
    const err = (await second.json()) as { error: string };
    expect(err.error).toBe("placement_reserved");

    const count = sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE placement_id = ? AND workflow_status IN ('submitted','under_review')"
      )
      .get(placementId) as { c: number };
    expect(Number(count.c)).toBe(1);
  });

  it("parallel submit attempts yield at most one success on exclusive placement", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const bodies = [
      orderBody({ email: "p1@example.test" }),
      orderBody({ email: "p2@example.test" }),
      orderBody({ email: "p3@example.test" }),
    ];
    const results = await Promise.all(
      bodies.map((body) => handlePublicPremiumOrderSubmit(post(body), env))
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(2);

    const count = sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM premium_selected_orders WHERE placement_id = ? AND workflow_status IN ('submitted','under_review')"
      )
      .get(placementId) as { c: number };
    expect(Number(count.c)).toBe(1);

    const orderCount = sqlite.prepare("SELECT COUNT(*) AS c FROM orders").get() as { c: number };
    expect(Number(orderCount.c)).toBe(1);
  });

  it("rejects order when placement has active live campaign", async () => {
    const sqlite = createIuAdsSchemaDb();
    const now = new Date().toISOString();
    const campId = "camp_live_test";
    sqlite
      .prepare(
        `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at)
         VALUES ('cli_x', 'X', '{}', ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO campaigns (campaign_id, evidence_code, client_id, order_id, title, status, label_type, target_url, start_at, end_at, created_at, updated_at)
         VALUES (?, 'EV-X', 'cli_x', 'ord_x', 'T', 'active', 'Reklama', 'https://example.test/', ?, ?, ?, ?)`
      )
      .run(campId, "2020-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z", now, now);
    sqlite
      .prepare("UPDATE premium_selected_placements SET active_campaign_id = ? WHERE placement_id = ?")
      .run(campId, placementId);

    const env = makeEnv(sqlite);
    const res = await handlePublicPremiumOrderSubmit(post(orderBody()), env);
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: string };
    expect(["placement_occupied", "placement_unavailable"]).toContain(err.error);
  });
});
