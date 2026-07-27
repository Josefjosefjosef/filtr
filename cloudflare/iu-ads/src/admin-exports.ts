/**
 * Admin export jobs (Etapa 3/24 + kap. 38 export formats).
 * Creates a job row AND synchronously materializes JSON/CSV into R2 BACKUPS (private).
 * Stub "queued forever" is removed — status becomes completed|failed.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import type { Env } from "./types";

export const EXPORT_SCOPE_TYPES = ["client", "campaign", "invoices", "audit", "order"] as const;
export type ExportScopeType = (typeof EXPORT_SCOPE_TYPES)[number];

export const EXPORT_FORMATS = ["json", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

function isExportScopeType(value: unknown): value is ExportScopeType {
  return typeof value === "string" && (EXPORT_SCOPE_TYPES as readonly string[]).includes(value);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

type ExportJobRow = {
  export_id: string;
  requested_by: string;
  scope_type: string;
  scope_id: string | null;
  period_from: string | null;
  period_to: string | null;
  status: string;
  r2_key: string | null;
  created_at: string;
  completed_at: string | null;
};

const EXPORT_COLUMNS =
  "export_id, requested_by, scope_type, scope_id, period_from, period_to, status, r2_key, created_at, completed_at";

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.floor(n));
}

function clampOffset(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function isTestCampaign(row: Record<string, unknown>): boolean {
  const id = String(row.campaign_id || "");
  const evidence = String(row.evidence_code || "");
  const title = String(row.title || "");
  return (
    id.startsWith("test_") ||
    id.startsWith("=test_") ||
    id.startsWith("IU_TEST_") ||
    evidence.startsWith("EV-TEST") ||
    title.includes("IU_TEST_") ||
    title.startsWith("TEST_")
  );
}

/** CSV injection: quote cells that look like formulas / need escaping. */
export function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  const needsQuote = /[",\n\r\t]/.test(s) || /^[=+\-@\t\r]/.test(s);
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

type ExportPayload = {
  generated_at: string;
  scope_type: string;
  scope_id: string | null;
  period_from: string | null;
  period_to: string | null;
  excluded_test_campaigns: number;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, number>;
};

async function buildExportPayload(
  env: Env,
  opts: {
    scopeType: ExportScopeType;
    scopeId: string | null;
    periodFrom: string | null;
    periodTo: string | null;
  }
): Promise<ExportPayload> {
  const db = env.DB!;
  const generated_at = new Date().toISOString();
  let excluded = 0;
  const rows: Array<Record<string, unknown>> = [];

  if (opts.scopeType === "client") {
    let sql =
      "SELECT campaign_id, evidence_code, client_id, title, status, label_type, start_at, end_at, price_cents, devices_json, sections_json, regions_json FROM campaigns";
    const params: unknown[] = [];
    if (opts.scopeId) {
      sql += " WHERE client_id = ?";
      params.push(opts.scopeId);
    }
    sql += " ORDER BY created_at DESC LIMIT 500";
    const res = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    for (const c of res.results || []) {
      if (isTestCampaign(c)) {
        excluded++;
        continue;
      }
      rows.push({
        campaign_id: c.campaign_id,
        evidence_code: c.evidence_code,
        client_id: c.client_id,
        title: c.title,
        status: c.status,
        label_type: c.label_type,
        start_at: c.start_at,
        end_at: c.end_at,
        price_cents: c.price_cents,
        devices_json: c.devices_json,
        sections_json: c.sections_json,
        regions_json: c.regions_json,
      });
    }
  } else if (opts.scopeType === "campaign") {
    if (!opts.scopeId) throw new Error("scope_id_required");
    const c = await db
      .prepare(
        "SELECT campaign_id, evidence_code, client_id, title, status, label_type, start_at, end_at, price_cents, devices_json, sections_json, regions_json, order_id FROM campaigns WHERE campaign_id = ?"
      )
      .bind(opts.scopeId)
      .first<Record<string, unknown>>();
    if (!c) throw new Error("campaign_not_found");
    if (isTestCampaign(c)) throw new Error("test_campaign_excluded");
    rows.push(c);
    const placements = await db
      .prepare(
        "SELECT campaign_placement_id, placement_id, placement_type_id, section_id, device_category, status, priority, start_at, end_at FROM campaign_placements WHERE campaign_id = ?"
      )
      .bind(opts.scopeId)
      .all<Record<string, unknown>>();
    for (const p of placements.results || []) {
      rows.push({ kind: "placement", ...p });
    }
  } else if (opts.scopeType === "order") {
    if (!opts.scopeId) throw new Error("scope_id_required");
    const order = await db
      .prepare(
        "SELECT order_id, client_id, order_number, status, ordered_by, payer, contact_person, created_at FROM orders WHERE order_id = ?"
      )
      .bind(opts.scopeId)
      .first<Record<string, unknown>>();
    if (!order) throw new Error("order_not_found");
    rows.push(order);
  } else if (opts.scopeType === "invoices") {
    let sql =
      "SELECT invoice_id, client_id, order_id, campaign_id, invoice_number, status, total_cents, currency, issued_at, due_at, paid_at FROM invoices";
    const params: unknown[] = [];
    if (opts.scopeId) {
      sql += " WHERE client_id = ?";
      params.push(opts.scopeId);
    }
    sql += " ORDER BY created_at DESC LIMIT 500";
    const res = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    rows.push(...(res.results || []));
  } else if (opts.scopeType === "audit") {
    let sql =
      "SELECT audit_id, created_at, actor_user_id, operation, object_type, object_id, result FROM audit_logs";
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (opts.periodFrom) {
      conditions.push("created_at >= ?");
      params.push(opts.periodFrom);
    }
    if (opts.periodTo) {
      conditions.push("created_at <= ?");
      params.push(opts.periodTo);
    }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC LIMIT 500";
    const res = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
    rows.push(...(res.results || []));
  }

  return {
    generated_at,
    scope_type: opts.scopeType,
    scope_id: opts.scopeId,
    period_from: opts.periodFrom,
    period_to: opts.periodTo,
    excluded_test_campaigns: excluded,
    rows,
  };
}

function serializeJob(row: ExportJobRow) {
  return {
    export_id: row.export_id,
    requested_by: row.requested_by,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    period_from: row.period_from,
    period_to: row.period_to,
    status: row.status,
    r2_key: row.r2_key,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

export async function handleListExportJobs(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const status = url.searchParams.get("status");
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));

  const where = status ? "WHERE status = ?" : "";
  const params: unknown[] = status ? [status, limit, offset] : [limit, offset];

  const res = await env.DB.prepare(
    "SELECT " + EXPORT_COLUMNS + " FROM export_jobs " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(...params)
    .all<ExportJobRow>();
  return json({ exports: (res.results || []).map(serializeJob), limit, offset });
}

export async function handleCreateExportJob(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  let body: {
    scope_type?: unknown;
    scope_id?: unknown;
    period_from?: unknown;
    period_to?: unknown;
    format?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!isExportScopeType(body.scope_type)) return json({ error: "invalid_scope_type" }, 400);
  const format: ExportFormat = isExportFormat(body.format) ? body.format : "json";
  if (body.format !== undefined && !isExportFormat(body.format)) return json({ error: "invalid_format" }, 400);

  const scopeId = typeof body.scope_id === "string" ? body.scope_id : null;
  const periodFrom = typeof body.period_from === "string" ? body.period_from : null;
  const periodTo = typeof body.period_to === "string" ? body.period_to : null;
  const nowIso = new Date().toISOString();
  const exportId = newId("exp");

  await env.DB.prepare(
    "INSERT INTO export_jobs (export_id, requested_by, scope_type, scope_id, period_from, period_to, status, r2_key, created_at, completed_at) VALUES (?,?,?,?,?,?,'processing',NULL,?,NULL)"
  )
    .bind(exportId, guard.userId, body.scope_type, scopeId, periodFrom, periodTo, nowIso)
    .run();

  let status = "completed";
  let r2Key: string | null = null;
  let completedAt: string | null = nowIso;
  let failReason: string | null = null;

  try {
    const payload = await buildExportPayload(env, {
      scopeType: body.scope_type,
      scopeId,
      periodFrom,
      periodTo,
    });

    let bytes: Uint8Array;
    let contentType: string;
    if (format === "csv") {
      const headers =
        payload.rows.length > 0
          ? Object.keys(payload.rows[0])
          : ["generated_at", "scope_type", "scope_id", "note"];
      const csvRows =
        payload.rows.length > 0
          ? payload.rows
          : [{ generated_at: payload.generated_at, scope_type: payload.scope_type, scope_id: payload.scope_id, note: "empty" }];
      const csv =
        "# iu-ads-export charset=utf-8\n" +
        "# excluded_test_campaigns=" +
        String(payload.excluded_test_campaigns) +
        "\n" +
        rowsToCsv(headers, csvRows);
      bytes = new TextEncoder().encode(csv);
      contentType = "text/csv; charset=utf-8";
      r2Key = "exports/" + exportId + ".csv";
    } else {
      bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
      contentType = "application/json; charset=utf-8";
      r2Key = "exports/" + exportId + ".json";
    }

    if (!env.BACKUPS) {
      // Fail closed for durable storage — still keep job row as failed (no silent stub success).
      throw new Error("backups_unbound");
    }
    await env.BACKUPS.put(r2Key, bytes, { httpMetadata: { contentType } });
  } catch (e) {
    status = "failed";
    r2Key = null;
    completedAt = new Date().toISOString();
    failReason = e instanceof Error ? e.message : "export_failed";
  }

  await env.DB.prepare(
    "UPDATE export_jobs SET status = ?, r2_key = ?, completed_at = ? WHERE export_id = ?"
  )
    .bind(status, r2Key, completedAt, exportId)
    .run();

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: status === "completed" ? "export_completed" : "export_failed",
      objectType: "export_job",
      objectId: exportId,
      after: {
        scope_type: body.scope_type,
        scope_id: scopeId,
        format,
        status,
        r2_key: r2Key,
        reason: failReason,
      },
      result: status === "completed" ? "success" : "failure",
    })
  );

  const row = await env.DB.prepare("SELECT " + EXPORT_COLUMNS + " FROM export_jobs WHERE export_id = ?")
    .bind(exportId)
    .first<ExportJobRow>();
  if (status === "failed") {
    return json({ export: row ? serializeJob(row) : null, error: failReason || "export_failed" }, 500);
  }
  return json({ export: row ? serializeJob(row) : null, format }, 201);
}

export async function handleGetExportJob(request: Request, env: Env, exportId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + EXPORT_COLUMNS + " FROM export_jobs WHERE export_id = ?")
    .bind(exportId)
    .first<ExportJobRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ export: serializeJob(row) });
}

export async function handleDownloadExportJob(request: Request, env: Env, exportId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "exports.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);
  if (!env.BACKUPS) return json({ error: "backups_unbound" }, 503);

  const row = await env.DB.prepare("SELECT " + EXPORT_COLUMNS + " FROM export_jobs WHERE export_id = ?")
    .bind(exportId)
    .first<ExportJobRow>();
  if (!row) return json({ error: "not_found" }, 404);
  if (row.status !== "completed" || !row.r2_key) return json({ error: "export_not_ready", status: row.status }, 409);

  const obj = await env.BACKUPS.get(row.r2_key);
  if (!obj) return json({ error: "export_object_missing" }, 404);

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "export_downloaded",
      objectType: "export_job",
      objectId: exportId,
      after: { r2_key: row.r2_key },
      result: "success",
    })
  );

  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  const ct = obj.httpMetadata?.contentType || (row.r2_key.endsWith(".csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
  headers.set("Content-Type", ct);
  const filename = row.r2_key.split("/").pop() || "export.bin";
  headers.set("Content-Disposition", 'attachment; filename="' + filename + '"');
  return new Response(obj.body, { status: 200, headers });
}
