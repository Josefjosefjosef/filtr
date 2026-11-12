#!/usr/bin/env node
/**
 * V51.8 — audit ZIP / pack integrity helpers.
 * CRC32 must be exactly 8 lowercase hex digits (unsigned 32-bit, no sign-extension).
 *
 * Self-reference rule (deterministic, non-circular):
 * - MANIFEST.json lists evidence files ONLY (never itself, never the outer ZIP, never *.sha256 sidecars).
 * - MANIFEST.meta.json is written AFTER MANIFEST.json and stores sha256/size/crc32 of MANIFEST.json.
 * - Validators skip MANIFEST.json / MANIFEST.meta.json from the "extra file" walk and never require
 *   MANIFEST.json to hash-check itself inside files[].
 * - Outer ZIP SHA-256 lives only in the sibling `.sha256` text file next to the ZIP (not inside the ZIP).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const AUDIT_INTEGRITY_SCHEMA = "iu-cj-affiliate-phase3z-audit-zip-integrity-v51-8";
export const MANIFEST_BASENAME = "MANIFEST.json";
export const MANIFEST_META_BASENAME = "MANIFEST.meta.json";
export const FORBIDDEN_MANIFEST_PATHS = Object.freeze([
  MANIFEST_BASENAME,
  MANIFEST_META_BASENAME,
  "integrity-manifest.txt",
  "integrity-manifest.json",
]);

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

function assertSafeManifestPath(rel) {
  const base = path.posix.basename(String(rel || "").replace(/\\/g, "/"));
  const lower = String(rel || "").replace(/\\/g, "/").toLowerCase();
  if (FORBIDDEN_MANIFEST_PATHS.includes(base) || FORBIDDEN_MANIFEST_PATHS.includes(lower)) {
    throw new Error("MANIFEST_SELF_REF_FORBIDDEN:" + rel);
  }
  if (/\.zip$/i.test(lower) || /\.sha256$/i.test(lower)) {
    throw new Error("MANIFEST_ZIP_OR_SIDECAR_FORBIDDEN:" + rel);
  }
}

export function buildEvidenceManifest(files) {
  const entries = [];
  for (const f of files) {
    const rel = String(f.path || f.rel || "").replace(/\\/g, "/");
    assertSafeManifestPath(rel);
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
    selfReferenceRule:
      "MANIFEST.json excludes itself; MANIFEST.meta.json seals MANIFEST.json; ZIP sha256 is external sidecar only",
    fileCount: entries.length,
    files: entries,
  };
}

/** Write MANIFEST.json then MANIFEST.meta.json (seal) into dirAbs. */
export function writeSealedEvidenceManifest(dirAbs, files) {
  const manifest = buildEvidenceManifest(files);
  const manAbs = path.join(dirAbs, MANIFEST_BASENAME);
  const manBody = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(manAbs, manBody, "utf8");
  const manBuf = Buffer.from(manBody, "utf8");
  const meta = {
    schema: AUDIT_INTEGRITY_SCHEMA + "-meta",
    generatedAt: new Date().toISOString(),
    seals: MANIFEST_BASENAME,
    size: manBuf.length,
    sha256: sha256Hex(manBuf),
    crc32: crc32Hex(manBuf),
    note: "Does not include its own hash. Verify MANIFEST.json via this meta file; verify ZIP via external .sha256 sidecar.",
  };
  fs.writeFileSync(path.join(dirAbs, MANIFEST_META_BASENAME), JSON.stringify(meta, null, 2) + "\n", "utf8");
  return { manifest, meta };
}

export function validateManifestSeal(dirAbs) {
  const failures = [];
  const manAbs = path.join(dirAbs, MANIFEST_BASENAME);
  const metaAbs = path.join(dirAbs, MANIFEST_META_BASENAME);
  if (!fs.existsSync(manAbs)) {
    failures.push({ code: "MANIFEST_MISSING", path: MANIFEST_BASENAME });
    return { ok: false, failures };
  }
  if (!fs.existsSync(metaAbs)) {
    failures.push({ code: "MANIFEST_META_MISSING", path: MANIFEST_META_BASENAME });
    return { ok: false, failures };
  }
  const manBuf = fs.readFileSync(manAbs);
  const meta = JSON.parse(fs.readFileSync(metaAbs, "utf8"));
  if (Number(meta.size) !== manBuf.length) {
    failures.push({
      code: "MANIFEST_SEAL_SIZE_MISMATCH",
      expected: Number(meta.size),
      actual: manBuf.length,
    });
  }
  const gotSha = sha256Hex(manBuf);
  if (String(meta.sha256 || "").toLowerCase() !== gotSha) {
    failures.push({
      code: "MANIFEST_SEAL_SHA256_MISMATCH",
      expected: String(meta.sha256 || "").toLowerCase(),
      actual: gotSha,
    });
  }
  const crc = normalizeCrc32Hex(meta.crc32);
  const gotCrc = crc32Hex(manBuf);
  if (!crc) {
    failures.push({ code: "MANIFEST_SEAL_CRC32_FORMAT_INVALID", detail: String(meta.crc32) });
  } else if (crc !== gotCrc) {
    failures.push({ code: "MANIFEST_SEAL_CRC32_MISMATCH", expected: crc, actual: gotCrc });
  }
  // Manifest must not list itself
  try {
    const man = JSON.parse(manBuf.toString("utf8"));
    for (const row of man.files || []) {
      const rel = String(row.path || "").replace(/\\/g, "/");
      try {
        assertSafeManifestPath(rel);
      } catch (e) {
        failures.push({ code: "MANIFEST_LISTS_FORBIDDEN_PATH", path: rel, detail: String(e.message || e) });
      }
    }
  } catch (e) {
    failures.push({ code: "MANIFEST_PARSE_ERROR", detail: String(e.message || e) });
  }
  return { ok: failures.length === 0, failures };
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
      if (
        ent.name === MANIFEST_BASENAME ||
        ent.name === MANIFEST_META_BASENAME ||
        ent.name === "integrity-manifest.txt" ||
        ent.name === "integrity-manifest.json"
      ) {
        continue;
      }
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
