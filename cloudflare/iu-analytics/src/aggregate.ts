import { antiFraudGuard, suspiciousClickVsImpressions } from "./antifraud";
import { AnalyticsStore } from "./store";
import { IngestEvent } from "./types";

export async function applyEvent(
  store: AnalyticsStore,
  event: IngestEvent
): Promise<{ ok: boolean; suspicious: boolean }> {
  const day = event.day || new Date().toISOString().slice(0, 10);
  const device = event.device_category || "unknown";
  const fraud = antiFraudGuard(event);
  let suspicious = !!fraud.suspicious;

  if (event.type === "page_view") {
    await store.bumpTraffic(day, device, { visits: 1, page_views: 1 });
  }

  if (event.type === "public_section_view") {
    await store.bumpTraffic(day, device, { public_section_views: 1 });
    await store.bumpSection(day, event.section_id || "home", 1);
  }

  if (event.type === "private_tools_total_open") {
    await store.bumpTraffic(day, device, { private_tools_opens: 1 });
  }

  // Standalone metric: never bumps visits / page_views / sections / private_tools.
  if (event.type === "pwa_install") {
    await store.bumpTraffic(day, device, { pwa_installs: 1 });
  }

  if (event.type === "performance_metric" && event.metric_name) {
    await store.bumpPerf(day, event.metric_name, Number(event.metric_value || 0));
  }

  if (event.type === "technical_error") {
    await store.bumpError(day, event.error_code || "unknown");
  }

  if (event.type === "ad_impression" || event.type === "ad_click") {
    const keys = {
      campaign_id: event.campaign_id || "",
      placement_id: event.placement_id || "",
      section_id: event.section_id || "",
      slot_type: event.slot_type || "unknown",
      device_category: device,
    };
    const imp = event.type === "ad_impression" ? 1 : 0;
    let clicks = event.type === "ad_click" ? 1 : 0;
    let valid = 0;
    let sus = 0;
    if (event.type === "ad_click") {
      if (suspicious) sus = 1;
      else valid = 1;
    }
    const after = await store.bumpAd(day, keys, {
      impressions: imp,
      clicks,
      valid_clicks: valid,
      suspicious_clicks: sus,
    });
    if (
      event.type === "ad_click" &&
      !suspicious &&
      suspiciousClickVsImpressions(after.impressions, after.clicks)
    ) {
      suspicious = true;
      await store.bumpAd(day, keys, { valid_clicks: -valid, suspicious_clicks: 1 });
    }
  }

  await store.bumpAudit(day, suspicious ? "suspicious" : "accepted");
  return { ok: true, suspicious };
}

export async function rejectEvent(store: AnalyticsStore, day: string): Promise<void> {
  await store.bumpAudit(day, "rejected");
}
