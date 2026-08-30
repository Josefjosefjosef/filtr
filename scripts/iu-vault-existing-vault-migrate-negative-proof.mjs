#!/usr/bin/env node
/**
 * Child proof: broken legacy_plaintext_only branch must fail migration guard check.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runGuardChildScript } from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE_PATH = path.join(REPO, "assets", "iu-vault-storage-v1.js");
const BACKUP_PATH = path.join(os.tmpdir(), "iu-vault-storage-v1-negative-proof-backup.js");

function breakLegacyPlaintextBranch(source) {
  const needle = `        if (!envelope) {
          captureNativeLocalStorage();
          const nativePlain = nativeGetItem(k);
          if (nativePlain != null) {
            pt = nativePlain;
            recordType = "legacy_plaintext_only";
          } else {
            continue;
          }
        } else if (!isVaultEnvelope(envelope)) {`;
  const broken = `        if (!envelope) {
          continue;
        } else if (!isVaultEnvelope(envelope)) {`;
  if (!source.includes(needle)) throw new Error("negative_proof_anchor_missing");
  return source.replace(needle, broken);
}

async function main() {
  const original = fs.readFileSync(STORAGE_PATH, "utf8");
  if (!original.includes("legacy_plaintext_only")) {
    console.error("NEGATIVE_PROOF_SKIP:storage_not_fixed");
    process.exit(1);
  }

  fs.writeFileSync(BACKUP_PATH, original, "utf8");
  fs.writeFileSync(STORAGE_PATH, breakLegacyPlaintextBranch(original), "utf8");

  let exitCode = 1;
  let out = "";
  try {
    const probeScript = path.join(REPO, "scripts", "iu-vault-existing-vault-migrate-probe.mjs");
    const probe = await runGuardChildScript(probeScript, ["expect-fail"], {
      cwd: REPO,
      env: { IU_GUARD_PORT: String(9100 + Math.floor(Math.random() * 900)) },
      timeoutMs: 90000,
      captureOutput: true,
    });
    out = String(probe.stdout || "") + String(probe.stderr || "");
    if (probe.timedOut) {
      console.error("NEGATIVE_PROOF_FAIL:probe_timeout");
      console.error(out);
      exitCode = 1;
    } else if (probe.status !== 0) {
      exitCode = 0;
    } else {
      console.error("NEGATIVE_PROOF_FAIL:broken_branch_still_passed");
      console.error(out);
      exitCode = 1;
    }
  } finally {
    const restore = fs.readFileSync(BACKUP_PATH, "utf8");
    fs.writeFileSync(STORAGE_PATH, restore, "utf8");
    if (!restore.includes("legacy_plaintext_only")) {
      console.error("NEGATIVE_PROOF_FAIL:restore_missing_legacy_branch");
      exitCode = 1;
    }
  }

  if (exitCode === 0) console.log("NEGATIVE_PROOF_PASS");
  process.exit(exitCode);
}

main().catch((e) => {
  try {
    if (fs.existsSync(BACKUP_PATH)) {
      fs.writeFileSync(STORAGE_PATH, fs.readFileSync(BACKUP_PATH, "utf8"), "utf8");
    }
  } catch (_) {}
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
