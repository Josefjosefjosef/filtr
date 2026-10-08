import { describe, expect, it } from "vitest";
import { archiveDocumentRevisionBeforeReplace } from "../src/premium-order-document-revisions";

describe("document content revisions", () => {
  it("archives prior PDF bytes to separate R2 key and inserts revision row", async () => {
    const puts: { key: string; bytes: Uint8Array }[] = [];
    const bucket = {
      put: async (key: string, bytes: Uint8Array) => {
        puts.push({ key, bytes });
      },
    } as unknown as R2Bucket;
    const binds: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => {
          binds.push(args);
          return { run: async () => ({}) };
        },
      }),
    } as unknown as D1Database;

    const oldBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const out = await archiveDocumentRevisionBeforeReplace(db, bucket, {
      documentId: "doc_test_1",
      version: 1,
      contentHash: "hash_old",
      r2Key: "document/active/v1.pdf",
      pdfBytes: oldBytes,
      reason: "test_replace",
      actorUserId: "admin_1",
    });

    expect(out.revision_id).toMatch(/^drev_/);
    expect(out.archive_r2_key).toContain("doc_test_1-rev");
    expect(puts.length).toBe(1);
    expect(puts[0].bytes).toEqual(oldBytes);
    expect(binds.length).toBe(1);
  });
});
