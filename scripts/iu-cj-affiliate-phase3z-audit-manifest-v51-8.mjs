#!/usr/bin/env node
/**
 * V51.8 audit integrity: write integrity-manifest.json WITHOUT hashing itself.
 * Schema: { schema, generatedAt, files:[{path,bytes,sha256}] } — manifest file excluded.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node iu-cj-affiliate-phase3z-audit-manifest-v51-8.mjs <audit-dir>");
  process.exit(2);
}

const MANIFEST_NAME = "integrity-manifest.json";
const files = readdirSync(dir)
  .filter((n) => n !== MANIFEST_NAME)
  .filter((n) => {
    try {
      return statSync(join(dir, n)).isFile();
    } catch {
      return false;
    }
  })
  .sort();

const entries = files.map((name) => {
  const buf = readFileSync(join(dir, name));
  return {
    path: name,
    bytes: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
});

const doc = {
  schema: "iu-cj-v518-audit-integrity-manifest-v1",
  generatedAt: new Date().toISOString(),
  note: "Manifest excludes itself; verify listed files only.",
  fileCount: entries.length,
  files: entries,
};

const outPath = join(dir, MANIFEST_NAME);
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");

// Self-check: every listed file exists and hashes match when re-read
for (const e of entries) {
  const buf = readFileSync(join(dir, e.path));
  const h = createHash("sha256").update(buf).digest("hex");
  if (h !== e.sha256 || buf.length !== e.bytes) {
    throw new Error(`MANIFEST_MISMATCH ${e.path}`);
  }
}

console.log(
  JSON.stringify({
    IU_CJ_AUDIT_MANIFEST_WRITE: "OK",
    path: basename(outPath),
    fileCount: entries.length,
    excludesSelf: true,
  })
);
