/** Shared types — aggregate analytics only (no PII). */

export type DeviceCategory = "mobile" | "tablet" | "pc" | "unknown";

export const ALLOWED_EVENTS = [
  "page_view",
  "public_section_view",
  "private_tools_total_open",
  "pwa_install",
  "ad_impression",
  "ad_click",
  "performance_metric",
  "technical_error",
] as const;

export type EventType = (typeof ALLOWED_EVENTS)[number];

export const ALLOWED_SLOT_TYPES = [
  "banner",
  "sponsored_article",
  "native",
  "video",
  "partner_box",
  "recommended",
  "affiliate",
  "premium_partnership",
  "other",
  "unknown",
] as const;

export type SlotType = (typeof ALLOWED_SLOT_TYPES)[number];

export type Env = {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  PUBLIC_CACHE_SECONDS?: string;
  CORS_ALLOW_ORIGIN?: string;
};

export type IngestEvent = {
  type: EventType;
  day?: string;
  device_category?: DeviceCategory;
  section_id?: string;
  campaign_id?: string;
  placement_id?: string;
  slot_type?: string;
  metric_name?: string;
  metric_value?: number;
  error_code?: string;
};

export const FORBIDDEN_KEYS = [
  "ip",
  "ip_address",
  "user_id",
  "userid",
  "fingerprint",
  "user_agent",
  "useragent",
  "ua",
  "email",
  "phone",
  "name",
  "gps",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "payload",
  "text",
  "content",
  "note",
  "notes_body",
  "silver",
  "query",
  "raw",
  "form",
] as const;
