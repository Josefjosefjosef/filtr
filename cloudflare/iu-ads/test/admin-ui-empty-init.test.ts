import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ADMIN_UI_SCRIPT } from "../src/admin-ui-script";
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
});
