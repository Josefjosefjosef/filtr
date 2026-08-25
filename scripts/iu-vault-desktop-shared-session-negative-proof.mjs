#!/usr/bin/env node
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-desktop-shared-session-guard-v1.mjs");

const r = spawnSync(process.execPath, [script], {
  env: { ...process.env, IU_NEG_BLOCK_DESKTOP_SESSION_JOIN: "1" },
  encoding: "utf8",
  cwd: REPO,
});

const failedAsExpected = r.status !== 0;
console.log(JSON.stringify({
  IU_VAULT_DESKTOP_SHARED_SESSION_NEGATIVE_PROOF: failedAsExpected ? "PASS" : "FAIL",
  childStatus: r.status,
}));
if (!failedAsExpected) {
  console.error("IU_VAULT_DESKTOP_SHARED_SESSION_NEGATIVE_PROOF_FAIL");
  process.exit(1);
}
console.log("IU_VAULT_DESKTOP_SHARED_SESSION_NEGATIVE_PROOF_PASS");
