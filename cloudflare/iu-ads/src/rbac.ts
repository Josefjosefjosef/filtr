/**
 * Hardcoded role → permission map (Etapa 2). See docs/ads-system/07-roles-permissions.md.
 * Server-side enforcement only — UI hiding never substitutes for this check.
 */

export const ROLE_CODES = ["main_admin", "ads_manager", "sales", "read_only"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === "string" && (ROLE_CODES as readonly string[]).includes(value);
}

export const PERMISSIONS = [
  "users.read",
  "users.write",
  "roles.read",
  "settings.write",
  "audit.read",
  "clients.read",
  "clients.write",
  "inquiries.read",
  "inquiries.write",
  "orders.read",
  "orders.write",
  "contracts.read",
  "contracts.write",
  "invoices.read",
  "invoices.write",
  "campaigns.read",
  "campaigns.write",
  "campaigns.activate",
  "placements.read",
  "placements.write",
  "creatives.read",
  "creatives.write",
  "codes.read",
  "codes.write",
  "stats.read",
  // Etapa 3 (kap. 22,24,25,30,31): business documents/rights/complaints/exports/finance.
  "documents.read",
  "documents.write",
  "rights.read",
  "rights.write",
  "complaints.read",
  "complaints.write",
  "exports.read",
  "exports.write",
  "finance.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const READ_ONLY_PERMISSIONS: readonly Permission[] = [
  "audit.read",
  "clients.read",
  "inquiries.read",
  "orders.read",
  "contracts.read",
  "invoices.read",
  "campaigns.read",
  "placements.read",
  "creatives.read",
  "codes.read",
  "stats.read",
  // Etapa 3: read-only access to the new business/documents surfaces.
  "documents.read",
  "rights.read",
  "complaints.read",
  "exports.read",
  "finance.read",
];

/** kap. 4/7: main_admin = vše; ads_manager = kampaně/kreativy/umístění/statistiky/autorská práva
 *  (ne uživatelé/systém); sales = klienti/poptávky/objednávky/smlouvy/faktury/dokumenty/reklamace/export
 *  (aktivace jen se schválením); read_only = jen čtení. */
const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  main_admin: ALL_PERMISSIONS,
  ads_manager: [
    "campaigns.read",
    "campaigns.write",
    // Etapa 4 (kap. 4/7/13): ads_manager may move a campaign into approved/scheduled/active.
    "campaigns.activate",
    "placements.read",
    "placements.write",
    "creatives.read",
    "creatives.write",
    // Etapa 7 (kap. 36): issue/list/regen/revoke client access codes for scoped portal access.
    "codes.read",
    "codes.write",
    "stats.read",
    "rights.read",
    "rights.write",
  ],
  sales: [
    "clients.read",
    "clients.write",
    "inquiries.read",
    "inquiries.write",
    "orders.read",
    "orders.write",
    "contracts.read",
    "contracts.write",
    "invoices.read",
    "invoices.write",
    "campaigns.read",
    "documents.read",
    "documents.write",
    "complaints.read",
    "complaints.write",
    "exports.read",
    "exports.write",
    "finance.read",
  ],
  read_only: READ_ONLY_PERMISSIONS,
};

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    if (!isRoleCode(role)) continue;
    for (const perm of ROLE_PERMISSIONS[role]) out.add(perm);
  }
  return out;
}

export function hasPermission(roles: readonly string[], permission: Permission): boolean {
  if (!roles || roles.length === 0) return false;
  for (const role of roles) {
    if (isRoleCode(role) && ROLE_PERMISSIONS[role].includes(permission)) return true;
  }
  return false;
}

export function hasAnyRole(roles: readonly string[], allowed: readonly RoleCode[]): boolean {
  return roles.some((r) => isRoleCode(r) && (allowed as readonly string[]).includes(r));
}

export type RoleCatalogEntry = { role_code: RoleCode; title_cs: string; description: string; permissions: Permission[] };

export const ROLE_CATALOG: readonly RoleCatalogEntry[] = [
  {
    role_code: "main_admin",
    title_cs: "Hlavní administrátor",
    description: "Vše včetně uživatelů, nastavení, audit, kódy",
    permissions: [...ROLE_PERMISSIONS.main_admin],
  },
  {
    role_code: "ads_manager",
    title_cs: "Správce reklam",
    description: "Kampaně, kreativy, umístění, statistiky, autorská práva; ne uživatelé/systém",
    permissions: [...ROLE_PERMISSIONS.ads_manager],
  },
  {
    role_code: "sales",
    title_cs: "Obchodník",
    description:
      "Klienti, poptávky, objednávky, smlouvy, faktury, dokumenty, reklamace, export; aktivace reklamy jen se schválením",
    permissions: [...ROLE_PERMISSIONS.sales],
  },
  {
    role_code: "read_only",
    title_cs: "Pouze čtení",
    description: "Čtení přidělených částí; žádné mutace",
    permissions: [...ROLE_PERMISSIONS.read_only],
  },
];
