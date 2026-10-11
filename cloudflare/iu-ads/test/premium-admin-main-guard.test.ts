import { describe, expect, it } from "vitest";
import { adminRolesIncludeMainAdmin } from "../src/premium-admin-main-guard";

describe("main admin guard", () => {
  it("accepts main_admin role", () => {
    expect(adminRolesIncludeMainAdmin(["admin", "main_admin"])).toBe(true);
  });
  it("rejects non-main admin", () => {
    expect(adminRolesIncludeMainAdmin(["admin", "orders.write"])).toBe(false);
  });
});
