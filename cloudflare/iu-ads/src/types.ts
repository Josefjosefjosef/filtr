export type DeviceCategory = "pc" | "mobile" | "tablet";

export type Env = {
  DB?: D1Database;
  CREATIVES?: R2Bucket;
  DOCUMENTS?: R2Bucket;
  /** Encrypted backup bucket (`iu-ads-backups`). Bound in wrangler; without encryption key → manifest_only. */
  BACKUPS?: R2Bucket;
  ADS_SAFE_MODE?: string;
  ADS_PUBLIC_DELIVERY_ENABLED?: string;
  ADS_ADMIN_API_ENABLED?: string;
  ADS_CLIENT_API_ENABLED?: string;
  CORS_ALLOW_ORIGIN?: string;
  /** Worker secret for short-lived private object access signatures (Etapa 1+). */
  ADS_R2_SIGNING_SECRET?: string;
  /** Worker secret (Etapa 9): AES key material for backup inventory encryption. */
  ADS_BACKUP_ENCRYPTION_KEY?: string;
  /** Worker secret: HMAC key for signed admin session cookies (Etapa 2). */
  ADS_SESSION_SECRET?: string;
  /** Worker secret: pepper mixed into admin password hashes (Etapa 2). */
  ADS_PASSWORD_PEPPER?: string;
  /**
   * Worker secret (Etapa 7): HMAC key for signed client RO session cookies.
   * Deliberately separate from `ADS_SESSION_SECRET` — a client session must never validate as
   * an admin session (and vice versa). Missing → client API `503 auth_not_configured`.
   */
  ADS_CLIENT_SESSION_SECRET?: string;
  /**
   * Worker secret (Etapa 7): pepper mixed into deterministic client access-code hashes
   * (SHA-256 + pepper; never store plaintext). Missing → client code issue/login `503`.
   */
  ADS_CODE_PEPPER?: string;
  /** One-time Worker secret for POST /v1/internal/bootstrap/main-admin (workflow-only; delete after success). */
  ADS_BOOTSTRAP_TOKEN?: string;
  /**
   * Worker secret (Etapa 6): bearer token for server-side calls to the Analytics Worker's
   * `/v1/ads/report`. Deliberately a separate secret from Analytics' own `ADMIN_TOKEN` config —
   * it must never be reused as (or derived from) any Ads Admin API auth secret, and vice versa
   * (see secrets.contract.md, 03-security-threat-model.md). Missing → 503 stats_not_configured.
   */
  ANALYTICS_ADMIN_TOKEN?: string;
};

/** Fields forever forbidden on Public Ad Delivery responses. */
export const PUBLIC_FORBIDDEN_KEYS = [
  "price",
  "price_cents",
  "price_ex_vat_cents",
  "vat_cents",
  "email",
  "phone",
  "contact",
  "contacts",
  "client_code",
  "access_code",
  "code_hash",
  "internal_note",
  "note_internal",
  "password",
  "password_hash",
  "token",
  "session",
  "ico",
  "dic",
  "invoice",
  "document",
  "documents",
  "admin",
] as const;

export type PublicAdCreative = {
  format: string;
  width: number;
  height: number;
  cdn_url: string;
};

export type PublicAd = {
  campaign_id: string;
  placement_id: string;
  section_id: string;
  slot_type: string;
  device_category: DeviceCategory;
  label: string;
  creative: PublicAdCreative;
  target_url: string;
  anchor: string;
};

export type PublicDeliveryResponse = {
  ads: PublicAd[];
  enabled: boolean;
  safeMode: boolean;
};

/** Admin auth/users/roles/audit (Etapa 2). */

export type AdminUserRow = {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_active: number;
  force_password_change: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
};

export type AdminSessionRow = {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
};

export type AdminUserPublic = {
  user_id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  force_password_change: boolean;
  roles: string[];
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};
