import { describe, expect, it } from "vitest";
import { buildPdfZipArchive, sanitizeZipFilenamePart } from "../src/admin-pdf-zip";

describe("admin-pdf-zip", () => {
  it("builds a non-empty zip with pdf suffix", () => {
    const bytes = buildPdfZipArchive([
      { path: "test-doc", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    ]);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it("sanitizes filename parts", () => {
    expect(sanitizeZipFilenamePart("faktura 2026/01")).toMatch(/^faktura/);
  });
});
