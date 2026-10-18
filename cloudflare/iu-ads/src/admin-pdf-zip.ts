/**
 * Build ZIP archives from stored PDF bytes (no regeneration).
 */
import { zipSync } from "fflate";

export type ZipEntry = { path: string; bytes: Uint8Array };

export function buildPdfZipArchive(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    const safe = e.path.replace(/[/\\]+/g, "_").replace(/[^\w.\-()+]/g, "_");
    if (!safe.toLowerCase().endsWith(".pdf")) {
      files[safe + ".pdf"] = e.bytes;
    } else {
      files[safe] = e.bytes;
    }
  }
  return zipSync(files, { level: 0 });
}

/** Generic ZIP (preserves relative paths under export root). */
export function buildZipArchive(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) {
    const safe = String(e.path || "file")
      .replace(/\\/g, "/")
      .replace(/\.\./g, "_")
      .replace(/^\/+/, "")
      .replace(/[^\w./\-()+]/g, "_");
    if (!safe) continue;
    files[safe] = e.bytes;
  }
  return zipSync(files, { level: 0 });
}

export function sanitizeZipFilenamePart(raw: string): string {
  return String(raw || "dokument")
    .trim()
    .slice(0, 80)
    .replace(/[^\w.\-()+]/g, "_");
}
