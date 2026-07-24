/**
 * Admin nav contract (Etapa 8, kap. 5). Role-filtered menu entries for the admin shell /
 * future public-site UI. UI hiding never substitutes for server-side RBAC on the target routes.
 */
import { json, requireAdminSession } from "./admin-auth";
import { hasPermission, type Permission } from "./rbac";
import type { Env } from "./types";

export type NavEntry = {
  id: string;
  label_cs: string;
  href: string;
  permission: Permission | null;
};

/** Static catalog — filtered per request by the caller's effective permissions. */
export const ADMIN_NAV_CATALOG: readonly NavEntry[] = [
  { id: "dashboard", label_cs: "Dashboard", href: "/v1/admin/dashboard", permission: null },
  { id: "search", label_cs: "Vyhledávání", href: "/v1/admin/search", permission: null },
  { id: "calendar", label_cs: "Kalendář", href: "/v1/admin/calendar", permission: "campaigns.read" },
  { id: "alerts", label_cs: "Upozornění", href: "/v1/admin/alerts", permission: "alerts.read" },
  { id: "clients", label_cs: "Klienti", href: "/v1/admin/clients", permission: "clients.read" },
  { id: "inquiries", label_cs: "Poptávky", href: "/v1/admin/inquiries", permission: "inquiries.read" },
  { id: "orders", label_cs: "Objednávky", href: "/v1/admin/orders", permission: "orders.read" },
  { id: "contracts", label_cs: "Smlouvy", href: "/v1/admin/contracts", permission: "contracts.read" },
  { id: "invoices", label_cs: "Faktury", href: "/v1/admin/invoices", permission: "invoices.read" },
  { id: "campaigns", label_cs: "Kampaně", href: "/v1/admin/campaigns", permission: "campaigns.read" },
  { id: "placements", label_cs: "Umístění", href: "/v1/admin/placement-types", permission: "placements.read" },
  { id: "reservations", label_cs: "Rezervace", href: "/v1/admin/reservations", permission: "placements.read" },
  { id: "creatives", label_cs: "Kreativy", href: "/v1/admin/creatives", permission: "creatives.read" },
  { id: "documents", label_cs: "Dokumenty", href: "/v1/admin/documents", permission: "documents.read" },
  { id: "rights", label_cs: "Autorská práva", href: "/v1/admin/rights", permission: "rights.read" },
  { id: "complaints", label_cs: "Reklamace", href: "/v1/admin/complaints", permission: "complaints.read" },
  { id: "codes", label_cs: "Klientské kódy", href: "/v1/admin/codes", permission: "codes.read" },
  { id: "stats", label_cs: "Statistiky", href: "/v1/admin/stats/summary", permission: "stats.read" },
  { id: "finance", label_cs: "Finance", href: "/v1/admin/finance/summary", permission: "finance.read" },
  { id: "exports", label_cs: "Exporty", href: "/v1/admin/exports", permission: "exports.read" },
  { id: "backups", label_cs: "Zálohy", href: "/v1/admin/backups", permission: "backups.read" },
  { id: "audit", label_cs: "Audit", href: "/v1/admin/audit", permission: "audit.read" },
  { id: "users", label_cs: "Uživatelé", href: "/v1/admin/users", permission: "users.read" },
];

export function filterNavForRoles(roles: readonly string[]): NavEntry[] {
  return ADMIN_NAV_CATALOG.filter((entry) => {
    if (!entry.permission) return true;
    // Calendar also useful with placements.read alone.
    if (entry.id === "calendar") {
      return hasPermission(roles, "campaigns.read") || hasPermission(roles, "placements.read");
    }
    return hasPermission(roles, entry.permission);
  });
}

export async function handleGetAdminNav(request: Request, env: Env): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  const items = filterNavForRoles(session.context.roles).map((e) => ({
    id: e.id,
    label_cs: e.label_cs,
    href: e.href,
  }));
  return json({ nav: items, roles: session.context.roles });
}
