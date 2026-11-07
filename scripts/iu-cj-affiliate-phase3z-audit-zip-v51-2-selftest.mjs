#!/usr/bin/env node
/**
 * V51.2: audit ZIP generator — executive summary filled + post-pack integrity
 * derived from FINAL zip entry list (not stale pre-pack counts).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  finalizeAuditZip,
  validatePortableZip,
} from "./iu-cj-affiliate-phase3z-audit-zip-v1.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v512-zip-"));
const evidenceDir = path.join(root, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

fs.writeFileSync(
  path.join(evidenceDir, "01-executive-summary.json"),
  JSON.stringify({}),
  "utf8"
);
fs.writeFileSync(
  path.join(evidenceDir, "10-sample-ledger.json"),
  JSON.stringify({ rows: [{ eventKey: "a" }, { eventKey: "b" }] }, null, 2),
  "utf8"
);

const zipPath = path.join(root, "phase3z-v51-2-selftest.zip");

const result = finalizeAuditZip({
  evidenceDir,
  zipPath,
  phase: "3Z-V51.2-SELFTEST",
  refreshExecutiveSummary(dir, manifest) {
    const execPath = path.join(dir, "01-executive-summary.json");
    const exec = {
      schema: "iu-cj-affiliate-phase3z-v51-2-executive-summary",
      phase: "V51.2",
      filled: true,
      verdict: "SELFTEST",
      manifestFileCount: manifest.fileCount,
      evidenceFiles: manifest.files.map((f) => f.path),
      at: new Date().toISOString(),
    };
    fs.writeFileSync(execPath, JSON.stringify(exec, null, 2), "utf8");
  },
});

assert(result.ok === true, "finalize ok");
assert(result.exactNameParity === true, "exact-name parity");
assert(result.manifestEntries >= 2, "manifest has files");
assert(result.fileCount === result.manifestEntries + 1, "zip = manifest files + MANIFEST.json");
assert(result.postPack.stage === "FINAL_ZIP_OPENED", "postpack stage");
assert(result.postPack.verdict === "ZIP_INTEGRITY_PASS", "postpack PASS");
assert(result.postPack.zipEntryCount === result.fileCount, "postpack count matches");

const exec = JSON.parse(fs.readFileSync(path.join(evidenceDir, "01-executive-summary.json"), "utf8"));
assert(exec.filled === true, "executive filled");
assert(Object.keys(exec).length > 1, "executive not empty object");
assert(Array.isArray(exec.evidenceFiles) && exec.evidenceFiles.length > 0, "exec lists files");

const pre = JSON.parse(fs.readFileSync(path.join(evidenceDir, "92-integrity-prepack.json"), "utf8"));
assert(pre.stage === "PRE_ZIP_DISK_SNAPSHOT", "prepack labeled");
assert(/NOT a final ZIP check/i.test(pre.note), "prepack disclaimer");

const manPath = path.join(evidenceDir, "MANIFEST.json");
const v = validatePortableZip(zipPath, manPath);
assert(v.ok === true, "validate ok");

// Stale integrity must not be claimed as final — prepack note proves separation
assert(pre.diskFileCount !== undefined, "prepack has disk count");
assert(result.postPack.zipEntryCount >= pre.diskFileCount, "final >= prepack disk");

console.log(
  JSON.stringify({
    V51_2_AUDIT_ZIP_SELFTEST: "PASS",
    zipEntries: result.fileCount,
    manifestEntries: result.manifestEntries,
    exactNameParity: result.exactNameParity,
    sha256: result.sha256,
    executiveFilled: exec.filled,
  })
);
