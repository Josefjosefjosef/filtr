import { IngestEvent } from "./types";

/** In-memory burst counters (per isolate). Not persisted — no IP storage. */
const clickBursts = new Map<string, { n: number; t: number }>();

const BURST_WINDOW_MS = 10_000;
const BURST_CLICK_LIMIT = 8;

export type FraudResult = {
  suspicious: boolean;
  reason?: string;
};

/**
 * Anti Fraud Guard — aggregate heuristics only.
 * Does NOT store IP, fingerprint, or profiles.
 */
export function antiFraudGuard(event: IngestEvent): FraudResult {
  if (event.type !== "ad_click") return { suspicious: false };

  const key = [
    event.campaign_id || "",
    event.placement_id || "",
    event.day || "",
  ].join("|");

  const now = Date.now();
  const cur = clickBursts.get(key);
  if (!cur || now - cur.t > BURST_WINDOW_MS) {
    clickBursts.set(key, { n: 1, t: now });
    return { suspicious: false };
  }
  cur.n += 1;
  if (cur.n > BURST_CLICK_LIMIT) {
    return { suspicious: true, reason: "click_burst" };
  }
  return { suspicious: false };
}

/** Mark clicks as suspicious when clicks would exceed impressions + margin in same row. */
export function suspiciousClickVsImpressions(impressions: number, clicks: number): boolean {
  if (impressions <= 0 && clicks > 0) return true;
  if (clicks > impressions * 2 + 5) return true;
  return false;
}
