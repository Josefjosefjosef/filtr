/**
 * Document/field visibility helpers (Etapa 3, kap. 22/39).
 * `visibility` never grants a permanent public R2 URL — even "public" documents
 * are served only via short-lived HMAC-signed access (see signed-access.ts, 08-r2-plan.md).
 */
import { signObjectAccess } from "./signed-access";

export const DOCUMENT_VISIBILITY_VALUES = ["internal_only", "client_visible", "public"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITY_VALUES)[number];

export function isDocumentVisibility(value: unknown): value is DocumentVisibility {
  return typeof value === "string" && (DOCUMENT_VISIBILITY_VALUES as readonly string[]).includes(value);
}

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
export const MAX_SIGNED_URL_TTL_SECONDS = 3600;

export type SignedDocumentAccess = { path: string; expiresAt: string };

/**
 * Always issues a short-lived signed Worker path — never a permanent public R2 URL,
 * regardless of the document's `visibility` value.
 */
export async function buildSignedDocumentAccess(
  secret: string,
  objectKey: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<SignedDocumentAccess> {
  const clampedTtl = Math.min(Math.max(1, Math.floor(ttlSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS), MAX_SIGNED_URL_TTL_SECONDS);
  const exp = Math.floor(Date.now() / 1000) + clampedTtl;
  const sig = await signObjectAccess(secret, { objectKey, bucket: "DOCUMENTS", exp });
  const path =
    "/v1/objects/get?bucket=DOCUMENTS&key=" +
    encodeURIComponent(objectKey) +
    "&exp=" +
    String(exp) +
    "&sig=" +
    encodeURIComponent(sig);
  return { path, expiresAt: new Date(exp * 1000).toISOString() };
}

const VISIBILITY_RANK: Record<DocumentVisibility, number> = {
  internal_only: 0,
  client_visible: 1,
  public: 2,
};

export type DocumentVisibilitySource = {
  document_id: string;
  doc_type: string;
  title: string;
  version: number;
  visibility: string;
  created_at: string;
};

export type DocumentVisibleView = Omit<DocumentVisibilitySource, "visibility"> & { visibility: DocumentVisibility };

/**
 * Filters a document row for a given viewer scope. Returns null when the row's
 * visibility is below the viewer's minimum (e.g. `internal_only` hidden from clients).
 * Reserved for the Etapa 7 client portal / public context — admin surfaces always see everything.
 */
export function filterDocumentForVisibility(
  row: DocumentVisibilitySource,
  minVisibility: DocumentVisibility
): DocumentVisibleView | null {
  const visibility = isDocumentVisibility(row.visibility) ? row.visibility : "internal_only";
  if (VISIBILITY_RANK[visibility] < VISIBILITY_RANK[minVisibility]) return null;
  return {
    document_id: row.document_id,
    doc_type: row.doc_type,
    title: row.title,
    version: row.version,
    visibility,
    created_at: row.created_at,
  };
}
