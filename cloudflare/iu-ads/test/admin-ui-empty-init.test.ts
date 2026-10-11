import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ADMIN_UI_SCRIPT } from "../src/admin-ui-script";
import { createAdminUiHarness } from "./helpers/admin-ui-dom-harness";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

const NOW = "2026-03-01T12:00:00.000Z";
const ADMIN_SECRET = "test-admin-session-secret-for-empty-init";

function seedMainAdminSession(sqlite: ReturnType<typeof createIuAdsSchemaDb>) {
  sqlite
    .prepare(
      `INSERT INTO admin_users (user_id, email, display_name, password_hash, is_active, force_password_change, created_at, updated_at)
       VALUES ('adm_main', 'admin@test.local', 'Main Admin', 'x', 1, 0, ?, ?)`
    )
    .run(NOW, NOW);
  sqlite
    .prepare(`INSERT INTO admin_user_roles (user_id, role_code, assigned_at) VALUES ('adm_main', 'main_admin', ?)`)
    .run(NOW);
}

async function buildAuthedRequest(url: string): Promise<{ headers: HeadersInit; sessionId: string; tokenHash: string }> {
  const sessionId = generateSessionId();
  const tokenHash = await hashOpaqueToken(sessionId);
  const exp = nowSeconds() + 3600;
  const token = await signSessionToken(ADMIN_SECRET, { sessionId, exp });
  return {
    sessionId,
    tokenHash,
    headers: { Cookie: "iu_ads_admin_session=" + token },
  };
}

describe("admin UI empty D1 init", () => {
  it("premium orders shell must not reference undefined isMainAdmin()", () => {
    expect(ADMIN_UI_SCRIPT).toContain("isMainAdminUser");
    expect(ADMIN_UI_SCRIPT).not.toMatch(/\bisMainAdmin\s*\(/);
    expect(ADMIN_UI_SCRIPT).toContain("panel-retry");
  });

  it("dashboard and premium list APIs return 200 with empty operational data", async () => {
    const sqlite = createIuAdsSchemaDb();
    seedMainAdminSession(sqlite);
    const auth = await buildAuthedRequest("https://ads.test/v1/admin/dashboard");
    sqlite
      .prepare(
        `INSERT INTO admin_sessions (session_id, user_id, token_hash, created_at, last_seen_at, expires_at)
         VALUES (?, 'adm_main', ?, ?, ?, ?)`
      )
      .run(auth.sessionId, auth.tokenHash, NOW, NOW, new Date(Date.now() + 86400000).toISOString());

    const env = {
      DB: d1FromSqlite(sqlite),
      ADS_ADMIN_API_ENABLED: "true",
      ADS_SESSION_SECRET: ADMIN_SECRET,
      ADS_PASSWORD_PEPPER: "test-pepper",
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;

    const headers = auth.headers;

    const dash = await worker.fetch(new Request("https://ads.test/v1/admin/dashboard", { headers }), env);
    expect(dash.status).toBe(200);
    const dashBody = (await dash.json()) as { widgets?: Record<string, unknown> };
    expect(dashBody.widgets).toBeTruthy();

    const summary = await worker.fetch(new Request("https://ads.test/v1/admin/premium/orders/summary", { headers }), env);
    expect(summary.status).toBe(200);
    const sumBody = (await summary.json()) as { pending_review?: number };
    expect(sumBody.pending_review).toBe(0);

    const list = await worker.fetch(new Request("https://ads.test/v1/admin/premium/orders", { headers }), env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { premium_orders?: unknown[] };
    expect(Array.isArray(listBody.premium_orders)).toBe(true);
    expect(listBody.premium_orders?.length).toBe(0);
  });

  it("render() finishes premium and dashboard panels (no stuck Načítám)", async () => {
    const jsonResponse = (data: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const harness = createAdminUiHarness(async (path) => {
      if (path === "/health") {
        return jsonResponse({ ok: true, adminApiEnabled: true, safeMode: true, publicDeliveryEnabled: false });
      }
      if (path === "/v1/admin/premium/orders/summary") {
        return jsonResponse({
          pending_review: 0,
          active_published: 0,
          paused: 0,
          unpaid: 0,
          ending_within_30_days: 0,
        });
      }
      if (path.startsWith("/v1/admin/premium/orders")) {
        return jsonResponse({ premium_orders: [], pending_count: 0 });
      }
      if (path === "/v1/admin/dashboard") {
        return jsonResponse({ widgets: { open_orders: 0 } });
      }
      if (path === "/v1/admin/campaigns") {
        return jsonResponse({ campaigns: [] });
      }
      if (path === "/v1/admin/clients") {
        return jsonResponse({ clients: [] });
      }
      return jsonResponse({ error: "unexpected_path", path });
    });

    await harness.renderView("dashboard");
    let html = harness.getPanelHtml();
    expect(html).toContain("Dashboard");
    expect(html).not.toMatch(/^<p class="muted">Načítám…<\/p>$/);

    await harness.renderView("premium");
    html = harness.getPanelHtml();
    expect(html).toContain("Vybrané služby a odkazy");
    expect(html).toContain("Žádné objednávky k zobrazení");
    expect(html).not.toMatch(/^<p class="muted">Načítám…<\/p>$/);

    await harness.renderView("orders");
    html = harness.getPanelHtml();
    expect(html).toContain("Vybrané služby a odkazy");
    expect(html).not.toContain("Načtení panelu se nezdařilo");
  });

  it("ReferenceError in premium render shows failure UI (regression for isMainAdmin typo)", async () => {
    const brokenScript = ADMIN_UI_SCRIPT.replace(
      "var resetBar=isMainAdminUser()",
      "var resetBar=isMainAdmin()"
    );
    const jsonResponse = (data: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    const harness = createAdminUiHarness(async (path) => {
      if (path.startsWith("/v1/admin/premium/orders/summary")) {
        return jsonResponse({ pending_review: 0, active_published: 0, paused: 0, unpaid: 0, ending_within_30_days: 0 });
      }
      if (path.startsWith("/v1/admin/premium/orders")) {
        return jsonResponse({ premium_orders: [], pending_count: 0 });
      }
      return jsonResponse({});
    }, brokenScript);

    await harness.renderView("premium");
    const html = harness.getPanelHtml();
    expect(html).toContain("Načtení panelu se nezdařilo");
    expect(html).toContain("panel-retry");
    expect(html).not.toMatch(/^<p class="muted">Načítám…<\/p>$/);
  });
});
