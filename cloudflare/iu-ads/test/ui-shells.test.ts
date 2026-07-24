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

describe("admin + client SPA shells", () => {
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

  it("admin shell includes full campaign create form fields (not stub-only)", async () => {
    const res = await worker.fetch(new Request("https://ads.test/admin"), env);
    const html = await res.text();
    expect(html).toContain("Nová kampaň (úplný formulář)");
    expect(html).toContain('"c-client"');
    expect(html).toContain('"c-title"');
    expect(html).toContain('"c-evidence"');
    expect(html).toContain('"c-label"');
    expect(html).toContain('"c-target"');
    expect(html).toContain('"c-devices"');
    expect(html).toContain('"c-sections"');
    expect(html).toContain('"c-regions"');
    expect(html).toContain('"c-report"');
    expect(html).toContain('"c-export"');
    expect(html).toContain("/v1/admin/campaigns");
    expect(html).toContain("/transition");
    expect(html).toContain("PLAINTEXT kód (jednou)");
    expect(html).toContain("/v1/admin/creatives");
    expect(html).toContain("/v1/admin/documents");
    expect(html).toContain("/v1/admin/backups");
    expect(html).toContain("declared_mime");
  });

  it("GET /client returns HTML 200 with access-code login and portal tabs", async () => {
    const res = await worker.fetch(new Request("https://ads.test/client"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") || "").toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('id="login-form"');
    expect(html).toContain('id="access_code"');
    expect(html).toContain("/v1/client/auth/login");
    expect(html).toContain("/v1/client/report");
    expect(html).toContain('name="robots" content="noindex,nofollow"');
    expect(html).toContain("Kampaně");
    expect(html).toContain("Export JSON");
    expect(html).toContain("Export CSV");
  });

  it("shells contain no hardcoded secrets or credential literals", () => {
    const combined = ADMIN_SHELL_HTML + CLIENT_SHELL_HTML;
    expect(combined.toLowerCase()).not.toMatch(/ads_session_secret|ads_password_pepper|ads_code_pepper|ads_backup_encryption/);
    expect(combined).not.toMatch(/sk_live|Bearer [A-Za-z0-9]{20,}/);
    expect(combined).not.toContain("password123");
    expect(combined).not.toContain("admin@infouzel");
  });
});
