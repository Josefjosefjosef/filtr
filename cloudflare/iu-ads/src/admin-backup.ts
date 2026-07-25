/**
 * Admin backup manifests (Etapa 9, kap. 34). main_admin only via backups.read/backups.write.
 * Creates D1 manifest rows (+ optional encrypted R2 object when BACKUPS + key bound).
 * Restore drill validates inventory hash round-trip; real CF restore is operator runbook.
 */
import { buildAuditEntry } from "./audit";
import { insertAuditLog, json, newId, requireAdminPermission } from "./admin-auth";
import { clampLimit, clampOffset } from "./admin-list-filters";
import {
  assertNoForbiddenBackupKeys,
  buildBackupInventory,
  decryptBackupPayload,
  encryptBackupPayload,
  inventoryCanonicalJson,
  runRestoreDrill,
  selectExpiredBackupIds,
  sha256Hex,
  type BackupInventory,
  type BackupTableInventory,
} from "./backup";
import type { Env } from "./types";

type BackupRow = {
  backup_id: string;
  created_at: string;
  r2_key: string;
  content_hash: string;
  encryption: string;
  status: string;
  notes: string | null;
};

const BACKUP_COLUMNS = "backup_id, created_at, r2_key, content_hash, encryption, status, notes";

/** In-memory inventory attached for restore-drill within the same Worker isolate (tests + short window). */
const inventoryCache = new Map<string, BackupInventory>();

async function loadSettingInt(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key).first<{ value: string }>();
    const n = Number(row?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  } catch {
    return fallback;
  }
}

async function loadSchemaVersion(db: D1Database): Promise<string> {
  try {
    const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'SCHEMA_VERSION'").first<{ value: string }>();
    return row?.value || "unknown";
  } catch {
    return "unknown";
  }
}

async function countTable(db: D1Database, name: string): Promise<number> {
  try {
    const row = await db.prepare("SELECT COUNT(*) AS cnt FROM " + name).first<{ cnt: number }>();
    return Number(row?.cnt) || 0;
  } catch {
    return 0;
  }
}

const INVENTORY_TABLES = [
  "clients",
  "campaigns",
  "campaign_placements",
  "placement_reservations",
  "creatives",
  "documents",
  "inquiries",
  "orders",
  "contracts",
  "invoices",
  "rights_confirmations",
  "complaints",
  "audit_logs",
  "alerts",
  "client_access_codes",
  "system_settings",
  "backup_manifests",
] as const;

async function collectInventory(db: D1Database, createdAt: string): Promise<BackupInventory> {
  const schemaVersion = await loadSchemaVersion(db);
  const tables: BackupTableInventory[] = [];
  for (const name of INVENTORY_TABLES) {
    tables.push({ name, count: await countTable(db, name) });
  }
  // Settings sample: values only (no secrets live in D1); still redact defensively.
  try {
    const settings = await db
      .prepare("SELECT key, value FROM system_settings ORDER BY key LIMIT 50")
      .all<{ key: string; value: string }>();
    const settingsTable = tables.find((t) => t.name === "system_settings");
    if (settingsTable) {
      settingsTable.sample = (settings.results || []).map((r) => ({ key: r.key, value: r.value }));
    }
  } catch {
    /* ignore */
  }
  return buildBackupInventory({
    schemaVersion,
    createdAt,
    tables,
    notes: "counts_plus_settings_sample",
  });
}

function serializeBackup(row: BackupRow) {
  return {
    backup_id: row.backup_id,
    created_at: row.created_at,
    r2_key: row.r2_key,
    content_hash: row.content_hash,
    encryption: row.encryption,
    status: row.status,
    notes: row.notes,
  };
}

export async function handleListBackups(request: Request, env: Env, url: URL): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "backups.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const res = await env.DB.prepare(
    "SELECT " + BACKUP_COLUMNS + " FROM backup_manifests ORDER BY created_at DESC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<BackupRow>();
  return json({ backups: (res.results || []).map(serializeBackup), limit, offset });
}

export async function handleGetBackup(request: Request, env: Env, backupId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "backups.read");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + BACKUP_COLUMNS + " FROM backup_manifests WHERE backup_id = ?")
    .bind(backupId)
    .first<BackupRow>();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ backup: serializeBackup(row) });
}

export async function handleCreateBackup(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "backups.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const nowIso = new Date().toISOString();
  const inventory = await collectInventory(env.DB, nowIso);
  const leaks = assertNoForbiddenBackupKeys(inventory);
  if (leaks.length > 0) {
    return json({ error: "forbidden_keys_in_inventory", leaks }, 500);
  }

  const canonical = inventoryCanonicalJson(inventory);
  const contentHash = await sha256Hex(canonical);
  const backupId = newId("bak");
  const r2Key = "backups/" + backupId + ".json.enc";
  let encryption = "none";
  let status = "manifest_only";
  let notes = "D1 inventory counts + settings sample; operator runbook for full wrangler d1 export";

  if (env.BACKUPS && env.ADS_BACKUP_ENCRYPTION_KEY) {
    const { ciphertextB64, encryption: enc } = await encryptBackupPayload(canonical, env.ADS_BACKUP_ENCRYPTION_KEY);
    await env.BACKUPS.put(r2Key, ciphertextB64, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { content_hash: contentHash, backup_id: backupId },
    });
    encryption = enc;
    status = "stored";
    notes = "Encrypted inventory stored in iu-ads-backups; full D1 dump still via operator runbook";
  }

  await env.DB.prepare(
    "INSERT INTO backup_manifests (backup_id, created_at, r2_key, content_hash, encryption, status, notes) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(backupId, nowIso, r2Key, contentHash, encryption, status, notes)
    .run();

  inventoryCache.set(backupId, inventory);

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "backup_created",
      objectType: "backup_manifest",
      objectId: backupId,
      after: { status, encryption, content_hash: contentHash },
      result: "success",
    })
  );

  const row = await env.DB.prepare("SELECT " + BACKUP_COLUMNS + " FROM backup_manifests WHERE backup_id = ?")
    .bind(backupId)
    .first<BackupRow>();
  return json({ backup: row ? serializeBackup(row) : null, inventory_tables: inventory.tables.map((t) => t.name) }, 201);
}

/**
 * Restore drill: re-validate inventory hash against the stored manifest.
 * Prefer cached inventory from create; else rebuild counts (hash will only match if DB unchanged).
 */
export async function handleBackupDrill(request: Request, env: Env, backupId: string): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "backups.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const row = await env.DB.prepare("SELECT " + BACKUP_COLUMNS + " FROM backup_manifests WHERE backup_id = ?")
    .bind(backupId)
    .first<BackupRow>();
  if (!row) return json({ error: "not_found" }, 404);

  let inventory = inventoryCache.get(backupId);
  let source: "cache" | "r2" | "rebuild" = inventory ? "cache" : "rebuild";

  // Cold isolate: rehydrate encrypted inventory from private BACKUPS R2 (never public URL).
  if (!inventory && env.BACKUPS && row.encryption === "aes-256-gcm" && env.ADS_BACKUP_ENCRYPTION_KEY) {
    try {
      const obj = await env.BACKUPS.get(row.r2_key);
      if (obj) {
        const ciphertextB64 = await obj.text();
        const plain = await decryptBackupPayload(ciphertextB64, env.ADS_BACKUP_ENCRYPTION_KEY);
        inventory = JSON.parse(plain) as BackupInventory;
        inventoryCache.set(backupId, inventory);
        source = "r2";
      }
    } catch {
      inventory = undefined;
      source = "rebuild";
    }
  }

  if (!inventory) {
    // Rebuild — may hash-mismatch if DB mutated; still useful for leak checks.
    inventory = await collectInventory(env.DB, row.created_at);
    source = "rebuild";
  }

  const drill = await runRestoreDrill(
    { content_hash: row.content_hash, encryption: row.encryption, status: row.status },
    inventory
  );

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "backup_restore_drill",
      objectType: "backup_manifest",
      objectId: backupId,
      after: { ok: drill.ok, reason: drill.reason || null },
      result: drill.ok ? "success" : "failure",
    })
  );

  if (!drill.ok) return json({ ok: false, drill, source }, 409);
  return json({
    ok: true,
    drill,
    source,
    backup: serializeBackup(row),
    inventory_tables: inventory.tables.map((t) => ({ name: t.name, count: t.count })),
  });
}

/** Prune expired manifests per BACKUP_RETENTION_DAYS (D1 rows only; R2 objects left for operator). */
export async function handlePruneBackups(request: Request, env: Env): Promise<Response> {
  const guard = await requireAdminPermission(request, env, "backups.write");
  if (!guard.ok) return guard.response;
  if (!env.DB) return json({ error: "auth_not_configured" }, 503);

  const retentionDays = await loadSettingInt(env.DB, "BACKUP_RETENTION_DAYS", 30);
  const all = await env.DB.prepare("SELECT backup_id, created_at FROM backup_manifests").all<{
    backup_id: string;
    created_at: string;
  }>();
  const expired = selectExpiredBackupIds(all.results || [], retentionDays);
  let deleted = 0;
  for (const id of expired) {
    await env.DB.prepare("DELETE FROM backup_manifests WHERE backup_id = ?").bind(id).run();
    inventoryCache.delete(id);
    deleted += 1;
  }

  await insertAuditLog(
    env.DB,
    buildAuditEntry({
      auditId: newId("aud"),
      actorUserId: guard.userId,
      operation: "backup_pruned",
      objectType: "backup_manifest",
      objectId: "batch",
      after: { deleted, retention_days: retentionDays },
      result: "success",
    })
  );

  return json({ deleted, retention_days: retentionDays, expired_ids: expired });
}
