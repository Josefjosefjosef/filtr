#!/usr/bin/env node
/**
 * Cross-platform launcher: Windows uses `py -3`, POSIX uses `python3` / `python`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, "weather_pocasicko_guard.py");

const tries =
  process.platform === "win32"
    ? [["py", ["-3", script]], ["python", [script]], ["python3", [script]]]
    : [["python3", [script]], ["python", [script]]];

for (const [cmd, args] of tries) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (!r.error && typeof r.status === "number" && r.status === 0) {
    process.exit(0);
  }
}
process.exit(1);
