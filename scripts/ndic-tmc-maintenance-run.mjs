#!/usr/bin/env node
/**
 * TMC maintenance CLI — NEVER part of 1min/15min DATEX hot path logic beyond bootstrap-if-missing.
 *
 * Modes:
 *   check | bootstrap | bootstrap-if-missing | import-buffer | rollback
 *
 * Env: IU_NDIC_TMC_LKG_ROOT, IU_NDIC_TMC_PULL_*, runner identity for network modes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { runTmcMaintenance, tmcMaintenancePublicSummary, measureStoreSizes } from "./ndic-datex-v1/tmc-maintenance.mjs";
import { loadPersistentTmcStore, defaultTmcLkgRoot } from "./ndic-datex-v1/tmc-persistent-store.mjs";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const mode = arg("--mode", "check");
  const root = arg("--root", defaultTmcLkgRoot(process.env));
  const bufferPath = arg("--buffer", null);
  const skipIdentity = hasFlag("--skip-runner-identity") || process.env.IU_NDIC_SKIP_RUNNER_IDENTITY === "1";

  if (mode === "bootstrap-if-missing") {
    const loaded = loadPersistentTmcStore({ root });
    if (loaded.ok) {
      const out = {
        ok: true,
        mode,
        reason: "already_present",
        meta: loaded.meta,
        sizes: measureStoreSizes(root),
      };
      console.log(JSON.stringify(out));
      return;
    }
  }

  const needsNetwork = ["bootstrap", "bootstrap-if-missing", "check"].includes(mode) && !bufferPath;
  if (needsNetwork && mode !== "check") {
    // check without forceDownload skips network inside runTmcMaintenance
  }
  if ((mode === "bootstrap" || mode === "bootstrap-if-missing") && !bufferPath && !skipIdentity) {
    assertNdicCzechEgressRunnerOrThrow(process.env);
  }

  let bodyBuf = null;
  if (bufferPath) {
    bodyBuf = fs.readFileSync(path.resolve(bufferPath));
  }

  const effectiveMode =
    mode === "bootstrap-if-missing" ? "bootstrap" : mode === "import-buffer" ? "bootstrap" : mode;

  const result = await runTmcMaintenance({
    mode: effectiveMode,
    root,
    bodyBuf,
    forceDownload: mode === "check" && hasFlag("--force-download"),
    skipDownload: mode === "check" && !hasFlag("--force-download") && !bodyBuf,
  });

  const summary = {
    ...tmcMaintenancePublicSummary(result),
    sizes: measureStoreSizes(root),
    root,
  };
  console.log(JSON.stringify(summary));
  if (!result.ok && result.reason !== "current_valid_no_download" && result.reason !== "same_version_no_activation" && result.reason !== "not_modified" && result.reason !== "already_present") {
    // bootstrap-if-missing failure is hard
    if (mode === "check" && (result.reason === "current_valid_no_download" || result.ok)) process.exit(0);
    process.exit(result.ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exit(1);
});
