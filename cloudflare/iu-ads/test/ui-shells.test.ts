import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ADMIN_SHELL_HTML } from "../src/admin-ui";
import { CLIENT_SHELL_HTML } from "../src/client-ui";
import type { Env } from "../src/types";

const env = {
  ADS_SAFE_MODE: "true",
  ADS_PUBLIC_DELIVERY_ENABLED: "false",
  ADS_ADMIN_API_ENABLED: "false",
  ADS_CLIENT_API_ENABLED: "false",
} as Env;

describe("admin + client SPA-lite shells", () => {
  it("GET /admin returns HTML 200 with login markers and noindex", async () => {
    const res = await worker.fetch(new Request("https://ads.test/admin"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") || "").toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag") || "").toContain("noindex");
    const html = await res.text();
    expect(html).toContain('id="login-form"');
    expect(html).toContain('id="email"');
    expect(html).toContain("/v1/admin/auth/login");
    expect(html).toContain('name="robots" content="noindex,nofollow"');
  });

  it("GET /client returns HTML 200 with access-code login markers", async () => {
    const res = await worker.fetch(new Request("https://ads.test/client"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") || "").toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('id="login-form"');
    expect(html).toContain('id="access_code"');
    expect(html).toContain("/v1/client/auth/login");
    expect(html).toContain('name="robots" content="noindex,nofollow"');
  });

  it("shells contain no hardcoded secrets or credential literals", () => {
    const combined = ADMIN_SHELL_HTML + CLIENT_SHELL_HTML;
    expect(combined.toLowerCase()).not.toMatch(/ads_session_secret|ads_password_pepper|ads_code_pepper|ads_backup_encryption/);
    expect(combined).not.toMatch(/sk_live|Bearer [A-Za-z0-9]{20,}/);
    expect(combined).not.toContain("password123");
    expect(combined).not.toContain("admin@infouzel");
  });
});
