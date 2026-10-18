/**
 * CJ Affiliate archive export ZIP (PDF at export time + manifest + SHA-256).
 */
import { sha256Hex } from "./backup";
import { buildZipArchive, sanitizeZipFilenamePart, type ZipEntry } from "./admin-pdf-zip";

export type AffiliateArchiveZipInput = {
  record: Record<string, unknown>;
  versions: readonly Record<string, unknown>[];
  pdfBytes: Uint8Array;
  /** Optional image bytes keyed by export path (only when export is authorized). */
  imageFiles?: { path: string; bytes: Uint8Array }[];
};

export async function buildAffiliateArchiveExportZip(input: AffiliateArchiveZipInput): Promise<Uint8Array> {
  const recordId = String(input.record.record_id || "unknown");
  const prefix = sanitizeZipFilenamePart(recordId);
  const recordJson = JSON.stringify(input.record, null, 2);
  const evidenceJson = JSON.stringify(input.record.evidence ?? {}, null, 2);
  const gateJson = JSON.stringify(input.record.gate_decision ?? {}, null, 2);
  const versionsJson = JSON.stringify(input.versions, null, 2);
  const csvHeader = "record_id,partner,ad_type,is_test,content_hash,published_at,ended_at\n";
  const csvRow = [
    input.record.record_id,
    input.record.partner_name,
    input.record.ad_type,
    input.record.is_test ? "1" : "0",
    input.record.content_hash,
    input.record.published_at ?? "",
    input.record.ended_at ?? "",
  ].join(",");
  const csvBytes = new TextEncoder().encode(csvHeader + csvRow + "\n");

  const files: { path: string; bytes: Uint8Array }[] = [
    { path: `${prefix}/record.json`, bytes: new TextEncoder().encode(recordJson) },
    { path: `${prefix}/evidence.json`, bytes: new TextEncoder().encode(evidenceJson) },
    { path: `${prefix}/gate-decision.json`, bytes: new TextEncoder().encode(gateJson) },
    { path: `${prefix}/versions.json`, bytes: new TextEncoder().encode(versionsJson) },
    { path: `${prefix}/summary.csv`, bytes: csvBytes },
    { path: `${prefix}/summary.pdf`, bytes: input.pdfBytes },
  ];
  for (const img of input.imageFiles ?? []) {
    files.push({ path: `${prefix}/images/${img.path}`, bytes: img.bytes });
  }

  const manifestFiles: { path: string; sha256: string; bytes: number }[] = [];
  for (const f of files) {
    manifestFiles.push({
      path: f.path,
      sha256: await sha256Hex(f.bytes),
      bytes: f.bytes.byteLength,
    });
  }
  const manifest = {
    format: "affiliate_archive_export_zip_v1",
    generated_at: new Date().toISOString(),
    record_id: recordId,
    is_test: Boolean(input.record.is_test),
    files: manifestFiles,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  files.push({ path: `${prefix}/manifest.json`, bytes: manifestBytes });

  const checksumLines = manifestFiles.map((m) => `${m.sha256}  ${m.path}`).join("\n") + "\n";
  files.push({ path: `${prefix}/SHA256SUMS.txt`, bytes: new TextEncoder().encode(checksumLines) });

  const entries: ZipEntry[] = files.map((f) => ({ path: f.path, bytes: f.bytes }));
  return buildZipArchive(entries);
}
