#!/usr/bin/env node
/**
 * V37 — audit pack JSON integrity helpers.
 * Root cause V36: writers appended literal "\\n" after JSON.stringify → invalid JSON.
 * Every .json file in an audit dir/ZIP must be a single parseable JSON document.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Strip a single trailing literal backslash-n artifact without touching real newlines. */
export function sanitizeJsonText(raw) {
  let t = String(raw ?? "");
  // BOM
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  // Literal \n appended after closing brace (V36 bug: +"\\n" instead of +"\n")
  if (/\}\\n\s*$/.test(t)) t = t.replace(/\\n\s*$/, "");
  // Trailing whitespace ok
  return t.replace(/\s+$/, "") + "\n";
}

export function writeValidJsonFile(filePath, value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  // Guard: never emit literal backslash-n after payload.
  if (text.includes("}\\n") && /\}\\n\s*$/.test(text)) {
    throw new Error("refusing_literal_backslash_n:" + filePath);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
  // Immediate parse proof
  JSON.parse(fs.readFileSync(filePath, "utf8"));
  return filePath;
}

export function validateJsonFilesInDir(dir) {
  const failures = [];
  const files = [];
  function walk(d, relBase = "") {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = relBase ? relBase + "/" + ent.name : ent.name;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else if (/\.json$/i.test(ent.name)) files.push({ rel: rel.replace(/\\/g, "/"), full });
    }
  }
  walk(dir);
  const sha256Files = {};
  for (const f of files) {
    const raw = fs.readFileSync(f.full);
    const text = raw.toString("utf8");
    sha256Files[f.rel] = crypto.createHash("sha256").update(raw).digest("hex");
    if (/\}\\n\s*$/.test(text)) {
      failures.push({ path: f.rel, error: "literal_backslash_n_suffix" });
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object") {
        // JSON primitives are valid documents; allow but flag for audit manifests.
        if (f.rel.includes("integrity") || f.rel.includes("manifest") || f.rel.includes("sha256")) {
          failures.push({ path: f.rel, error: "manifest_must_be_object" });
        }
      }
    } catch (e) {
      failures.push({ path: f.rel, error: String(e.message || e).slice(0, 200) });
    }
  }
  return {
    ok: failures.length === 0,
    fileCount: files.length,
    failures,
    sha256Files,
  };
}

/**
 * Build integrity + sha256 manifests as valid standalone JSON documents.
 */
export function writeIntegrityManifests(dir, opts = {}) {
  const validation = validateJsonFilesInDir(dir);
  // Exclude prior manifests from sha list if regenerating
  const files = { ...validation.sha256Files };
  delete files["48-integrity-manifest.json"];
  delete files["49-sha256-files.json"];
  const integrity = {
    fileCount: Object.keys(files).length,
    algo: "sha256",
    reconcilePass: validation.ok && (opts.reconcilePass !== false),
    jsonParsePass: validation.ok,
    failures: validation.failures,
    generatedAt: new Date().toISOString(),
    schema: "iu-cj-affiliate-phase3z-audit-json-integrity-v37",
  };
  writeValidJsonFile(path.join(dir, "48-integrity-manifest.json"), integrity);
  writeValidJsonFile(path.join(dir, "49-sha256-files.json"), files);
  // Re-validate including new manifests
  const final = validateJsonFilesInDir(dir);
  return { integrity, sha256Files: files, validation: final };
}
