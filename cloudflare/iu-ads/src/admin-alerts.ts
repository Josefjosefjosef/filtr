/**
 * Admin alerts lifecycle (Etapa 8, kap. 19). CRUD-lite: list/get/ack/resolve + generate.
 * Etapa 9: Cron calls `generateAlertsBatch` via Worker `scheduled` handler.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { clampLimit, clampOffset } from "./admin-list-filters";
import type { Env } from "./types";

const ALERT_STATUSES = ["new", "read", "resolved"] as const;
type AlertStatus = (typeof ALERT_STATUSES)[number];

function isAlertStatus(value: unknown): value is AlertStatus {
  return typeof value === "string" && (ALERT_STATUSES as readonly string[]).includes(value);
}

type AlertRow = {
  alert_id: string;
  alert_type: string;
  status: string;
  object_type: string | null;
  object_id: string | null;
  assignee_user_id: string | null;
  message: string;
  created_at: string;
  resolved_at: string | null;
};

const ALERT_COLUMNS =
  "alert_id, alert_type, status, object_type, object_id, assignee_user_id, message, created_at, resolved_at";

function serializeAlert(row: AlertRow) {
  return {
    alert_id: row.alert_id,
    alert_type: row.alert_type,
    status: row.status,
    object_type: row.object_type,
    object_id: row.object_id,
    assignee_user_id: row.assignee_user_id,
    message: row.message,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  };
}

async function loadSettingInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  } catch {
    return fallback;
  }
}

export async function handleListAlerts(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "alerts.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const alertType = url.searchParams.get("alert_type");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) {
    if (!isAlertStatus(status)) return json({ error: "invalid_status" }, 400);
    conditions.push("status = ?");
    params.push(status);
  }
  if (alertType) {
    conditions.push("alert_type = ?");
    params.push(alertType);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(limit, offset);

  const res = await env.DB.prepare(
    "SELECT " + ALERT_COLUMNS + " FROM alerts " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<AlertRow>();
  return json({ alerts: (res.results || []).map(serializeAlert), limit, offset });
}

export async function handleGetAlert(request: Request, env: Env, alertId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "alerts.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + ALERT_COLUMNS + " FROM alerts WHERE alert_id = ?")
    .bind(alertId)
    .first<AlertRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ alert: serializeAlert(row) });
}

export async function handleAckAlert(request: Request, env: Env, alertId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "alerts.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + ALERT_COLUMNS + " FROM alerts WHERE alert_id = ?")
    .bind(alertId)
    .first<AlertRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.status === "resolved") return json({ error: "already_resolved" }, 409);
  if (before.status === "read") return json({ alert: serializeAlert(before), ack: false });

  await env.DB.prepare("UPDATE alerts SET status = 'read' WHERE alert_id = ?").bind(alertId).run();
  const after = await env.DB.prepare("SELECT " + ALERT_COLUMNS + " FROM alerts WHERE alert_id = ?")
    .bind(alertId)
    .first<AlertRow>();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "alert_acked",
      objectType: "alert",
      objectId: alertId,
      before: { status: before.status },
      after: { status: "read" },
      result: "success",
    })
  );
  return json({ alert: after ? serializeAlert(after) : null, ack: true });
}

export async function handleResolveAlert(request: Request, env: Env, alertId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "alerts.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const before = await env.DB.prepare("SELECT " + ALERT_COLUMNS + " FROM alerts WHERE alert_id = ?")
    .bind(alertId)
    .first<AlertRow>();
  if (!before) return json({ error: "not_found" }, 404);
  if (before.status === "resolved") return json({ error: "already_resolved" }, 409);

  const nowIso = new Date().toISOString();
  await env.DB.prepare("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE alert_id = ?")
    .bind(nowIso, alertId)
    .run();
  const after = await env.DB.prepare("SELECT " + ALERT_COLUMNS + " FROM alerts WHERE alert_id = ?")
    .bind(alertId)
    .first<AlertRow>();
  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "alert_resolved",
      objectType: "alert",
      objectId: alertId,
      before: { status: before.status },
      after: { status: "resolved", resolved_at: nowIso },
      result: "success",
    })
  );
  return json({ alert: after ? serializeAlert(after) : null });
}

export type GenerateAlertsResult = {
  created: number;
  ending_days: number;
  rules: readonly string[];
};

/**
 * Best-effort seed rules. Idempotent-ish: skips when an open alert of the same type
 * already exists for the object. Used by Admin POST and by Cron `scheduled`.
 */
export async function generateAlertsBatch(
  db: D1Database,
  actorUserId: string
): Promise<GenerateAlertsResult> {
  const endingDays = await loadSettingInt(db, "ALERT_CAMPAIGN_ENDING_DAYS", 7);
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + endingDays * 86400000).toISOString();
  let created = 0;

  const ending = await db
    .prepare(
      "SELECT campaign_id, title, end_at FROM campaigns WHERE status IN ('active','scheduled') AND end_at IS NOT NULL AND end_at >= ? AND end_at <= ?"
    )
    .bind(nowIso, untilIso)
    .all<{ campaign_id: string; title: string; end_at: string }>();

  for (const camp of ending.results || []) {
    const existing = await db
      .prepare(
        "SELECT alert_id FROM alerts WHERE alert_type = 'campaign_ending_soon' AND object_id = ? AND status IN ('new','read') LIMIT 1"
      )
      .bind(camp.campaign_id)
      .first();
    if (existing) continue;
    const alertId = newId("alt");
    await db
      .prepare(
        "INSERT INTO alerts (alert_id, alert_type, status, object_type, object_id, assignee_user_id, message, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,NULL)"
      )
      .bind(
        alertId,
        "campaign_ending_soon",
        "new",
        "campaign",
        camp.campaign_id,
        null,
        "Campaign ending soon: " + camp.title + " (" + camp.end_at + ")",
        nowIso
      )
      .run();
    created += 1;
  }

  const missingRights = await db
    .prepare(
      `SELECT c.campaign_id, c.title FROM campaigns c
     WHERE c.status IN ('active','scheduled','approved')
       AND NOT EXISTS (SELECT 1 FROM rights_confirmations rc WHERE rc.campaign_id = c.campaign_id)`
    )
    .all<{ campaign_id: string; title: string }>();

  for (const camp of missingRights.results || []) {
    const existing = await db
      .prepare(
        "SELECT alert_id FROM alerts WHERE alert_type = 'rights_missing' AND object_id = ? AND status IN ('new','read') LIMIT 1"
      )
      .bind(camp.campaign_id)
      .first();
    if (existing) continue;
    const alertId = newId("alt");
    await db
      .prepare(
        "INSERT INTO alerts (alert_id, alert_type, status, object_type, object_id, assignee_user_id, message, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,NULL)"
      )
      .bind(
        alertId,
        "rights_missing",
        "new",
        "campaign",
        camp.campaign_id,
        null,
        "Rights confirmation missing for campaign: " + camp.title,
        nowIso
      )
      .run();
    created += 1;
  }

  await insertAuditLog(
    db,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId,
      operation: "alerts_generated",
      objectType: "alert",
      objectId: "batch",
      before: null,
      after: { created, ending_days: endingDays },
      result: "success",
    })
  );

  return {
    created,
    ending_days: endingDays,
    rules: ["campaign_ending_soon", "rights_missing"],
  };
}

export async function handleGenerateAlerts(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "alerts.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const result = await generateAlertsBatch(env.DB, guard.userId);
  return json({
    created: result.created,
    rules: result.rules,
    cron: "wired_etapa_9",
  });
}

/** Cron entrypoint (Etapa 9). Honours ALERT_CRON_ENABLED system_setting (default on). */
export async function runAlertsCron(env: Env): Promise<GenerateAlertsResult | { skipped: true; reason: string }> {
  if (!env.DB) return { skipped: true, reason: "db_unbound" };
  try {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = ?")
      .bind("ALERT_CRON_ENABLED")
      .first<{ value: string }>();
    if (row && String(row.value).toLowerCase() === "false") {
      return { skipped: true, reason: "ALERT_CRON_ENABLED=false" };
    }
  } catch {
    /* fail-open for cron enable flag — still attempt generate */
  }
  return generateAlertsBatch(env.DB, "system:cron");
}
