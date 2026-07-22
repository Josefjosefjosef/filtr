import { PUBLIC_FORBIDDEN_KEYS, type PublicAd, type PublicDeliveryResponse } from "./types";

export function assertNoForbiddenPublicKeys(payload: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path + "[" + i + "]"));
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      for (const forbidden of PUBLIC_FORBIDDEN_KEYS) {
        if (lower === forbidden || lower.startsWith(forbidden + "_")) {
          hits.push(path ? path + "." + k : k);
        }
      }
      walk(v, path ? path + "." + k : k);
    }
  };
  walk(payload, "");
  return hits;
}

export function emptyPublicDelivery(enabled: boolean, safeMode: boolean): PublicDeliveryResponse {
  return { ads: [], enabled, safeMode };
}

export function sanitizePublicAds(ads: PublicAd[]): PublicAd[] {
  return ads.map((ad) => ({
    campaign_id: String(ad.campaign_id),
    placement_id: String(ad.placement_id),
    section_id: String(ad.section_id || ""),
    slot_type: String(ad.slot_type || "unknown"),
    device_category: ad.device_category,
    label: String(ad.label),
    creative: {
      format: String(ad.creative.format),
      width: Number(ad.creative.width) || 0,
      height: Number(ad.creative.height) || 0,
      cdn_url: String(ad.creative.cdn_url),
    },
    target_url: String(ad.target_url),
    anchor: String(ad.anchor),
  }));
}

/** Analytics aggregate table names must never appear in iu-ads schema SQL. */
export const ANALYTICS_ONLY_TABLES = [
  "daily_traffic",
  "daily_sections",
  "daily_performance",
  "daily_errors",
  "daily_ads",
  "ingest_audit",
] as const;
