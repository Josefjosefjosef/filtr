#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSemanticNegativeProbesC5 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c5.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v518-c5-sem-"));
const out = runSemanticNegativeProbesC5(tmp);
if (!out.ok) {
  console.error(JSON.stringify({ IU_CJ_SEMANTIC_C5_SELFTEST: "FAIL", ...out }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ IU_CJ_SEMANTIC_C5_SELFTEST: "PASS", probes: out.results.length }));
