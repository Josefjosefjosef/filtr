/**
 * Admin nav contract (Etapa 8, kap. 5). Role-filtered menu entries for the admin shell /
 * future public-site UI. UI hiding never substitutes for server-side RBAC on the target routes.
 */
import { json, requireAdminSession } from "./admin-auth";
import { countPendingPremiumOrders } from "./premium-order-workflow";
import { hasPermission, type Permission } from "./rbac";
import type { Env } from "./types";

export type NavEntry = {
  id: string;
  label_cs: string;
  href: string;
  permission: Permission | null;
};

/** Pořadí položek menu — regresní guard (viz scripts/iu-ads-admin-menu-guard-v1.mjs). */
export const ADMIN_NAV_ORDER_IDS: readonly string[] = [
  "dashboard",
  "search",
  "orders_all",
  "premium",
  "banner_pc",
  "order_confirmations",
  "invoices",
  "calendar",
  "alerts",
  "clients",
  "inquiries",
  "contracts",
  "campaigns",
  "placements",
  "reservations",
  "creatives",
  "documents",
  "rights",
  "complaints",
  "codes",
  "stats",
  "finance",
  "exports",
  "backups",
  "audit",
  "affiliate_archive",
  "users",
];

/** Static catalog — filtered per request by the caller's effective permissions. */
export const ADMIN_NAV_CATALOG: readonly NavEntry[] = [
  { id: "dashboard", label_cs: "Dashboard", href: "/v1/admin/dashboard", permission: null },
  { id: "search", label_cs: "Vyhledávání", href: "/v1/admin/search", permission: null },
  { id: "calendar", label_cs: "Kalendář", href: "/v1/admin/calendar", permission: "campaigns.read" },
  { id: "alerts", label_cs: "Upozornění", href: "/v1/admin/alerts", permission: "alerts.read" },
  { id: "clients", label_cs: "Klienti", href: "/v1/admin/clients", permission: "clients.read" },
  { id: "inquiries", label_cs: "Poptávky", href: "/v1/admin/inquiries", permission: "inquiries.read" },
  {
    id: "orders_all",
    label_cs: "Všechny objednávky",
    href: "/v1/admin/ad-orders",
    permission: "orders.read",
  },
  {
    id: "premium",
    label_cs: "Reklamní tlačítka – Vybrané služby a odkazy (PC, mobil, tablet)",
    href: "/v1/admin/premium/orders",
    permission: "orders.read",
  },
  {
    id: "banner_pc",
    label_cs: "Bannerová reklama – pravý sloupec PC",
    href: "/v1/admin/banner-pc",
    permission: "orders.read",
  },
  { id: "invoices", label_cs: "Faktury", href: "/v1/admin/invoices/registry", permission: "invoices.read" },
  {
    id: "order_confirmations",
    label_cs: "Potvrzení objednávek",
    href: "/v1/admin/order-confirmations/registry",
    permission: "documents.read",
  },
  { id: "contracts", label_cs: "Smlouvy", href: "/v1/admin/contracts", permission: "contracts.read" },
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
  {
    id: "affiliate_archive",
    label_cs: "Archiv reklam – Affiliate",
    href: "/v1/admin/affiliate-archive",
    permission: "audit.read",
  },
  { id: "users", label_cs: "Uživatelé", href: "/v1/admin/users", permission: "users.read" },
];

function navOrderIndex(id: string): number {
  const i = ADMIN_NAV_ORDER_IDS.indexOf(id);
  return i >= 0 ? i : 9999;
}

export function filterNavForRoles(roles: readonly string[]): NavEntry[] {
  const filtered = ADMIN_NAV_CATALOG.filter((entry) => {
    if (!entry.permission) return true;
    // Calendar also useful with placements.read alone.
    if (entry.id === "calendar") {
      return hasPermission(roles, "campaigns.read") || hasPermission(roles, "placements.read");
    }
    return hasPermission(roles, entry.permission);
  });
  return filtered.slice().sort((a, b) => navOrderIndex(a.id) - navOrderIndex(b.id));
}

export async function handleGetAdminNav(request: Request, env: Env): Promise<Response> {
  const session = await requireAdminSession(request, env);
  if (!session.ok) return json({ error: session.error }, session.status);
  let pendingPremiumOrders = 0;
  if (env.DB && hasPermission(session.context.roles, "orders.read")) {
    pendingPremiumOrders = await countPendingPremiumOrders(env.DB);
  }
  const items = filterNavForRoles(session.context.roles).map((e) => ({
    id: e.id,
    label_cs: e.label_cs,
    href: e.href,
    badge_count:
      (e.id === "orders_all" || e.id === "premium") && pendingPremiumOrders > 0
        ? pendingPremiumOrders
        : undefined,
  }));
  return json({ nav: items, roles: session.context.roles, pending_premium_orders: pendingPremiumOrders });
}
