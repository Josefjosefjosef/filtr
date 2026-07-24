import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ADMIN_SHELL_HTML } from "../src/admin-ui";
import { ADMIN_UI_SCRIPT } from "../src/admin-ui-script";
import { CLIENT_SHELL_HTML } from "../src/client-ui";
import type { Env } from "../src/types";

const env = {
  ADS_SAFE_MODE: "true",
  ADS_PUBLIC_DELIVERY_ENABLED: "false",
  ADS_ADMIN_API_ENABLED: "false",
  ADS_CLIENT_API_ENABLED: "false",
} as Env;

/** Known Worker routes that Admin/Client SPAs may call (method-agnostic path inventory). */
const KNOWN_ADMIN_CLIENT_PATHS = [
  "/health",
  "/v1/admin/auth/login",
  "/v1/admin/auth/logout",
  "/v1/admin/auth/me",
  "/v1/admin/auth/password-reset/request",
  "/v1/admin/auth/password/change",
  "/v1/admin/nav",
  "/v1/admin/dashboard",
  "/v1/admin/search",
  "/v1/admin/calendar",
  "/v1/admin/alerts",
  "/v1/admin/alerts/generate",
  "/v1/admin/clients",
  "/v1/admin/inquiries",
  "/v1/admin/orders",
  "/v1/admin/contracts",
  "/v1/admin/invoices",
  "/v1/admin/campaigns",
  "/v1/admin/placement-types",
  "/v1/admin/reservations",
  "/v1/admin/creatives",
  "/v1/admin/documents",
  "/v1/admin/rights",
  "/v1/admin/complaints",
  "/v1/admin/codes",
  "/v1/admin/stats/summary",
  "/v1/admin/stats/campaigns",
  "/v1/admin/stats/campaigns/",
  "/v1/admin/finance/summary",
  "/v1/admin/exports",
  "/v1/admin/backups",
  "/v1/admin/backups/prune",
  "/v1/admin/audit",
  "/v1/admin/users",
  "/v1/client/auth/login",
  "/v1/client/auth/logout",
  "/v1/client/auth/me",
  "/v1/client/report",
  "/v1/client/report/export",
];

function extractQuotedPaths(source: string): string[] {
  const paths = new Set<string>();
  const re = /["'`](\/v1\/(?:admin|client)[^"'`\s]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1];
    // Drop querystrings and dynamic concat tails for inventory matching.
    const base = raw.split("?")[0].replace(/\/$/, "");
    paths.add(base);
  }
  return [...paths];
}

function pathIsKnown(path: string): boolean {
  if (KNOWN_ADMIN_CLIENT_PATHS.includes(path)) return true;
  // Fallback nav concat builds "/v1/admin/"+viewId — allow the prefix only.
  if (path === "/v1/admin") return true;
  // Dynamic id suffixes: /v1/admin/campaigns/:id, /transition, /access, etc.
  const dynamic = [
    /^\/v1\/admin\/campaigns\/.+/,
    /^\/v1\/admin\/creatives\/.+/,
    /^\/v1\/admin\/documents\/.+/,
    /^\/v1\/admin\/codes\/.+/,
    /^\/v1\/admin\/backups\/.+/,
    /^\/v1\/admin\/alerts\/.+/,
    /^\/v1\/admin\/stats\/campaigns\/.+/,
  ];
  return dynamic.some((re) => re.test(path));
}

describe("UI ↔ API contracts (PR #7711)", () => {
  it("password change uses camelCase body keys expected by admin-auth", () => {
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/password/change");
    expect(ADMIN_UI_SCRIPT).toMatch(/currentPassword\s*:\s*val\("pw-cur"\)/);
    expect(ADMIN_UI_SCRIPT).toMatch(/newPassword\s*:\s*val\("pw-new"\)/);
    expect(ADMIN_UI_SCRIPT).not.toMatch(/\{\s*current_password\s*:/);
    expect(ADMIN_UI_SCRIPT).not.toMatch(/\{\s*[^}]*new_password\s*:/);
  });

  it("user create requires display_name", () => {
    expect(ADMIN_UI_SCRIPT).toContain("display_name:displayName");
    expect(ADMIN_UI_SCRIPT).toContain("Display name je povinné");
  });

  it("campaign create payload includes full field set", () => {
    const required = [
      "client_id",
      "title",
      "label_type",
      "devices",
      "sections",
      "regions",
      "client_report_enabled",
      "client_export_enabled",
      "evidence_code",
      "target_url",
      "price_cents",
      "note_internal",
    ];
    for (const key of required) {
      expect(ADMIN_UI_SCRIPT).toContain(key);
    }
    expect(ADMIN_UI_SCRIPT).toContain("Nová kampaň (úplný formulář)");
  });

  it("campaign PATCH does not pretend to save impression_limit/click_limit", () => {
    // Create may still mention limits; edit save body must not send them.
    const saveIdx = ADMIN_UI_SCRIPT.indexOf('id="e-save"');
    expect(saveIdx).toBeGreaterThan(-1);
    const saveBlock = ADMIN_UI_SCRIPT.slice(saveIdx, saveIdx + 900);
    expect(saveBlock).toContain("budget_limit_cents");
    expect(saveBlock).not.toContain("impression_limit:numOrNull");
    expect(saveBlock).not.toContain("click_limit:numOrNull");
  });

  it("admin/client shells expose error hooks and empty-state copy", () => {
    for (const id of ["login-err", "c-err", "cr-err", "doc-err", "code-err", "cl-err", "pw-err", "us-err"]) {
      expect(ADMIN_UI_SCRIPT).toContain(id);
    }
    expect(ADMIN_UI_SCRIPT).toContain("Žádné záznamy");
    expect(CLIENT_SHELL_HTML).toContain("login-err");
    expect(CLIENT_SHELL_HTML).toContain("Žádné záznamy ve scope");
  });

  it("client export offers json/csv only (no pdf link)", () => {
    expect(CLIENT_SHELL_HTML).toContain("/v1/client/report/export");
    expect(CLIENT_SHELL_HTML).toContain("format=json");
    expect(CLIENT_SHELL_HTML).toContain("format=csv");
    expect(CLIENT_SHELL_HTML).not.toContain("format=pdf");
  });

  it("codes once-show plaintext path is present", () => {
    expect(ADMIN_UI_SCRIPT).toContain("PLAINTEXT kód (jednou)");
    expect(ADMIN_UI_SCRIPT).toContain("access_code");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/codes");
    expect(ADMIN_UI_SCRIPT).toContain("/regen");
    expect(ADMIN_UI_SCRIPT).toContain("/revoke");
  });

  it("creatives/documents/backups UI hit signed-access and drill endpoints", () => {
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/creatives");
    expect(ADMIN_UI_SCRIPT).toContain("/access");
    expect(ADMIN_UI_SCRIPT).toContain("/approve");
    expect(ADMIN_UI_SCRIPT).toContain("/reject");
    expect(ADMIN_UI_SCRIPT).toContain("declared_mime");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/documents");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/backups");
    expect(ADMIN_UI_SCRIPT).toContain("/drill");
    expect(ADMIN_UI_SCRIPT).toContain("/prune");
  });

  it("all UI /v1/admin|client paths are known Worker routes", () => {
    const combined = ADMIN_UI_SCRIPT + CLIENT_SHELL_HTML;
    const paths = extractQuotedPaths(combined);
    expect(paths.length).toBeGreaterThan(20);
    const unknown = paths.filter((p) => !pathIsKnown(p));
    expect(unknown).toEqual([]);
  });

  it("shells never call public delivery write/read APIs", async () => {
    const combined = ADMIN_SHELL_HTML + CLIENT_SHELL_HTML + ADMIN_UI_SCRIPT;
    expect(combined).not.toContain("/v1/public/ads");
    expect(combined).not.toContain("ADS_PUBLIC_DELIVERY_ENABLED=true");
    expect(ADMIN_UI_SCRIPT).toContain("publicDelivery");
    expect(CLIENT_SHELL_HTML).toContain("publicDeliveryEnabled");

    const res = await worker.fetch(new Request("https://ads.test/admin"), env);
    const html = await res.text();
    expect(html).toContain("fail-closed");
  });

  it("login/logout/me endpoints are wired for admin and client", () => {
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/login");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/logout");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/me");
    expect(CLIENT_SHELL_HTML).toContain("/v1/client/auth/login");
    expect(CLIENT_SHELL_HTML).toContain("/v1/client/auth/logout");
    expect(CLIENT_SHELL_HTML).toContain("/v1/client/auth/me");
  });

  it("admin shell mentions all four roles for user create", () => {
    for (const role of ["main_admin", "ads_manager", "sales", "read_only"]) {
      expect(ADMIN_UI_SCRIPT).toContain(role);
    }
  });
});
