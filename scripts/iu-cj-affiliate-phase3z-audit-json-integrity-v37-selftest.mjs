#!/usr/bin/env node
/**
 * V37 — audit JSON integrity selftest (offline).
 * Reproduces V36 literal \\n suffix bug and proves writeValidJsonFile / validateJsonFilesInDir.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  sanitizeJsonText,
  validateJsonFilesInDir,
  writeIntegrityManifests,
  writeValidJsonFile,
} from "./iu-cj-affiliate-phase3z-audit-json-integrity-v37.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v37-json-"));
const badPath = path.join(dir, "48-integrity-manifest.json");
// Reproduce V36 bug: JSON + literal backslash-n
fs.writeFileSync(badPath, '{\n  "fileCount": 1,\n  "algo": "sha256",\n  "reconcilePass": true\n}\\n', "utf8");
let threw = false;
try {
  JSON.parse(fs.readFileSync(badPath, "utf8"));
} catch {
  threw = true;
}
assert(threw, "V36-style file must fail JSON.parse");

const vBad = validateJsonFilesInDir(dir);
assert(vBad.ok === false, "validator catches bad file");
assert(vBad.failures.some((f) => f.error === "literal_backslash_n_suffix"), "detect literal \\n");

const fixed = sanitizeJsonText(fs.readFileSync(badPath, "utf8"));
JSON.parse(fixed);
assert(!/\}\\n\s*$/.test(fixed), "sanitize removes literal \\n");

writeValidJsonFile(path.join(dir, "00-sample.json"), { ok: true, n: 2 });
writeValidJsonFile(badPath, { fileCount: 1, algo: "sha256", reconcilePass: true });
const manifests = writeIntegrityManifests(dir, { reconcilePass: true });
assert(manifests.validation.ok === true, "all json valid after rewrite");
assert(manifests.integrity.jsonParsePass === true, "integrity jsonParsePass");

// Prove no literal \\n in written manifests
for (const name of ["48-integrity-manifest.json", "49-sha256-files.json", "00-sample.json"]) {
  const t = fs.readFileSync(path.join(dir, name), "utf8");
  assert(!/\}\\n\s*$/.test(t), "no literal suffix:" + name);
  JSON.parse(t);
}

console.log(
  JSON.stringify({
    IU_CJ_AUDIT_JSON_INTEGRITY_V37_SELFTEST: "PASS",
    validatedFiles: manifests.validation.fileCount,
    v36BugReproduced: true,
    fixed: true,
  })
);
