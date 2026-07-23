import { describe, expect, it } from "vitest";
import { ROLE_CATALOG, ROLE_CODES, hasAnyRole, hasPermission, isRoleCode, permissionsForRoles } from "../src/rbac";

describe("RBAC hardcoded role -> permission map", () => {
  it("main_admin has full access including users/audit", () => {
    expect(hasPermission(["main_admin"], "users.write")).toBe(true);
    expect(hasPermission(["main_admin"], "audit.read")).toBe(true);
    expect(hasPermission(["main_admin"], "campaigns.write")).toBe(true);
  });

  it("ads_manager cannot manage users or settings (kap. 4/7)", () => {
    expect(hasPermission(["ads_manager"], "users.write")).toBe(false);
    expect(hasPermission(["ads_manager"], "users.read")).toBe(false);
    expect(hasPermission(["ads_manager"], "settings.write")).toBe(false);
    expect(hasPermission(["ads_manager"], "campaigns.write")).toBe(true);
    expect(hasPermission(["ads_manager"], "creatives.write")).toBe(true);
  });

  it("sales can manage clients/orders/contracts but not users", () => {
    expect(hasPermission(["sales"], "clients.write")).toBe(true);
    expect(hasPermission(["sales"], "orders.write")).toBe(true);
    expect(hasPermission(["sales"], "users.write")).toBe(false);
    expect(hasPermission(["sales"], "campaigns.activate")).toBe(false);
  });

  it("read_only has audit.read but no write permissions anywhere", () => {
    expect(hasPermission(["read_only"], "audit.read")).toBe(true);
    expect(hasPermission(["read_only"], "campaigns.read")).toBe(true);
    expect(hasPermission(["read_only"], "campaigns.write")).toBe(false);
    expect(hasPermission(["read_only"], "users.write")).toBe(false);
    expect(hasPermission(["read_only"], "users.read")).toBe(false);
  });

  it("unknown or empty roles never grant permissions (fail closed)", () => {
    expect(hasPermission([], "audit.read")).toBe(false);
    expect(hasPermission(["not_a_role"], "audit.read")).toBe(false);
  });

  it("permissionsForRoles unions permissions across multiple roles", () => {
    const perms = permissionsForRoles(["sales", "ads_manager"]);
    expect(perms.has("clients.write")).toBe(true);
    expect(perms.has("campaigns.write")).toBe(true);
    expect(perms.has("users.write")).toBe(false);
  });

  it("hasAnyRole / isRoleCode guard invalid input", () => {
    expect(isRoleCode("main_admin")).toBe(true);
    expect(isRoleCode("hacker")).toBe(false);
    expect(hasAnyRole(["sales"], ["main_admin", "sales"])).toBe(true);
    expect(hasAnyRole(["ads_manager"], ["main_admin", "sales"])).toBe(false);
  });

  it("role catalog covers exactly the four documented roles", () => {
    expect(ROLE_CATALOG.map((r) => r.role_code).sort()).toEqual([...ROLE_CODES].sort());
    expect(ROLE_CODES).toContain("main_admin");
    expect(ROLE_CODES).toContain("read_only");
  });
});

describe("RBAC Etapa 3 extension — documents/rights/complaints/exports/finance", () => {
  it("main_admin gets every new Etapa 3 permission automatically (ALL_PERMISSIONS)", () => {
    expect(hasPermission(["main_admin"], "documents.write")).toBe(true);
    expect(hasPermission(["main_admin"], "rights.write")).toBe(true);
    expect(hasPermission(["main_admin"], "complaints.write")).toBe(true);
    expect(hasPermission(["main_admin"], "exports.write")).toBe(true);
    expect(hasPermission(["main_admin"], "finance.read")).toBe(true);
  });

  it("sales gets invoices.write plus documents/complaints/exports/finance (business surfaces)", () => {
    expect(hasPermission(["sales"], "invoices.read")).toBe(true);
    expect(hasPermission(["sales"], "invoices.write")).toBe(true);
    expect(hasPermission(["sales"], "documents.read")).toBe(true);
    expect(hasPermission(["sales"], "documents.write")).toBe(true);
    expect(hasPermission(["sales"], "complaints.read")).toBe(true);
    expect(hasPermission(["sales"], "complaints.write")).toBe(true);
    expect(hasPermission(["sales"], "exports.read")).toBe(true);
    expect(hasPermission(["sales"], "exports.write")).toBe(true);
    expect(hasPermission(["sales"], "finance.read")).toBe(true);
    // Rights confirmation stays with ads_manager/main_admin — sales does not gate campaign activation.
    expect(hasPermission(["sales"], "rights.write")).toBe(false);
  });

  it("ads_manager gets rights.read/rights.write (campaign activation prerequisite) but no business/finance perms", () => {
    expect(hasPermission(["ads_manager"], "rights.read")).toBe(true);
    expect(hasPermission(["ads_manager"], "rights.write")).toBe(true);
    expect(hasPermission(["ads_manager"], "codes.read")).toBe(true);
    expect(hasPermission(["ads_manager"], "codes.write")).toBe(true);
    expect(hasPermission(["ads_manager"], "alerts.read")).toBe(true);
    expect(hasPermission(["ads_manager"], "alerts.write")).toBe(true);
    expect(hasPermission(["ads_manager"], "documents.write")).toBe(false);
    expect(hasPermission(["ads_manager"], "finance.read")).toBe(false);
    expect(hasPermission(["ads_manager"], "complaints.write")).toBe(false);
  });

  it("Etapa 8 alerts permissions: sales can write, read_only cannot", () => {
    expect(hasPermission(["sales"], "alerts.read")).toBe(true);
    expect(hasPermission(["sales"], "alerts.write")).toBe(true);
    expect(hasPermission(["read_only"], "alerts.read")).toBe(true);
    expect(hasPermission(["read_only"], "alerts.write")).toBe(false);
    expect(hasPermission(["main_admin"], "alerts.write")).toBe(true);
  });

  it("read_only gets read-only access to every new Etapa 3 surface and no write access anywhere", () => {
    expect(hasPermission(["read_only"], "documents.read")).toBe(true);
    expect(hasPermission(["read_only"], "rights.read")).toBe(true);
    expect(hasPermission(["read_only"], "complaints.read")).toBe(true);
    expect(hasPermission(["read_only"], "exports.read")).toBe(true);
    expect(hasPermission(["read_only"], "finance.read")).toBe(true);
    expect(hasPermission(["read_only"], "documents.write")).toBe(false);
    expect(hasPermission(["read_only"], "rights.write")).toBe(false);
    expect(hasPermission(["read_only"], "complaints.write")).toBe(false);
    expect(hasPermission(["read_only"], "exports.write")).toBe(false);
  });

  it("PERMISSIONS catalog contains all nine new Etapa 3 permission strings", () => {
    for (const perm of [
      "documents.read",
      "documents.write",
      "rights.read",
      "rights.write",
      "complaints.read",
      "complaints.write",
      "exports.read",
      "exports.write",
      "finance.read",
    ] as const) {
      expect(hasPermission(["main_admin"], perm)).toBe(true);
    }
  });
});
