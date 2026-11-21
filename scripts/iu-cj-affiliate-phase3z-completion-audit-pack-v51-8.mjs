#!/usr/bin/env node
/**
 * Deterministic completion audit pack builder.
 * Evidence files hashed into MANIFEST.json; MANIFEST.meta.json seals MANIFEST;
 * outer ZIP sha256/crc32 written as sibling sidecars (never inside ZIP).
 * Does NOT hash integrity-manifest.json as a self-referential entry.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  writeSealedEvidenceManifest,
  validateEvidenceManifest,
  validateManifestSeal,
  sha256Hex,
  crc32Hex,
  assertIntegrityOk,
} from "./iu-cj-affiliate-phase3z-audit-zip-integrity-v51-8.mjs";

function writeJson(abs, obj) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function listFilesRecursive(dirAbs, prefix = "") {
  const out = [];
  for (const ent of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (ent.name === "MANIFEST.json" || ent.name === "MANIFEST.meta.json") continue;
    const rel = prefix ? prefix + "/" + ent.name : ent.name;
    const abs = path.join(dirAbs, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(abs, rel));
    else out.push({ path: rel.replace(/\\/g, "/"), abs });
  }
  return out;
}

export function buildCompletionAuditPack(opts = {}) {
  const stamp =
    opts.stamp ||
    new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").slice(0, 15);
  const outRoot = opts.outRoot || path.join("C:/projects/iu-cj-audits");
  const workDir = path.join(outRoot, `_completion-wip-${stamp}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const evidence = opts.evidence || {};
  for (const [name, obj] of Object.entries(evidence)) {
    const file = name.endsWith(".json") ? name : name + ".json";
    writeJson(path.join(workDir, file), obj);
  }
  // file-list is generated AFTER evidence write, BEFORE manifest seal
  const preFiles = listFilesRecursive(workDir);
  const fileList = preFiles
    .map((f) => f.path)
    .sort()
    .join("\n") + "\n";
  fs.writeFileSync(path.join(workDir, "file-list.txt"), fileList, "utf8");

  const filesForManifest = listFilesRecursive(workDir);
  writeSealedEvidenceManifest(workDir, filesForManifest);

  const man = JSON.parse(fs.readFileSync(path.join(workDir, "MANIFEST.json"), "utf8"));
  const seal = validateManifestSeal(workDir);
  assertIntegrityOk(seal);
  const ev = validateEvidenceManifest(man, workDir);
  assertIntegrityOk(ev);

  const zipName = `phase3z-cj-robot-completion-${stamp}.zip`;
  const zipAbs = path.join(outRoot, zipName);
  if (fs.existsSync(zipAbs)) fs.unlinkSync(zipAbs);

  // Prefer PowerShell Compress-Archive on Windows for deterministic local packs
  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path (Join-Path '${workDir.replace(/'/g, "''")}' '*') -DestinationPath '${zipAbs.replace(/'/g, "''")}' -Force`,
      ],
      { encoding: "utf8" },
    );
    if (ps.status !== 0) {
      throw new Error("ZIP_COMPRESS_FAILED:" + (ps.stderr || ps.stdout || ""));
    }
  } else {
    const tar = spawnSync("tar", ["-a", "-cf", zipAbs, "-C", workDir, "."], { encoding: "utf8" });
    if (tar.status !== 0) throw new Error("ZIP_TAR_FAILED:" + (tar.stderr || ""));
  }

  const zipBuf = fs.readFileSync(zipAbs);
  const zipSha = sha256Hex(zipBuf);
  const zipCrc = crc32Hex(zipBuf);
  fs.writeFileSync(zipAbs + ".sha256", zipSha + "\n", "utf8");
  fs.writeFileSync(zipAbs + ".crc32", zipCrc + "\n", "utf8");
  writeJson(zipAbs + ".integrity.json", {
    schema: "iu-cj-affiliate-phase3z-completion-audit-integrity-v51-8",
    at: new Date().toISOString(),
    zip: zipName,
    sha256: zipSha,
    crc32: zipCrc,
    bytes: zipBuf.length,
    manifestSealOk: seal.ok,
    evidenceOk: ev.ok,
    fileCount: man.fileCount,
    selfReferenceRule:
      "MANIFEST.json excludes itself; MANIFEST.meta.json seals MANIFEST; ZIP hashes are external sidecars only",
  });

  // Post-zip independent re-validation of workDir (source of truth before zip)
  const reSeal = validateManifestSeal(workDir);
  const reEv = validateEvidenceManifest(
    JSON.parse(fs.readFileSync(path.join(workDir, "MANIFEST.json"), "utf8")),
    workDir,
  );

  return {
    ok: reSeal.ok && reEv.ok,
    workDir,
    zipAbs,
    zipName,
    sha256: zipSha,
    crc32: zipCrc,
    bytes: zipBuf.length,
    seal: reSeal,
    evidence: reEv,
  };
}

const isDirect = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith(
  "iu-cj-affiliate-phase3z-completion-audit-pack-v51-8.mjs",
);
if (isDirect) {
  const demo = buildCompletionAuditPack({
    stamp: "selftest",
    evidence: {
      FINAL_REPORT: { ok: true, note: "selftest-only" },
      ACCEPTANCE_MATRIX: { ok: true },
    },
  });
  console.log(JSON.stringify({ IU_CJ_COMPLETION_AUDIT_PACK_SELFTEST: demo.ok ? "PASS" : "FAIL", ...demo }, null, 2));
  if (!demo.ok) process.exit(2);
}
