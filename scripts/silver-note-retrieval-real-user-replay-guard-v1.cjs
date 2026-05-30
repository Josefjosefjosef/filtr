#!/usr/bin/env node
"use strict";

const path = require("path");
const replay = require("./silver-note-retrieval-real-user-replay-v1.cjs");

const REPORT = path.join(__dirname, "silver-note-retrieval-real-user-replay-guard-v1-report.json");

function main() {
  const cases = replay.buildRealUserReplayCorpus();
  const res = replay.runRealUserReplayAudit(cases, REPORT);
  const r = res.report;

  console.log("=== REAL_USER_NOTE_RETRIEVAL_REPLAY_GUARD_V1 ===");
  console.log("REAL_USER_CASES=" + r.real_user_cases);
  console.log("REPLAY_CASES=" + r.replay_cases);
  console.log("REPLAY_PASS_RATE=" + r.replay_pass_rate);
  Object.keys(r.family_pass || {}).forEach(function (k) {
    console.log("FAMILY_" + k + "=" + r.family_pass[k]);
  });
  console.log("real_user_replay_pass=" + r.real_user_replay_pass);
  console.log("all_fail_families_pass=" + r.all_fail_families_pass);
  console.log("query_created_write_count=" + r.query_created_write_count);
  console.log("dangerous_write_count=" + r.dangerous_write_count);
  console.log("false_write_count=" + r.false_write_count);
  console.log("write_when_negated_count=" + r.write_when_negated_count);
  console.log("GUARD_CREATED=YES");
  console.log("PASS_FAIL=" + r.PASS_FAIL);
  if (r.first_fail) {
    console.log("first_fail_family=" + r.first_fail.replayFamily);
    console.log("first_fail_variant=" + r.first_fail.variant);
    console.log("first_fail_input=" + r.first_fail.input);
  }
  console.log("=== END_REAL_USER_NOTE_RETRIEVAL_REPLAY_GUARD_V1 ===");

  const ok =
    r.real_user_replay_pass === "YES" &&
    r.all_fail_families_pass === "YES" &&
    r.dangerous_write_count === 0 &&
    r.false_write_count === 0 &&
    r.query_created_write_count === 0 &&
    r.write_when_negated_count === 0 &&
    r.PASS_FAIL === "PASS";
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
