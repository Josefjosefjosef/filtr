/**
 * Audit log redaction + entry builder (Etapa 2, kap. 23).
 * Never persist: password, plaintext client/session tokens, keys, sensitive headers.
 * See docs/ads-system/03-security-threat-model.md#audit-rules.
 */

export const AUDIT_REDACT_KEYS = [
  "password",
  "password_hash",
  "new_password",
  "current_password",
  "token",
  "token_hash",
  "session",
  "session_id",
  "cookie",
  "code",
  "code_hash",
  "access_code",
  "secret",
  "pepper",
  "authorization",
  "sig",
] as const;

const REDACTED = "[REDACTED]";

function isRedactableKey(key: string): boolean {
  const lower = key.toLowerCase();
  return AUDIT_REDACT_KEYS.some((k) => lower === k || lower.includes(k));
}

/** Deep-clones a value while redacting any key that looks sensitive. */
export function redactForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactForAudit(v));
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isRedactableKey(k) ? REDACTED : redactForAudit(v);
  }
  return out;
}

export type AuditOperation =
  | "login_success"
  | "login_failed"
  | "logout"
  | "password_reset_requested"
  | "password_reset_confirmed"
  | "password_changed"
  | "user_created"
  | "user_updated"
  | "user_roles_updated";

export type AuditEntry = {
  audit_id: string;
  created_at: string;
  actor_user_id: string | null;
  operation: string;
  object_type: string;
  object_id: string;
  before_json: string | null;
  after_json: string | null;
  result: "success" | "failure";
};

export function buildAuditEntry(params: {
  auditId: string;
  createdAt?: string;
  actorUserId?: string | null;
  operation: AuditOperation | string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  result: "success" | "failure";
}): AuditEntry {
  return {
    audit_id: params.auditId,
    created_at: params.createdAt || new Date().toISOString(),
    actor_user_id: params.actorUserId ?? null,
    operation: params.operation,
    object_type: params.objectType,
    object_id: params.objectId,
    before_json: params.before === undefined ? null : JSON.stringify(redactForAudit(params.before)),
    after_json: params.after === undefined ? null : JSON.stringify(redactForAudit(params.after)),
    result: params.result,
  };
}

/** Client-facing audit view — never expose before/after raw blobs beyond redaction guarantee. */
export function toAuditListItem(row: AuditEntry): AuditEntry {
  return row;
}
