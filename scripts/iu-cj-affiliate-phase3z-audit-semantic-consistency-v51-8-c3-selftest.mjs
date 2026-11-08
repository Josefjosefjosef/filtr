#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSemanticNegativeProbesInTemp } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c3.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-v518-c3-sem-"));
const out = runSemanticNegativeProbesInTemp(tmp);
if (!out.ok) {
  console.error(JSON.stringify({ IU_CJ_SEMANTIC_C3_SELFTEST: "FAIL", ...out }, null, 2));
  process.exit(1);
}
console.log(
  JSON.stringify({
    IU_CJ_SEMANTIC_C3_SELFTEST: "PASS",
    probes: out.results.length,
    allNegativeDetected: true,
  })
);
