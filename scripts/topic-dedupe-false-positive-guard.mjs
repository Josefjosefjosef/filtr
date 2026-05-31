/**
 * topic_dedupe_false_positive_guard — unit tests must pass (distinct stories not merged).
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function log(msg) {
  console.log(`[topic-dedupe-false-positive-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[topic-dedupe-false-positive-guard] FAIL: ${msg}`);
}

function main() {
  const py = process.platform === "win32" ? "py" : "python3";
  const args =
    process.platform === "win32"
      ? ["-3", path.join(root, "scripts", "test_iu_topic_dedupe.py")]
      : [path.join(root, "scripts", "test_iu_topic_dedupe.py")];
  const r = spawnSync(py, args, { cwd: root, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    fail("test_iu_topic_dedupe.py failed");
    process.exit(1);
  }
  log("false_positive_cases PASS");
  log("RESULT=PASS");
}

main();
