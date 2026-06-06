/**
 * Skip duplicate update-articles run when another pipeline is already in_progress.
 * Does not cancel the active run — exits 0 with SKIPPED_DUPLICATE.
 */
import { execSync } from "child_process";

function log(msg) {
  console.log(`[pipeline-duplicate-gate] ${msg}`);
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const runId = String(process.env.GITHUB_RUN_ID || "");
  if (!repo || !runId) {
    log("proceed=true (not in GITHUB_ACTIONS)");
    process.exit(0);
  }
  let raw = "[]";
  try {
    raw = execSync(
      `gh run list --workflow update-articles.yml --repo ${repo} --status in_progress --json databaseId --jq "."`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    log("proceed=true (gh list failed)");
    process.exit(0);
  }
  let rows = [];
  try {
    rows = JSON.parse(raw);
  } catch {
    rows = [];
  }
  const other = rows.find((r) => String(r.databaseId) !== runId);
  if (other) {
    log(`SKIPPED_DUPLICATE active_run=${other.databaseId}`);
    log("final_status=SKIPPED_DUPLICATE");
    log("duplicate_run_detected=true");
    log("skipped_duplicate=true");
    process.exit(0);
  }
  log("proceed=true");
  log("duplicate_run_detected=false");
}

main();
