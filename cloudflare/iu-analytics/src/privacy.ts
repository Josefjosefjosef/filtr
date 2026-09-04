import {
  ALLOWED_EVENTS,
  ALLOWED_SLOT_TYPES,
  DeviceCategory,
  EventType,
  FORBIDDEN_KEYS,
  IngestEvent,
  SlotType,
} from "./types";

const ID_RE = /^[a-zA-Z0-9_.:\-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const METRIC_RE = /^[a-zA-Z0-9_.:\-]{1,48}$/;

const CRAWLER_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|bingpreview|headless|phantom|selenium|wget|curl|python-requests|scrapy/i;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function classifyDevice(ua: string | null): DeviceCategory {
  const s = String(ua || "");
  if (!s) return "unknown";
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(s)) return "tablet";
  if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(s)) return "mobile";
  if (/Windows|Macintosh|Linux|CrOS/i.test(s)) return "pc";
  return "unknown";
}

export function isCrawlerUa(ua: string | null): boolean {
  return CRAWLER_UA.test(String(ua || ""));
}

export function hasForbiddenKeys(obj: Record<string, unknown>): string | null {
  for (const k of Object.keys(obj || {})) {
    const low = k.toLowerCase();
    if ((FORBIDDEN_KEYS as readonly string[]).includes(low)) return k;
    if (low.includes("fingerprint") || low.includes("user_agent") || low === "ip") return k;
  }
  return null;
}

export function sanitizeId(v: unknown, fallback = ""): string {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  if (!ID_RE.test(s)) return "";
  return s;
}

export function sanitizeDay(v: unknown): string {
  const s = String(v ?? "").trim();
  if (DAY_RE.test(s)) return s;
  return todayUtc();
}

export function sanitizeSlotType(v: unknown): SlotType {
  const s = String(v ?? "unknown");
  if ((ALLOWED_SLOT_TYPES as readonly string[]).includes(s)) return s as SlotType;
  return "unknown";
}

export function sanitizeDevice(v: unknown, fromUa: DeviceCategory): DeviceCategory {
  const s = String(v ?? "");
  if (s === "mobile" || s === "tablet" || s === "pc" || s === "unknown") return s;
  return fromUa;
}

export type PrivacyResult =
  | { ok: true; event: IngestEvent; device: DeviceCategory }
  | { ok: false; reason: string };

/** Privacy Guard — allowlist events + strip anything identifying. Never stores UA/IP. */
export function privacyGuard(
  body: unknown,
  uaHeader: string | null
): PrivacyResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_body" };
  }
  const raw = body as Record<string, unknown>;
  const forbidden = hasForbiddenKeys(raw);
  if (forbidden) return { ok: false, reason: "forbidden_key:" + forbidden };

  const type = String(raw.type || "");
  if (!(ALLOWED_EVENTS as readonly string[]).includes(type)) {
    return { ok: false, reason: "event_not_allowlisted" };
  }

  // Client must never dictate aggregation magnitude (always server +1).
  if (Object.prototype.hasOwnProperty.call(raw, "count")) {
    return { ok: false, reason: "client_count_forbidden" };
  }

  if (isCrawlerUa(uaHeader)) {
    return { ok: false, reason: "crawler" };
  }

  const device = sanitizeDevice(raw.device_category, classifyDevice(uaHeader));
  const day = sanitizeDay(raw.day);

  const event: IngestEvent = {
    type: type as EventType,
    day,
    device_category: device,
  };

  if (type === "public_section_view" || type === "page_view") {
    const section = sanitizeId(raw.section_id, "home");
    if (!section) return { ok: false, reason: "bad_section_id" };
    event.section_id = section;
  }

  if (type === "ad_impression" || type === "ad_click") {
    const campaign_id = sanitizeId(raw.campaign_id);
    const placement_id = sanitizeId(raw.placement_id);
    if (!campaign_id || !placement_id) return { ok: false, reason: "missing_ad_ids" };
    event.campaign_id = campaign_id;
    event.placement_id = placement_id;
    event.section_id = sanitizeId(raw.section_id, "");
    event.slot_type = sanitizeSlotType(raw.slot_type);
  }

  if (type === "performance_metric") {
    const metric = String(raw.metric_name || "");
    if (!METRIC_RE.test(metric)) return { ok: false, reason: "bad_metric_name" };
    const value = Number(raw.metric_value);
    if (!Number.isFinite(value) || value < 0 || value > 60000) {
      return { ok: false, reason: "bad_metric_value" };
    }
    event.metric_name = metric;
    event.metric_value = value;
  }

  if (type === "technical_error") {
    const code = sanitizeId(raw.error_code, "unknown");
    if (!code) return { ok: false, reason: "bad_error_code" };
    event.error_code = code;
  }

  return { ok: true, event, device };
}
