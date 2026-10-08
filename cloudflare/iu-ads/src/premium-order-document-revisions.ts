import { newId } from "./admin-auth";
import { buildObjectKey } from "./r2-security";

export type ArchiveDocumentRevisionInput = {
  documentId: string;
  version: number;
  contentHash: string;
  r2Key: string;
  pdfBytes: Uint8Array;
  reason: string;
  actorUserId: string | null;
};

/** Copy superseded PDF to archive R2 key and record revision row (never deletes prior bytes). */
export async function archiveDocumentRevisionBeforeReplace(
  db: D1Database,
  bucket: R2Bucket,
  input: ArchiveDocumentRevisionInput
): Promise<{ revision_id: string; archive_r2_key: string }> {
  const revisionId = newId("drev");
  const archiveKey = buildObjectKey({
    kind: "document",
    id: input.documentId + "-rev",
    version: input.version,
    ext: "pdf",
  });
  await bucket.put(archiveKey, input.pdfBytes, {
    httpMetadata: { contentType: "application/pdf" },
  });
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO document_content_revisions (
        revision_id, document_id, version, content_hash, r2_key, replacement_reason, actor_user_id, created_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    )
    .bind(
      revisionId,
      input.documentId,
      input.version,
      input.contentHash,
      archiveKey,
      input.reason.slice(0, 200),
      input.actorUserId,
      nowIso
    )
    .run();
  return { revision_id: revisionId, archive_r2_key: archiveKey };
}
