export type DeviceCategory = "pc" | "mobile" | "tablet";

export type Env = {
  DB?: D1Database;
  CREATIVES?: R2Bucket;
  DOCUMENTS?: R2Bucket;
  ADS_SAFE_MODE?: string;
  ADS_PUBLIC_DELIVERY_ENABLED?: string;
  ADS_ADMIN_API_ENABLED?: string;
  ADS_CLIENT_API_ENABLED?: string;
  CORS_ALLOW_ORIGIN?: string;
  /** Worker secret for short-lived private object access signatures (Etapa 1+). */
  ADS_R2_SIGNING_SECRET?: string;
  /** Worker secret: HMAC key for signed admin session cookies (Etapa 2). */
  ADS_SESSION_SECRET?: string;
  /** Worker secret: pepper mixed into admin password hashes (Etapa 2). */
  ADS_PASSWORD_PEPPER?: string;
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
