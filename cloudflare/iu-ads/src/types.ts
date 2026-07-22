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
