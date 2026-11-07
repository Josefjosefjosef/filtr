#!/usr/bin/env node
/**
 * Portable audit ZIP writer + strict validator.
 * Entry names ALWAYS use forward slashes `/` (never `\`).
 * No secrets in packs. Pure Node (zlib) — no Compress-Archive.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

/** High-signal secret patterns only (avoid false positives on code words like "token"). */
const SECRET_RE =
  /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{20,}|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----|(api[_-]?key|password|client_secret)\s*[:=]\s*['\"][^'\"]{12,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)/;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function walkFiles(root) {
  const out = [];
  function rec(d, relBase) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = relBase ? relBase + "/" + ent.name : ent.name;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) rec(full, rel);
      else out.push({ rel: rel.replace(/\\/g, "/"), full });
    }
  }
  rec(root, "");
  return out;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * Write a ZIP with store+deflate entries using ONLY `/` in names.
 */
export function writePortableZip(dir, zipPath) {
  const files = walkFiles(dir).sort((a, b) => a.rel.localeCompare(b.rel));
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    if (f.rel.includes("\\")) {
      throw new Error("refusing_backslash_path:" + f.rel);
    }
    const nameBuf = Buffer.from(f.rel, "utf8");
    const data = fs.readFileSync(f.full);
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const method = 8;
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localParts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      nameBuf,
    ]);
    centralParts.push(central);
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, centralDir, end]));
  return { fileCount: files.length, zipPath, bytes: fs.statSync(zipPath).size };
}

/**
 * Strict validator: no path normalization — entry name must match manifest exactly.
 */
export function validatePortableZip(zipPath, manifestPath) {
  const errors = [];
  const zipBuf = fs.readFileSync(zipPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = listZipEntries(zipBuf);

  if (entries.some((e) => e.name.includes("\\"))) {
    errors.push("zip_entry_contains_backslash");
  }
  const names = entries.map((e) => e.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) errors.push("duplicate_entry:" + dup[0]);

  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifestFiles = manifest.files || [];
  if (manifest.fileCount !== manifestFiles.length) {
    errors.push("manifest_fileCount_mismatch");
  }

  for (const mf of manifestFiles) {
    if (String(mf.path).includes("\\")) errors.push("manifest_backslash:" + mf.path);
    const ent = byName.get(mf.path);
    if (!ent) {
      errors.push("missing_in_zip:" + mf.path);
      continue;
    }
    if (ent.uncompressedSize !== mf.bytes) {
      errors.push("size_mismatch:" + mf.path);
    }
    const data = inflateEntry(zipBuf, ent);
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    if (sha !== mf.sha256) errors.push("sha256_mismatch:" + mf.path);
    if (ent.crc32 !== crc32(data)) errors.push("crc_mismatch:" + mf.path);
    const text = data.toString("utf8").slice(0, 200000);
    // Skip source scripts for keyword scan; still hashed/CRC-checked.
    if (!/\.(mjs|js|css)$/i.test(mf.path) && SECRET_RE.test(text)) {
      errors.push("secret_pattern:" + mf.path);
    }
  }

  for (const e of entries) {
    if (e.name === "MANIFEST.json") continue;
    if (!manifestFiles.some((m) => m.path === e.name)) {
      errors.push("extra_in_zip:" + e.name);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    entryCount: entries.length,
    manifestCount: manifestFiles.length,
    backslashEntries: entries.filter((e) => e.name.includes("\\")).length,
  };
}

export function listZipEntries(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const compSize = buf.readUInt32LE(i + 18);
    const uncompSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
    const dataStart = i + 30 + nameLen + extraLen;
    out.push({
      name,
      method,
      crc32: crc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      dataStart,
    });
    i = dataStart + compSize;
  }
  return out;
}

function inflateEntry(buf, ent) {
  const slice = buf.slice(ent.dataStart, ent.dataStart + ent.compressedSize);
  if (ent.method === 0) return slice;
  if (ent.method === 8) return zlib.inflateRawSync(slice);
  throw new Error("unsupported_method:" + ent.method);
}

export function buildManifestForDir(dir, { phase = "3Z-V4", rulesVersion = null } = {}) {
  const files = walkFiles(dir)
    .filter((f) => f.rel !== "MANIFEST.json" && f.rel !== "00-manifest.json")
    .sort((a, b) => a.rel.localeCompare(b.rel));
  const manifestFiles = files.map((f) => ({
    path: f.rel,
    bytes: fs.statSync(f.full).size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(f.full)).digest("hex"),
  }));
  return {
    phase,
    rulesVersion,
    generatedAt: new Date().toISOString(),
    pathStyle: "portable-forward-slash",
    fileCount: manifestFiles.length,
    files: manifestFiles,
  };
}

/**
 * V51.2: pack evidence dir → ZIP with post-pack integrity from FINAL entry list.
 * Executive summary + integrity reports must be written/refreshed BEFORE zip when
 * provided via hooks; postPackIntegrity is always derived from the opened ZIP.
 *
 * Order: evidence → (optional refresh) → manifest from disk → zip → reopen →
 * validate CRC/SHA/exact-name → write post-pack integrity beside zip (not inside
 * unless includePostPackInZip=true with second pass).
 */
export function finalizeAuditZip(opts = {}) {
  const evidenceDir = opts.evidenceDir;
  const zipPath = opts.zipPath;
  const phase = opts.phase || "3Z-V51.2";
  const rulesVersion = opts.rulesVersion || "iu-cj-audit-zip-v51.2";
  const manifestName = opts.manifestName || "MANIFEST.json";
  if (!evidenceDir || !zipPath) throw new Error("finalizeAuditZip requires evidenceDir + zipPath");

  if (typeof opts.refreshBeforeManifest === "function") {
    opts.refreshBeforeManifest(evidenceDir);
  }

  // Single source of truth: final on-disk evidence list (excluding manifest itself).
  const manifest = buildManifestForDir(evidenceDir, { phase, rulesVersion });
  const manifestPath = path.join(evidenceDir, manifestName);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  // Pre-pack integrity explicitly marked as pre-zip snapshot (must not claim final ZIP).
  if (opts.writePrePackIntegrity !== false) {
    const prePack = {
      schema: "iu-cj-affiliate-phase3z-audit-integrity-prepack-v51.2",
      stage: "PRE_ZIP_DISK_SNAPSHOT",
      note: "Counts reflect evidence directory BEFORE packing; NOT a final ZIP check.",
      at: new Date().toISOString(),
      diskFileCount: walkFiles(evidenceDir).length,
      manifestFileCount: manifest.fileCount,
      manifestPaths: manifest.files.map((f) => f.path),
    };
    fs.writeFileSync(path.join(evidenceDir, "92-integrity-prepack.json"), JSON.stringify(prePack, null, 2), "utf8");
    // Rebuild manifest to include prepack file (still excluding MANIFEST.json).
    const manifest2 = buildManifestForDir(evidenceDir, { phase, rulesVersion });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest2, null, 2), "utf8");
    Object.assign(manifest, manifest2);
  }

  if (typeof opts.refreshExecutiveSummary === "function") {
    opts.refreshExecutiveSummary(evidenceDir, manifest);
    const manifest3 = buildManifestForDir(evidenceDir, { phase, rulesVersion });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest3, null, 2), "utf8");
    Object.assign(manifest, manifest3);
  }

  const written = writePortableZip(evidenceDir, zipPath);
  const zipBuf = fs.readFileSync(zipPath);
  const entries = listZipEntries(zipBuf);
  const entryNames = entries.map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const manifestFiles = (manifest.files || []).map((f) => f.path).sort((a, b) => a.localeCompare(b));
  const zipWithoutManifest = entryNames.filter((n) => n !== manifestName);
  const exactNameParity =
    zipWithoutManifest.length === manifestFiles.length &&
    zipWithoutManifest.every((n, i) => n === manifestFiles[i]);

  const validation = validatePortableZip(zipPath, manifestPath);
  const sha256 = crypto.createHash("sha256").update(zipBuf).digest("hex").toUpperCase();

  const postPack = {
    schema: "iu-cj-affiliate-phase3z-audit-integrity-postpack-v51.2",
    stage: "FINAL_ZIP_OPENED",
    at: new Date().toISOString(),
    zipPath,
    zipSha256: sha256,
    zipBytes: zipBuf.length,
    zipEntryCount: entries.length,
    manifestFileCount: manifest.fileCount,
    // +1 for MANIFEST.json inside zip
    expectedZipEntries: manifest.fileCount + 1,
    exactNameParity,
    crcAndShaValidationOk: validation.ok,
    validationErrors: validation.errors,
    entryNames,
    verdict: validation.ok && exactNameParity ? "ZIP_INTEGRITY_PASS" : "ZIP_INTEGRITY_FAIL",
  };

  const sideIntegrity = zipPath.replace(/\.zip$/i, "") + "-integrity-postpack.json";
  fs.writeFileSync(sideIntegrity, JSON.stringify(postPack, null, 2), "utf8");

  return {
    ok: validation.ok && exactNameParity,
    zipPath,
    sha256,
    fileCount: entries.length,
    manifestEntries: manifest.fileCount,
    exactNameParity,
    validation,
    postPack,
    sideIntegrity,
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const mode = process.argv[2];
  if (mode === "zip") {
    const dir = process.argv[3];
    const zip = process.argv[4];
    console.log(JSON.stringify(writePortableZip(dir, zip)));
  } else if (mode === "validate") {
    const zip = process.argv[3];
    const man = process.argv[4];
    const r = validatePortableZip(zip, man);
    console.log(JSON.stringify(r));
    if (!r.ok) process.exit(2);
  } else {
    console.error("usage: zip <dir> <zipPath> | validate <zipPath> <manifestPath>");
    process.exit(1);
  }
}
