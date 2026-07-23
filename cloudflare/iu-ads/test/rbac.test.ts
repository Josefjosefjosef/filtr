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
