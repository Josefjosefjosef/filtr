import { describe, expect, it } from "vitest";
import { executePremiumApproveAndPublish } from "../src/premium-publish";
import { executePremiumOrderReject } from "../src/premium-publication-consistency";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import type { Env } from "../src/types";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

const placementId = premiumPlacementId("aff-zdravi-doplnky", 1);
const NOW = "2026-06-15T10:00:00.000Z";

function makeEnv(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    ADS_CODE_PEPPER: "test-pepper-min-16-chars",
  } as Env;
}

async function submitTestOrder(env: Env): Promise<string> {
  const res = await handlePublicPremiumOrderSubmit(
    new Request("https://ads.test/v1/public/premium/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placement_id: placementId,
        company_name: "Schvalování s.r.o.",
        contact_name: "Admin Test",
        email: "approve-d1@example.test",
        phone: "+420 777 123 456",
        target_url: "https://example.test/premium-ad",
        creative_mode: "logo",
        billing_street: "Ulice 2",
        billing_city: "Praha",
        billing_zip: "11000",
        billing_country: "Česká republika",
        terms_version: PREMIUM_TERMS_VERSION,
        terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
        b2b_only: true,
        authorization_confirmed: true,
        ordering_person_name: "Marie Schvalovací",
        ico: "27074358",
      }),
    }),
    env
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { order_id: string };
  return body.order_id;
}

function attachCreativeForApproval(sqlite: ReturnType<typeof createIuAdsSchemaDb>, orderId: string) {
  const order = sqlite.prepare("SELECT client_id FROM orders WHERE order_id = ?").get(orderId) as { client_id: string };
  const creativeId = "crv_d1_" + orderId.slice(-6);
  sqlite
    .prepare(
      `INSERT INTO creatives (
         creative_id, client_id, format, mime_type, content_hash, r2_key, review_status, created_at, updated_at
       ) VALUES (?, ?, 'logo', 'image/png', 'hash', ?, 'pending', ?, ?)`
    )
    .run(creativeId, order.client_id, "creatives/" + creativeId + ".png", NOW, NOW);
  sqlite
    .prepare(
      `UPDATE premium_selected_orders
       SET workflow_status = 'under_review', creative_id = ?, creative_mode = 'logo', updated_at = ?
       WHERE order_id = ?`
    )
    .run(creativeId, NOW, orderId);
}

describe("premium admin approve — D1 integration (freeze)", () => {
  it("approves order, locks placement, creates campaign+invoice, blocks duplicate publish", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const orderId = await submitTestOrder(env);
    attachCreativeForApproval(sqlite, orderId);

    const first = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_test",
      idempotencyKey: "idem:approve:1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const po = sqlite
      .prepare(
        "SELECT workflow_status, published_campaign_id, published_at, placement_id FROM premium_selected_orders WHERE order_id = ?"
      )
      .get(orderId) as {
      workflow_status: string;
      published_campaign_id: string | null;
      published_at: string | null;
      placement_id: string;
    };
    expect(po.workflow_status).toBe("published");
    expect(po.published_campaign_id).toBe(first.campaign_id);
    expect(po.published_at).toBeTruthy();

    const camp = sqlite
      .prepare("SELECT order_id, status, start_at, end_at, target_url FROM campaigns WHERE campaign_id = ?")
      .get(first.campaign_id) as {
      order_id: string;
      status: string;
      start_at: string;
      end_at: string;
      target_url: string;
    };
    expect(camp.order_id).toBe(orderId);
    expect(camp.status).toBe("active");
    expect(camp.target_url).toBe("https://example.test/premium-ad");
    expect(Date.parse(camp.end_at)).toBeGreaterThan(Date.parse(camp.start_at));

    const pl = sqlite
      .prepare("SELECT active_campaign_id FROM premium_selected_placements WHERE placement_id = ?")
      .get(po.placement_id) as { active_campaign_id: string | null };
    expect(pl.active_campaign_id).toBe(first.campaign_id);

    const inv = sqlite
      .prepare("SELECT order_id, campaign_id, status FROM invoices WHERE invoice_id = ?")
      .get(first.invoice_id) as { order_id: string; campaign_id: string; status: string };
    expect(inv.order_id).toBe(orderId);
    expect(inv.campaign_id).toBe(first.campaign_id);
    expect(inv.status).toBe("issued");

    const replay = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_test",
      idempotencyKey: "idem:approve:1",
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.already).toBe(true);

    const dup = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_test",
      idempotencyKey: "idem:approve:2",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("already_published");

    const campCount = sqlite.prepare("SELECT COUNT(*) AS c FROM campaigns WHERE order_id = ?").get(orderId) as { c: number };
    expect(Number(campCount.c)).toBe(1);
  });

  it("rejects publish without creative and releases placement on pre-publish reject", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = makeEnv(sqlite);
    const orderId = await submitTestOrder(env);

    const blocked = await executePremiumApproveAndPublish(env, {
      orderId,
      actorUserId: "adm_test",
      idempotencyKey: "idem:no-creative",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("missing_creative_or_url");

    const reject = await executePremiumOrderReject(env, {
      orderId,
      actorUserId: "adm_test",
      reason: "test reject",
    });
    expect(reject.ok).toBe(true);

    const po = sqlite
      .prepare("SELECT workflow_status FROM premium_selected_orders WHERE order_id = ?")
      .get(orderId) as { workflow_status: string };
    expect(po.workflow_status).toBe("rejected");

    const res2 = await handlePublicPremiumOrderSubmit(
      new Request("https://ads.test/v1/public/premium/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placement_id: placementId,
          company_name: "Druhý s.r.o.",
          contact_name: "Druhý",
          email: "second@example.test",
          phone: "+420 777 123 457",
          target_url: "https://example.test/2",
          creative_mode: "logo",
          billing_street: "Ulice 2",
          billing_city: "Praha",
          billing_zip: "11000",
          billing_country: "Česká republika",
          terms_version: PREMIUM_TERMS_VERSION,
          terms_effective_at: PREMIUM_TERMS_EFFECTIVE_AT,
          b2b_only: true,
          authorization_confirmed: true,
          ordering_person_name: "Marie",
          ico: "27074358",
        }),
      }),
      env
    );
    expect(res2.status).toBe(201);
  });
});
