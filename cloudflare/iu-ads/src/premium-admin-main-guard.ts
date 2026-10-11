import type { RoleCode } from "./rbac";

export function adminRolesIncludeMainAdmin(roles: readonly string[]): boolean {
  return roles.includes("main_admin");
}
