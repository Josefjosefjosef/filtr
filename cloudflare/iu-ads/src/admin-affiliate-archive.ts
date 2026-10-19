/**
 * Admin: Archiv reklam – Affiliate (CJ). Separate from premium paid placements.
 * RBAC: audit.read (list/detail/evidence), exports.read (export bundle).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, requireAdminPermission } from "./admin-auth";
import { buildAffiliateArchiveExportZip } from "./affiliate-ad-archive-zip";
import {
  getAffiliateArchiveRecord,
  insertAffiliateArchiveRecordAtomic,
  listAffiliateArchiveRecords,
  listAffiliateArchiveVersions,
} from "./affiliate-ad-archive-lib";
import { sanitizeZipFilenamePart } from "./admin-pdf-zip";
import type { Env } from "./types";

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

function parseIsoDateBound(raw: unknown, endOfDay: boolean): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  if (endOfDay) return new Date(t + 86400000 - 1).toISOString();
  return new Date(t).toISOString();
}

export async function handleListAffiliateArchive(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "audit.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const partner = url.searchParams.get("partner");
  const adType = url.searchParams.get("ad_type");
  const placement = url.searchParams.get("placement_key");
  const testParam = url.searchParams.get("is_test");
  const isTest = testParam === "1" ? true : testParam === "0" ? false : undefined;
  const endedParam = url.searchParams.get("ended");
  const ended = endedParam === "active" || endedParam === "ended" ? endedParam : "all";
  const rows = await listAffiliateArchiveRecords(env, {
    partner: partner || undefined,
    adType: adType || undefined,
    placementKey: placement || undefined,
    isTest,
    ended,
    publishedFrom: parseIsoDateBound(url.searchParams.get("published_from"), false) ?? undefined,
    publishedTo: parseIsoDateBound(url.searchParams.get("published_to"), true) ?? undefined,
    limit: clampLimit(url.searchParams.get("limit")),
    offset: clampOffset(url.searchParams.get("offset")),
  });
  return json({
    section: "affiliate_ad_archive",
    label_cs: "Archiv reklam – Affiliate",
    records: rows,
    evidence_action: "GET /v1/admin/affiliate-archive/{record_id}/evidence",
    export_action: "GET /v1/admin/affiliate-archive/{record_id}/export",
    bulk_export_action: "POST /v1/admin/affiliate-archive/export/bulk",
  });
}

export async function handleGetAffiliateArchive(request: Request, env: Env, recordId: string): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "audit.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const record = await getAffiliateArchiveRecord(env, recordId);
  if (!record) return json({ error: "not_found" }, 404);
  const versions = await listAffiliateArchiveVersions(env, recordId);
  return json({
    record,
    versions,
    actions: {
      show_evidence: `/v1/admin/affiliate-archive/${recordId}/evidence`,
      export_bundle: `/v1/admin/affiliate-archive/${recordId}/export`,
    },
  });
}

export async function handleGetAffiliateArchiveEvidence(
  request: Request,
  env: Env,
  recordId: string
): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "audit.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const record = await getAffiliateArchiveRecord(env, recordId);
  if (!record) return json({ error: "not_found" }, 404);
  return json({
    record_id: recordId,
    is_test: record.is_test,
    evidence: record.evidence,
    gate_decision: record.gate_decision,
    snapshot: record.snapshot,
    content_hash: record.content_hash,
    versions: await listAffiliateArchiveVersions(env, recordId),
  });
}

async function buildSummaryPdfText(record: Awaited<ReturnType<typeof getAffiliateArchiveRecord>>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = [
    "InfoUzel – Archiv reklam Affiliate (export)",
    record?.is_test ? "TESTOVACI ZAZNAM – neni skutecne zverejneni" : "Zverejnena verze (archiv)",
    `Partner: ${record?.partner_name ?? ""}`,
    `Typ: ${record?.ad_type ?? ""}`,
    `Hash: ${record?.content_hash ?? ""}`,
    `Publikovano: ${record?.published_at ?? ""}`,
    `Ukonceno: ${record?.ended_at ?? ""}`,
    "",
    "Dukazy a rozhodnuti brany jsou v exportnim JSON/CSV.",
  ];
  let y = 800;
  for (const line of lines) {
    page.drawText(line.slice(0, 90), { x: 50, y, size: 11, font });
    y -= 16;
  }
  return pdf.save();
}

export async function handleExportAffiliateArchive(
  request: Request,
  env: Env,
  recordId: string
): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "exports.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const record = await getAffiliateArchiveRecord(env, recordId);
  if (!record) return json({ error: "not_found" }, 404);
  const versions = await listAffiliateArchiveVersions(env, recordId);
  const pdfBytes = await buildSummaryPdfText(record);
  const zip = await buildAffiliateArchiveExportZip({ record, versions, pdfBytes });
  const fname = sanitizeZipFilenamePart("affiliate-archive-" + recordId) + ".zip";
  await insertAuditLog(
    env,
    buildAuditEntry({
      actor: auth.context.userId,
      action: "affiliate_archive.export",
      target_type: "affiliate_ad_archive",
      target_id: recordId,
      detail: { content_hash: record.content_hash, is_test: record.is_test, format: "zip" },
    })
  );
  return new Response(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="' + fname + '"',
      "Cache-Control": "private, no-store",
    },
  });
}

export async function handleBulkExportAffiliateArchive(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "exports.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const recordIds = Array.isArray(body.record_ids) ? body.record_ids.map(String).slice(0, 50) : [];
  const filters = {
    partner: body.partner ? String(body.partner) : undefined,
    adType: body.ad_type ? String(body.ad_type) : undefined,
    placementKey: body.placement_key ? String(body.placement_key) : undefined,
    isTest: body.is_test === true ? true : body.is_test === false ? false : undefined,
    publishedFrom: parseIsoDateBound(body.published_from, false) ?? undefined,
    publishedTo: parseIsoDateBound(body.published_to, true) ?? undefined,
    ended:
      body.ended === "active" || body.ended === "ended"
        ? (body.ended as "active" | "ended")
        : ("all" as const),
    limit: Math.min(50, Number(body.limit) || 25),
    offset: 0,
  };

  let targets: string[] = recordIds;
  if (!targets.length) {
    const rows = await listAffiliateArchiveRecords(env, filters);
    targets = rows.map((r) => r.record_id);
  }
  if (!targets.length) {
    return json({ error: "no_records", message_cs: "Pro export nejsou žádné záznamy." }, 404);
  }
  if (targets.length > 50) {
    return json(
      {
        error: "export_limit",
        message_cs: "Export je omezen na 50 reklam najednou — zpřesněte filtr.",
        limit: 50,
        matched: targets.length,
      },
      413
    );
  }

  const { buildZipArchive } = await import("./affiliate-ad-archive-zip");
  const entries: { path: string; bytes: Uint8Array }[] = [];
  for (const id of targets) {
    const record = await getAffiliateArchiveRecord(env, id);
    if (!record) continue;
    const versions = await listAffiliateArchiveVersions(env, id);
    const pdfBytes = await buildSummaryPdfText(record);
    const inner = await buildAffiliateArchiveExportZip({ record, versions, pdfBytes });
    entries.push({ path: sanitizeZipFilenamePart(id) + ".zip", bytes: inner });
  }
  if (!entries.length) return json({ error: "no_records" }, 404);

  const outer = buildZipArchive(entries);
  const fname = "affiliate-archive-bulk-" + new Date().toISOString().slice(0, 10) + ".zip";
  await insertAuditLog(
    env,
    buildAuditEntry({
      actor: auth.context.userId,
      action: "affiliate_archive.export_bulk",
      target_type: "affiliate_ad_archive",
      target_id: "bulk",
      detail: { count: entries.length, filters },
    })
  );
  return new Response(outer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="' + fname + '"',
      "Cache-Control": "private, no-store",
      "X-IU-Export-Count": String(entries.length),
    },
  });
}

export async function handleSimulateAffiliateArchiveTestPublish(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdminPermission(request, env, "audit.read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const snapshot = (body.snapshot as Record<string, unknown>) || {};
  const evidence = (body.evidence as Record<string, unknown>) || {
    synthetic: true,
    marker: "test_simulation_only",
    source: "test_simulation",
  };
  const gateDecision = (body.gate_decision as Record<string, unknown>) || {
    publicationReady: false,
    note: "simulated_test_publish",
  };
  const idempotencyKey = body.idempotency_key ? String(body.idempotency_key) : undefined;
  const out = await insertAffiliateArchiveRecordAtomic(env, {
    partnerName: String(body.partner_name || "Test Partner"),
    cjAdvertiserId: body.cj_advertiser_id ? String(body.cj_advertiser_id) : null,
    cjIdentity: (body.cj_identity as Record<string, unknown>) || {},
    adType: String(body.ad_type || "affiliate_coupon"),
    publishedText: body.published_text ? String(body.published_text) : null,
    snapshot,
    evidence,
    gateDecision,
    placementKey: body.placement_key ? String(body.placement_key) : "aff-auto-moto",
    isTest: true,
    legalHold: false,
    idempotencyKey,
    publishEventType: "test_simulation",
    productionSigningEnabled: false,
  });
  if (!out.ok) return json({ error: out.reason }, 500);
  await insertAuditLog(
    env,
    buildAuditEntry({
      actor: auth.context.userId,
      action: "affiliate_archive.simulate_test",
      target_type: "affiliate_ad_archive",
      target_id: out.record.record_id,
      detail: { is_test: true, idempotent: Boolean(out.idempotentReplay) },
    })
  );
  return json({
    ok: true,
    record: out.record,
    idempotent_replay: Boolean(out.idempotentReplay),
    version_count: out.versionCount,
    warning: "TEST_ONLY_NOT_PUBLIC_PUBLISH",
  });
}
