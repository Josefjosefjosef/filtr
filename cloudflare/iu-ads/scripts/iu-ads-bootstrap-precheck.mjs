#!/usr/bin/env node
/** CLI for bootstrap D1 precheck. Logic lives in iu-ads-bootstrap-precheck-lib.mjs */
import { readFileSync } from "node:fs";
import { evaluatePrecheck } from "./iu-ads-bootstrap-precheck-lib.mjs";

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return "";
  return String(process.argv[idx + 1] || "");
}

function readText(path) {
  if (!path) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const cmd = process.argv[2] || "";
if (cmd !== "evaluate") {
  console.error("ERROR: usage: evaluate --kind … --exit-code … --stdout-file … --stderr-file …");
  process.exit(2);
}

const result = evaluatePrecheck({
  kind: argValue("--kind"),
  exitCode: argValue("--exit-code"),
  stdout: readText(argValue("--stdout-file")),
  stderr: readText(argValue("--stderr-file")),
});
console.log("STATUS=" + result.status);
if (result.count != null) console.log("COUNT=" + String(result.count));
console.log("DETAIL=" + result.detail);
console.log("PROCESS_EXIT=" + String(result.processExit));
process.exit(0);
