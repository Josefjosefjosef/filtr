/**
 * Backup inventory + restore-drill helpers (Etapa 9, kap. 34).
 * Never includes plaintext passwords, access codes, session tokens, or signing keys.
 * Real Cloudflare D1/R2 restore remains an operator runbook step; this module
 * validates redacted manifest round-trips for automated proof.
 */

/** Columns / keys that must never appear in a backup inventory payload. */
export const BACKUP_FORBIDDEN_KEYS = [
  "password",
  "password_hash",
  "access_code",
  "client_code",
  "code_hash",
  "token",
  "token_hash",
  "session",
  "session_secret",
  "pepper",
  "ADS_SESSION_SECRET",
  "ADS_CLIENT_SESSION_SECRET",
  "ADS_PASSWORD_PEPPER",
  "ADS_CODE_PEPPER",
  "ADS_R2_SIGNING_SECRET",
  "ADS_BACKUP_ENCRYPTION_KEY",
  "ANALYTICS_ADMIN_TOKEN",
  "ADMIN_TOKEN",
] as const;

export type BackupTableInventory = {
  name: string;
  count: number;
  /** Allowlisted row samples only — never forbidden keys. */
  sample?: Record<string, unknown>[];
};

export type BackupInventory = {
  schemaVersion: string;
  createdAt: string;
  tables: BackupTableInventory[];
  notes?: string;
};

export type BackupManifestView = {
  backup_id: string;
  created_at: string;
  r2_key: string;
  content_hash: string;
  encryption: string;
  status: string;
  notes: string | null;
};

export function assertNoForbiddenBackupKeys(value: unknown, path = ""): string[] {
  const leaks: string[] = [];
  if (value === null || value === undefined) return leaks;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      leaks.push(...assertNoForbiddenBackupKeys(item, path + "[" + i + "]"));
    });
    return leaks;
  }
  if (typeof value !== "object") return leaks;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    for (const forbidden of BACKUP_FORBIDDEN_KEYS) {
      if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
        leaks.push((path ? path + "." : "") + k);
      }
    }
    leaks.push(...assertNoForbiddenBackupKeys(v, (path ? path + "." : "") + k));
  }
  return leaks;
}

/** Strip any forbidden keys from a shallow/deep object (best-effort redaction). */
export function redactBackupValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactBackupValue(item)) as T;
  }
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    let blocked = false;
    for (const forbidden of BACKUP_FORBIDDEN_KEYS) {
      if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    out[k] = redactBackupValue(v);
  }
  return out as T;
}

export function buildBackupInventory(input: {
  schemaVersion: string;
  createdAt: string;
  tables: BackupTableInventory[];
  notes?: string;
}): BackupInventory {
  const inventory: BackupInventory = {
    schemaVersion: input.schemaVersion,
    createdAt: input.createdAt,
    tables: input.tables.map((t) => ({
      name: t.name,
      count: t.count,
      sample: t.sample ? redactBackupValue(t.sample) : undefined,
    })),
  };
  if (input.notes) inventory.notes = input.notes;
  return redactBackupValue(inventory);
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  let data: Uint8Array;
  if (typeof bytes === "string") {
    data = new TextEncoder().encode(bytes);
  } else if (bytes instanceof Uint8Array) {
    data = bytes;
  } else {
    data = new Uint8Array(bytes);
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function inventoryCanonicalJson(inventory: BackupInventory): string {
  return JSON.stringify(inventory);
}

export type RestoreDrillResult = {
  ok: boolean;
  reason?: string;
  content_hash?: string;
  leaks?: string[];
};

/**
 * Simulate restore drill: re-hash inventory, compare to manifest, assert no forbidden keys.
 * Does not talk to Cloudflare — operator runbook covers real D1/R2 restore.
 */
export async function runRestoreDrill(manifest: {
  content_hash: string;
  encryption: string;
  status: string;
}, inventory: BackupInventory): Promise<RestoreDrillResult> {
  const leaks = assertNoForbiddenBackupKeys(inventory);
  if (leaks.length > 0) {
    return { ok: false, reason: "forbidden_keys", leaks };
  }
  const canonical = inventoryCanonicalJson(inventory);
  const hash = await sha256Hex(canonical);
  if (hash !== manifest.content_hash) {
    return { ok: false, reason: "hash_mismatch", content_hash: hash };
  }
  if (!manifest.encryption || !manifest.status) {
    return { ok: false, reason: "incomplete_manifest" };
  }
  return { ok: true, content_hash: hash };
}

/** Retention: keep manifests newer than cutoff; return ids to prune. */
export function selectExpiredBackupIds(
  rows: Array<{ backup_id: string; created_at: string }>,
  retentionDays: number,
  nowMs = Date.now()
): string[] {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 30;
  const cutoff = nowMs - days * 86400000;
  return rows
    .filter((r) => {
      const t = Date.parse(r.created_at);
      return Number.isFinite(t) && t < cutoff;
    })
    .map((r) => r.backup_id);
}

/**
 * AES-GCM encrypt inventory bytes when ADS_BACKUP_ENCRYPTION_KEY is present.
 * Key material: SHA-256 of the secret string (32 bytes). Returns base64 ciphertext
 * with 12-byte IV prepended. Never logs the key.
 */
export async function encryptBackupPayload(
  plaintext: string,
  encryptionKeySecret: string
): Promise<{ ciphertextB64: string; encryption: string }> {
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionKeySecret));
  const key = await crypto.subtle.importKey("raw", keyHash, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const packed = new Uint8Array(iv.length + cipherBuf.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipherBuf), iv.length);
  let binary = "";
  for (let i = 0; i < packed.length; i++) binary += String.fromCharCode(packed[i]);
  // btoa is available in Workers; Node 18+ vitest also provides it via undici/global.
  const ciphertextB64 = btoa(binary);
  return { ciphertextB64, encryption: "aes-256-gcm" };
}

export async function decryptBackupPayload(
  ciphertextB64: string,
  encryptionKeySecret: string
): Promise<string> {
  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionKeySecret));
  const key = await crypto.subtle.importKey("raw", keyHash, { name: "AES-GCM" }, false, ["decrypt"]);
  const binary = atob(ciphertextB64);
  const packed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) packed[i] = binary.charCodeAt(i);
  const iv = packed.slice(0, 12);
  const data = packed.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plainBuf);
}

/** Kap. 14 privacy defaults that must remain fail-closed in D1 seed + health. */
export const PRIVACY_FAIL_CLOSED = {
  PERSONALIZED_ADS: "NO",
  RETARGETING: "NO",
  PROFILING: "NO",
  AD_TRACKING_COOKIES: "NO",
  CONTEXTUAL_ADS_ONLY: "YES",
} as const;
