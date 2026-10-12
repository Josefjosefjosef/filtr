import { describe, expect, it } from "vitest";
import { handleUpdateCampaign } from "../src/admin-campaigns";
import {
  handleAdminPremiumAccountingCancel,
  handleAdminPremiumTurnOffAd,
} from "../src/admin-premium-selected";
import { handleAdminPremiumOrderDocumentAccess } from "../src/premium-order-documents";
import { handleAdminPremiumApprovePublish } from "../src/premium-publish";
import { handlePublicPremiumOrderSubmit } from "../src/public-premium-order";
import { premiumPlacementId } from "../src/premium-selected-services";
import { PREMIUM_TERMS_EFFECTIVE_AT, PREMIUM_TERMS_VERSION } from "../src/premium-terms";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { adminJsonRequest, seedAdminUserWithSession, TEST_ADMIN_SESSION_SECRET } from "./helpers/admin-session-d1";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

const placementId = premiumPlacementId("aff-zdravi-doplnky", 2);

function baseEnv(sqlite: ReturnType<typeof createIuAdsSchemaDb>): Env {
  return {
    DB: d1FromSqlite(sqlite),
    ADS_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
    ADS_CODE_PEPPER: "test-pepper-min-16-chars",
    ADS_R2_SIGNING_SECRET: "signing-secret-min-32-characters-long",
  } as Env;
}

async function seedPendingOrder(env: Env): Promise<string> {
  const res = await handlePublicPremiumOrderSubmit(
    new Request("https://ads.test/v1/public/premium/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placement_id: placementId,
        company_name: "Auth s.r.o.",
        contact_name: "Auth",
        email: "auth-d1@example.test",
        phone: "+420 777 123 461",
        target_url: "https://example.test/auth",
        creative_mode: "logo",
        billing_street: "Ulice 1",
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
  expect(res.status).toBe(201);
  return ((await res.json()) as { order_id: string }).order_id;
}

function readOrderWorkflow(sqlite: ReturnType<typeof createIuAdsSchemaDb>, orderId: string): string {
  const row = sqlite
    .prepare("SELECT workflow_status FROM premium_selected_orders WHERE order_id = ?")
    .get(orderId) as { workflow_status: string };
  return row.workflow_status;
}

describe("premium admin HTTP auth — D1 integration (freeze)", () => {
  it("rejects approve, turn-off, accounting-cancel, campaign patch, and document access without valid session", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = baseEnv(sqlite);
    const orderId = await seedPendingOrder(env);
    const wfBefore = readOrderWorkflow(sqlite, orderId);

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO clients (client_id, company_name, billing_info, created_at, updated_at) VALUES ('cli_c', 'C', '{}', ?, ?)`
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO campaigns (
           campaign_id, evidence_code, client_id, order_id, title, status, label_type, created_at, updated_at
         ) VALUES ('cmp_auth', 'EV-AUTH', 'cli_c', 'ord_other', 'Camp', 'draft', 'Reklama', ?, ?)`
      )
      .run(now, now);

    const noSessionApprove = await handleAdminPremiumApprovePublish(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/approve-publish`, null, {
        method: "POST",
        body: { idempotency_key: "k1" },
      }),
      env,
      orderId
    );
    expect(noSessionApprove.status).toBe(401);

    const invalidSessionId = generateSessionId();
    const badToken = await signSessionToken(TEST_ADMIN_SESSION_SECRET, {
      sessionId: invalidSessionId,
      exp: nowSeconds() + 3600,
    });
    const badCookie = "iu_ads_admin_session=" + badToken;
    const invalidApprove = await handleAdminPremiumApprovePublish(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/approve-publish`, badCookie, {
        method: "POST",
        body: { idempotency_key: "k2" },
      }),
      env,
      orderId
    );
    expect(invalidApprove.status).toBe(401);

    const adsMgr = await seedAdminUserWithSession(sqlite, { userId: "usr_ads_mgr", roles: ["ads_manager"] });
    const forbiddenApprove = await handleAdminPremiumApprovePublish(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/approve-publish`, adsMgr.cookieHeader, {
        method: "POST",
        body: { idempotency_key: "k3" },
      }),
      env,
      orderId
    );
    expect(forbiddenApprove.status).toBe(403);

    const readOnly = await seedAdminUserWithSession(sqlite, { userId: "usr_read", roles: ["read_only"] });
    const readOnlyCancel = await handleAdminPremiumAccountingCancel(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/accounting-cancel`, readOnly.cookieHeader, {
        method: "POST",
        body: { reason: "Pokus o neoprávněné storno objednávky bez oprávnění." },
      }),
      env,
      orderId
    );
    expect(readOnlyCancel.status).toBe(403);

    const readOnlyTurnOff = await handleAdminPremiumTurnOffAd(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/turn-off-ad`, readOnly.cookieHeader, {
        method: "POST",
        body: { reason: "Neoprávněné vypnutí reklamy bez role." },
      }),
      env,
      orderId
    );
    expect(readOnlyTurnOff.status).toBe(403);

    const adsMgrPatch = await handleUpdateCampaign(
      adminJsonRequest("https://ads.test/v1/admin/campaigns/cmp_auth", adsMgr.cookieHeader, {
        method: "PATCH",
        body: { title: "Hacked title" },
      }),
      env,
      "cmp_auth"
    );
    expect(adsMgrPatch.status).toBe(200);
    const campTitle = sqlite
      .prepare("SELECT title FROM campaigns WHERE campaign_id = 'cmp_auth'")
      .get() as { title: string };
    expect(campTitle.title).toBe("Hacked title");

    const readOnlyPatch = await handleUpdateCampaign(
      adminJsonRequest("https://ads.test/v1/admin/campaigns/cmp_auth", readOnly.cookieHeader, {
        method: "PATCH",
        body: { title: "Blocked title" },
      }),
      env,
      "cmp_auth"
    );
    expect(readOnlyPatch.status).toBe(403);
    expect((sqlite.prepare("SELECT title FROM campaigns WHERE campaign_id = 'cmp_auth'").get() as { title: string }).title).toBe(
      "Hacked title"
    );

    const docDenied = await handleAdminPremiumOrderDocumentAccess(
      adminJsonRequest(
        `https://ads.test/v1/admin/premium/orders/${orderId}/documents/invoice_pdf/access`,
        null,
        { method: "GET" }
      ),
      env,
      orderId,
      "invoice_pdf"
    );
    expect(docDenied.status).toBe(401);

    expect(readOrderWorkflow(sqlite, orderId)).toBe(wfBefore);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM premium_order_storno_records WHERE order_id = ?").get(orderId) as { c: number }).c
    ).toBe(0);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS c FROM invoices WHERE order_id = ?").get(orderId) as { c: number }).c
    ).toBe(0);
  });

  it("rejects revoked admin session with 401", async () => {
    const sqlite = createIuAdsSchemaDb();
    const env = baseEnv(sqlite);
    const orderId = await seedPendingOrder(env);
    await seedAdminUserWithSession(sqlite, { userId: "usr_revoked", roles: ["sales"] });
    const sessionId = generateSessionId();
    const tokenHash = await hashOpaqueToken(sessionId);
    const exp = nowSeconds() + 3600;
    const token = await signSessionToken(TEST_ADMIN_SESSION_SECRET, { sessionId, exp });
    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM admin_sessions").run();
    sqlite
      .prepare(
        `INSERT INTO admin_sessions (
           session_id, user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at
         ) VALUES (?, 'usr_revoked', ?, ?, ?, ?, ?)`
      )
      .run(sessionId, tokenHash, now, new Date(exp * 1000).toISOString(), now, now);

    const res = await handleAdminPremiumApprovePublish(
      adminJsonRequest(`https://ads.test/v1/admin/premium/orders/${orderId}/approve-publish`, "iu_ads_admin_session=" + token, {
        method: "POST",
        body: { idempotency_key: "revoked" },
      }),
      env,
      orderId
    );
    expect(res.status).toBe(401);
    expect(readOrderWorkflow(sqlite, orderId)).toBe("submitted");
  });
});
