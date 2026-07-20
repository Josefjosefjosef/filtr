import { antiFraudGuard, suspiciousClickVsImpressions } from "./antifraud";
import { IngestEvent } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

async function bumpAudit(
  db: D1Database,
  day: string,
  field: "accepted" | "rejected" | "suspicious"
): Promise<void> {
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO ingest_audit (day, accepted, rejected, suspicious, updated_at)
       VALUES (?, 0, 0, 0, ?)
       ON CONFLICT(day) DO UPDATE SET updated_at = excluded.updated_at`
    )
    .bind(day, ts)
    .run();
  await db
    .prepare(`UPDATE ingest_audit SET ${field} = ${field} + 1, updated_at = ? WHERE day = ?`)
    .bind(ts, day)
    .run();
}

export async function applyEvent(
  db: D1Database,
  event: IngestEvent,
  opts: { suspiciousClick?: boolean } = {}
): Promise<{ ok: boolean; suspicious: boolean }> {
  const day = event.day || new Date().toISOString().slice(0, 10);
  const device = event.device_category || "unknown";
  const ts = nowIso();
  const fraud = antiFraudGuard(event);
  const suspicious = !!(opts.suspiciousClick || fraud.suspicious);

  if (event.type === "page_view") {
    await db
      .prepare(
        `INSERT INTO daily_traffic (day, device_category, visits, page_views, public_section_views, private_tools_opens, updated_at)
         VALUES (?, ?, 1, 1, 0, 0, ?)
         ON CONFLICT(day, device_category) DO UPDATE SET
           visits = visits + 1,
           page_views = page_views + 1,
           updated_at = excluded.updated_at`
      )
      .bind(day, device, ts)
      .run();
  }

  if (event.type === "public_section_view") {
    const section = event.section_id || "home";
    await db
      .prepare(
        `INSERT INTO daily_traffic (day, device_category, visits, page_views, public_section_views, private_tools_opens, updated_at)
         VALUES (?, ?, 0, 0, 1, 0, ?)
         ON CONFLICT(day, device_category) DO UPDATE SET
           public_section_views = public_section_views + 1,
           updated_at = excluded.updated_at`
      )
      .bind(day, device, ts)
      .run();
    await db
      .prepare(
        `INSERT INTO daily_sections (day, section_id, views, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(day, section_id) DO UPDATE SET
           views = views + 1,
           updated_at = excluded.updated_at`
      )
      .bind(day, section, ts)
      .run();
  }

  if (event.type === "private_tools_total_open") {
    await db
      .prepare(
        `INSERT INTO daily_traffic (day, device_category, visits, page_views, public_section_views, private_tools_opens, updated_at)
         VALUES (?, ?, 0, 0, 0, 1, ?)
         ON CONFLICT(day, device_category) DO UPDATE SET
           private_tools_opens = private_tools_opens + 1,
           updated_at = excluded.updated_at`
      )
      .bind(day, device, ts)
      .run();
  }

  if (event.type === "performance_metric" && event.metric_name) {
    await db
      .prepare(
        `INSERT INTO daily_performance (day, metric_name, sample_count, value_sum, updated_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(day, metric_name) DO UPDATE SET
           sample_count = sample_count + 1,
           value_sum = value_sum + excluded.value_sum,
           updated_at = excluded.updated_at`
      )
      .bind(day, event.metric_name, Number(event.metric_value || 0), ts)
      .run();
  }

  if (event.type === "technical_error") {
    await db
      .prepare(
        `INSERT INTO daily_errors (day, error_code, count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(day, error_code) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at`
      )
      .bind(day, event.error_code || "unknown", ts)
      .run();
  }

  if (event.type === "ad_impression" || event.type === "ad_click") {
    const campaign_id = event.campaign_id || "";
    const placement_id = event.placement_id || "";
    const section_id = event.section_id || "";
    const slot_type = event.slot_type || "unknown";
    const imp = event.type === "ad_impression" ? 1 : 0;
    let clicks = event.type === "ad_click" ? 1 : 0;
    let valid = 0;
    let sus = 0;
    if (event.type === "ad_click") {
      if (suspicious) sus = 1;
      else valid = 1;
    }

    const existing = await db
      .prepare(
        `SELECT impressions, clicks FROM daily_ads
         WHERE day = ? AND campaign_id = ? AND placement_id = ? AND section_id = ? AND slot_type = ? AND device_category = ?`
      )
      .bind(day, campaign_id, placement_id, section_id, slot_type, device)
      .first<{ impressions: number; clicks: number }>();

    if (
      event.type === "ad_click" &&
      existing &&
      suspiciousClickVsImpressions(existing.impressions, existing.clicks + 1)
    ) {
      sus = 1;
      valid = 0;
    }

    await db
      .prepare(
        `INSERT INTO daily_ads (
           day, campaign_id, placement_id, section_id, slot_type, device_category,
           impressions, clicks, valid_clicks, suspicious_clicks, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, campaign_id, placement_id, section_id, slot_type, device_category) DO UPDATE SET
           impressions = impressions + excluded.impressions,
           clicks = clicks + excluded.clicks,
           valid_clicks = valid_clicks + excluded.valid_clicks,
           suspicious_clicks = suspicious_clicks + excluded.suspicious_clicks,
           updated_at = excluded.updated_at`
      )
      .bind(
        day,
        campaign_id,
        placement_id,
        section_id,
        slot_type,
        device,
        imp,
        clicks,
        valid,
        sus,
        ts
      )
      .run();
  }

  await bumpAudit(db, day, suspicious ? "suspicious" : "accepted");
  return { ok: true, suspicious };
}

export async function rejectEvent(db: D1Database, day: string): Promise<void> {
  await bumpAudit(db, day, "rejected");
}
