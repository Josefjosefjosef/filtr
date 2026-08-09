#!/usr/bin/env node
/**
 * iu-data-pr-base-freshness-guard
 *
 * FAIL when a Data PR shared feed was built against an older main AND main since
 * changed CHMI / Info Events namespace digests. Compares semantic digests, not
 * commit SHA alone. Unrelated main commits (digest-stable) are NOT false-stale.
 *
 * Usage:
 *   node iu-data-pr-base-freshness-guard.mjs --binding <file> --main-ie <dir> [--main-sha <sha>]
 *   node iu-data-pr-base-freshness-guard.mjs --self-check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeSharedStateDigests,
  evaluateBaseFreshness,
  DATA_PR_FINALIZATION_PROTOCOL,
  PROTOCOL_FLAGS,
} from "./iu-data-pr-finalization-protocol.mjs";
import { readJson as readJsonFile } from "./info-events-shared-writer-critical.mjs";

const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

function parseArgs(argv) {
  const out = { binding: "", mainIe: "", mainSha: "", selfCheck: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-check") out.selfCheck = true;
    else if (a === "--binding") out.binding = String(argv[++i] || "");
    else if (a === "--main-ie") out.mainIe = String(argv[++i] || "");
    else if (a === "--main-sha") out.mainSha = String(argv[++i] || "");
  }
  return out;
}

function runSelfCheck() {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const proto = fs.readFileSync(
    path.join(ROOT, "scripts", "iu-data-pr-finalization-protocol.mjs"),
    "utf8"
  );
  const wf = fs.readFileSync(
    path.join(ROOT, ".github", "workflows", "update-ndic-datex-v1.yml"),
    "utf8"
  );
  ok("protocol_symbol", /DATA_PR_FINALIZATION_PROTOCOL/.test(proto));
  ok("evaluate_export", /export function evaluateBaseFreshness/.test(proto));
  ok("digest_export", /export function computeSharedStateDigests/.test(proto));
  ok("semantic_not_sha_only", /Semantic digests|not git SHA|NOT git SHA/i.test(proto));
  ok("wf_records_binding", /iu-data-pr-finalization-protocol\.mjs record-binding/.test(wf));
  ok("wf_no_whole_workflow_lock", !/^\s*concurrency:\s*$/m.test(wf.split(/\njobs:\s*\n/)[0]));
  ok("protocol_flags_no_whole_lock", PROTOCOL_FLAGS.WHOLE_WORKFLOW_SHARED_LOCK === "NO");
  if (fails.length) {
    console.error("DATA_PR_BASE_FRESHNESS_GUARD=FAIL");
    for (const f of fails) console.error("FAIL " + f);
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      DATA_PR_BASE_FRESHNESS_GUARD_PASS: "YES",
      DATA_PR_FINALIZATION_PROTOCOL,
      ...PROTOCOL_FLAGS,
    })
  );
  process.exit(0);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.selfCheck) {
    runSelfCheck();
    return;
  }
  if (!args.binding || !args.mainIe) {
    console.error(
      "Usage: node iu-data-pr-base-freshness-guard.mjs --binding <file> --main-ie <dir> [--main-sha <sha>]"
    );
    process.exit(2);
  }
  if (!fs.existsSync(args.binding)) {
    console.error(
      JSON.stringify({
        DATA_PR_BASE_FRESHNESS_GUARD_PASS: "NO",
        reason: "BINDING_MISSING",
      })
    );
    process.exit(1);
  }
  const recorded = readJsonFile(args.binding, null);
  const current = computeSharedStateDigests(args.mainIe);
  const result = evaluateBaseFreshness({
    recorded,
    currentMainDigests: current,
    currentMainSha: args.mainSha || recorded.baseMainSha || "",
  });
  const pass = result.ok === true && result.STALE !== true;
  console.log(
    JSON.stringify({
      DATA_PR_BASE_FRESHNESS_GUARD_PASS: pass ? "YES" : "NO",
      ...result,
      currentDigests: {
        chmiDigest: current.chmiDigest,
        infoEventsDigest: current.infoEventsDigest,
        ndicDigest: current.ndicDigest,
      },
    })
  );
  process.exit(pass ? 0 : 1);
}

main();
