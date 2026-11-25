#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildCompletionAuditPack,
} from "./iu-cj-affiliate-phase3z-completion-audit-pack-v51-8.mjs";
import {
  validateEvidenceManifest,
  validateManifestSeal,
  sha256Hex,
} from "./iu-cj-affiliate-phase3z-audit-zip-integrity-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const outRoot = path.join(os.tmpdir(), "iu-cj-completion-audit-selftest");
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const built = buildCompletionAuditPack({
  outRoot,
  stamp: "selftest-" + Date.now(),
  evidence: {
    FINAL_REPORT: { schema: "final", ok: true },
    ACCEPTANCE_MATRIX: { schema: "matrix", items: [1, 2, 3] },
    OPEN_BLOCKERS: { blockers: [] },
  },
});

assert(built.ok === true, "pack ok");
assert(fs.existsSync(built.zipAbs), "zip exists");
assert(fs.existsSync(built.zipAbs + ".sha256"), "sha256 sidecar");
assert(fs.existsSync(built.zipAbs + ".crc32"), "crc32 sidecar");
assert(fs.existsSync(built.zipAbs + ".integrity.json"), "integrity sidecar");

const manAbs = path.join(built.workDir, "integrity-manifest.json");
assert(fs.existsSync(manAbs), "integrity-manifest.json present");
assert(fs.existsSync(path.join(built.workDir, "integrity-manifest.meta.json")), "meta seal present");
const man = JSON.parse(fs.readFileSync(manAbs, "utf8"));
assert(!man.files.some((f) => f.path === "MANIFEST.json"), "manifest excludes legacy self");
assert(!man.files.some((f) => /integrity-manifest/i.test(f.path)), "no integrity-manifest self-ref");

const imAbs = path.join(built.workDir, "INTEGRITY_MANIFEST.json");
assert(fs.existsSync(imAbs), "INTEGRITY_MANIFEST.json present");
const im = JSON.parse(fs.readFileSync(imAbs, "utf8"));
assert(Array.isArray(im.files), "INTEGRITY_MANIFEST.json files[] is array");
assert(
  !im.files.some((f) => path.posix.basename(String(f.path || f).replace(/\\/g, "/")) === "INTEGRITY_MANIFEST.json"),
  "INTEGRITY_MANIFEST.json files[] excludes itself",
);

const seal = validateManifestSeal(built.workDir);
assert(seal.ok, "seal ok: " + JSON.stringify(seal.failures));
const ev = validateEvidenceManifest(man, built.workDir);
assert(ev.ok, "evidence ok: " + JSON.stringify(ev.failures));

// Simulate the OLD bug: rewrite file-list AFTER hashing → must FAIL validation
const fileListAbs = path.join(built.workDir, "file-list.txt");
fs.writeFileSync(fileListAbs, fs.readFileSync(fileListAbs, "utf8") + "TAMPER\n", "utf8");
const broken = validateEvidenceManifest(
  JSON.parse(fs.readFileSync(manAbs, "utf8")),
  built.workDir,
);
assert(broken.ok === false, "tamper must fail");
assert(
  (broken.failures || []).some((f) => f.path === "file-list.txt" && /MISMATCH|SIZE/.test(f.code)),
  "detect file-list drift",
);

const zipSha = fs.readFileSync(built.zipAbs + ".sha256", "utf8").trim();
assert(zipSha === sha256Hex(fs.readFileSync(built.zipAbs)), "sidecar matches zip");

console.log(
  JSON.stringify({
    IU_CJ_COMPLETION_AUDIT_PACK_SELFTEST: "PASS",
    zip: built.zipName,
    detectedStaleManifestBug: true,
  }),
);
