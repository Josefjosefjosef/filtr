#!/usr/bin/env node
/**
 * V51.8 — audit ZIP / pack integrity helpers.
 * CRC32 must be exactly 8 lowercase hex digits (unsigned 32-bit, no sign-extension).
 * Manifest must NOT include the ZIP itself or a circular hash of the ZIP.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const AUDIT_INTEGRITY_SCHEMA = "iu-cj-affiliate-phase3z-audit-zip-integrity-v51-8";

/** Unsigned CRC-32 (ISO 3309 / PNG/ZIP polynomial). */
export function crc32Unsigned(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function crc32Hex(buf) {
  return crc32Unsigned(buf).toString(16).padStart(8, "0");
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function normalizeCrc32Hex(value) {
  const s = String(value || "").trim().toLowerCase();
  // Reject sign-extended forms like ffffffffac972476
  if (!/^[0-9a-f]{8}$/.test(s)) return null;
  return s;
}

export function buildEvidenceManifest(files) {
  const entries = [];
  for (const f of files) {
    const rel = String(f.path || f.rel || "").replace(/\\/g, "/");
    const buf = Buffer.isBuffer(f.bytes)
      ? f.bytes
      : fs.readFileSync(f.abs || f.fullPath);
    entries.push({
      path: rel,
      size: buf.length,
      sha256: sha256Hex(buf),
      crc32: crc32Hex(buf),
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    schema: AUDIT_INTEGRITY_SCHEMA,
    generatedAt: new Date().toISOString(),
    fileCount: entries.length,
    files: entries,
  };
}

/**
 * Validate manifest against an on-disk directory of evidence files.
 * Returns { ok, failures[] }.
 */
export function validateEvidenceManifest(manifest, dirAbs, opts = {}) {
  const failures = [];
  const files = Array.isArray(manifest?.files) ? manifest.files : null;
  if (!files) {
    failures.push({ code: "MANIFEST_MISSING_FILES", detail: "manifest.files required" });
    return { ok: false, failures };
  }

  const seen = new Set();
  const disk = new Map();
  const walk = (root, prefix = "") => {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.name === "MANIFEST.json" || ent.name === "MANIFEST.meta.json") continue;
      if (opts.skipNames && opts.skipNames.has(ent.name)) continue;
      const rel = prefix ? prefix + "/" + ent.name : ent.name;
      const abs = path.join(root, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else disk.set(rel.replace(/\\/g, "/"), abs);
    }
  };
  walk(dirAbs);

  for (const row of files) {
    const rel = String(row.path || "").replace(/\\/g, "/");
    if (!rel) {
      failures.push({ code: "EMPTY_PATH", detail: JSON.stringify(row) });
      continue;
    }
    if (seen.has(rel)) {
      failures.push({ code: "DUPLICATE_PATH", path: rel });
      continue;
    }
    seen.add(rel);

    const crc = normalizeCrc32Hex(row.crc32);
    if (!crc) {
      failures.push({
        code: "CRC32_FORMAT_INVALID",
        path: rel,
        detail: String(row.crc32),
        expected: "exactly 8 lowercase hex digits (unsigned)",
      });
    }

    const abs = disk.get(rel);
    if (!abs) {
      failures.push({ code: "MISSING_FILE", path: rel });
      continue;
    }
    disk.delete(rel);
    const buf = fs.readFileSync(abs);
    if (Number(row.size) !== buf.length) {
      failures.push({
        code: "SIZE_MISMATCH",
        path: rel,
        expected: Number(row.size),
        actual: buf.length,
      });
    }
    const gotSha = sha256Hex(buf);
    if (String(row.sha256 || "").toLowerCase() !== gotSha) {
      failures.push({
        code: "SHA256_MISMATCH",
        path: rel,
        expected: String(row.sha256 || "").toLowerCase(),
        actual: gotSha,
      });
    }
    const gotCrc = crc32Hex(buf);
    if (crc && crc !== gotCrc) {
      failures.push({
        code: "CRC32_MISMATCH",
        path: rel,
        expected: crc,
        actual: gotCrc,
      });
    }
  }

  for (const extra of disk.keys()) {
    failures.push({ code: "EXTRA_FILE", path: extra });
  }

  if (seen.size !== files.length) {
    // duplicates already recorded
  }

  return { ok: failures.length === 0, failures, fileCount: files.length };
}

export function assertIntegrityOk(result) {
  if (!result?.ok) {
    const msg = (result.failures || [])
      .slice(0, 12)
      .map((f) => f.code + (f.path ? ":" + f.path : ""))
      .join(",");
    throw new Error("AUDIT_INTEGRITY_FAIL:" + msg);
  }
  return true;
}
