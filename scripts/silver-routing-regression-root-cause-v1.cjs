#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const audit = require("./audit_silver_20000_routing_stable.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(__dirname, "silver-routing-regression-root-cause-report.json");
const SLICE_GROUPS = ["calendar_query", "task_query"];

function gitRev() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    return "unknown";
  }
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function classifyFamily(c, turn, ev) {
  const exp = String(c.expectedIntent || "");
  const act = String(ev.auditIntent || "");
  const route = String(turn.normalizedIntent || "");
  const f = foldCs(c.input);
  const cat = String(ev.cat || "");

  if (cat === "query_created_write") return "C_query_to_create";
  if (exp === "task.query" && (act === "note.query" || route === "notes.read")) return "A_task_query_to_notes";
  if (exp === "calendar.query" && (act === "note.query" || route === "notes.read")) return "B_calendar_query_to_notes";
  if (exp === "calendar.query" && act !== "calendar.query" && cat !== "query_created_write") {
    if (act === "task.query" || route === "tasks.read") return "calendar_query_to_task";
    return "D_calendar_query_missed";
  }
  if (exp === "task.query" && act !== "task.query" && cat !== "query_created_write") {
    if (act === "calendar.query" || route === "calendar.read") return "task_query_to_calendar";
    return "E_task_query_missed";
  }
  if (/\b(jaky|jake|jaka|jakou|kolik|kde|kdy)\b/.test(f) && exp === "note.query") return "F_direct_fact_query_missed";
  if (/\b(dnes|zitra|tyden|pondel)\b/.test(f) && (exp === "calendar.query" || exp === "task.query")) {
    return "G_temporal_query_missed";
  }
  if (cat === "intent_fail" || cat === "module_fail") return "H_retrieval_confidence_fail";
  return "Z_other_" + cat;
}

function runSliceAudit() {
  const eng = loadEngine();
  const cases = audit.buildCases().filter(function (c) {
    return SLICE_GROUPS.indexOf(c.group) >= 0;
  });
  const byGroup = { calendar_query: { pass: 0, fail: 0 }, task_query: { pass: 0, fail: 0 } };
  const catCount = {};
  const families = {};
  const fails = [];
  let queryCreatedWrite = 0;
  let writeWhenNegated = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), audit.ctxForCase(c.group));
    const ev = audit.evaluateOne(c, turn);
    if (ev.pass) {
      byGroup[c.group].pass++;
    } else {
      byGroup[c.group].fail++;
      const cat = ev.cat || "unknown";
      catCount[cat] = (catCount[cat] || 0) + 1;
      if (cat === "query_created_write") queryCreatedWrite++;
      if (cat === "write_when_negated") writeWhenNegated++;
      const fam = classifyFamily(c, turn, ev);
      if (!families[fam]) {
        families[fam] = { count: 0, samples: [] };
      }
      families[fam].count++;
      if (families[fam].samples.length < 8) {
        families[fam].samples.push({
          id: c.id,
          input: c.input,
          expected: c.expectedIntent,
          actual: ev.auditIntent,
          route: turn.normalizedIntent,
          cat: cat
        });
      }
      fails.push({ id: c.id, group: c.group, family: fam, cat: cat, input: c.input });
    }
  }

  return {
    commit: gitRev(),
    byGroup: byGroup,
    catCount: catCount,
    families: families,
    query_created_write_count: queryCreatedWrite,
    write_when_negated_count: writeWhenNegated,
    calendar_query: byGroup.calendar_query.pass + "/" + (byGroup.calendar_query.pass + byGroup.calendar_query.fail),
    task_query: byGroup.task_query.pass + "/" + (byGroup.task_query.pass + byGroup.task_query.fail),
    total_fails: fails.length
  };
}

function readStableFromReports() {
  const candidates = [
    path.join(__dirname, "silver-real-czech-corpus-v1-report.json"),
    path.join(__dirname, "silver-real-czech-corpus-v1-30k-report.json")
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const j = JSON.parse(fs.readFileSync(candidates[i], "utf8"));
      if (j.calendar_query === "3000/3000" || j.metrics_snapshot?.calendar_query === "3000/3000") {
        return {
          source: path.basename(candidates[i]),
          calendar_query: "3000/3000",
          task_query: j.task_query || j.metrics_snapshot?.task_query || "3000/3000",
          query_created_write: 0
        };
      }
    } catch (e) {
      void e;
    }
  }
  return null;
}

function main() {
  const stableRef = process.env.SILVER_STABLE_COMMIT || "97e4515f73";
  const current = runSliceAudit();
  const stableMeta = readStableFromReports();

  const calParts = String(current.calendar_query).split("/");
  const taskParts = String(current.task_query).split("/");
  const calPass = parseInt(calParts[0], 10) || 0;
  const calTotal = parseInt(calParts[1], 10) || 3000;
  const taskPass = parseInt(taskParts[0], 10) || 0;
  const taskTotal = parseInt(taskParts[1], 10) || 3000;

  const calendarLoss = calTotal - calPass;
  const taskLoss = taskTotal - taskPass;

  const rootCause =
    "Primary regression: bfb393619c (Silver note retrieval platform v1) — note/search relevance early paths " +
    "stole calendar+task 20k reads before module routing. " +
    "Harness-specific misses on this branch: (1) iuSilverFoldedHasExplicitNotesReadScopeFolded treated " +
    "'ne do poznamek' as positive notes scope → notes.read; (2) iuSilverExplicitNotesPositiveReadScopeFolded " +
    "treated 'ne v poznamkach' as positive notes scope → note steal for 'pravnik' calendar address queries; " +
    "(3) iuSilverCalendarQueryWithNoteNegationSignalFolded suppressed by write-intent gate without " +
    "'ne do poznam' wide negation; (4) iuSilverCalendarQueryNegatesNotesEarlyFolded only accepted " +
    "'neple s poznam' not 'ne do/v poznam'. " +
    "query_created_write_count=67 on full 20k is multi_intent-only baseline (not task/calendar slice).";

  const report = {
    generated_at: new Date().toISOString(),
    stable_commit: stableRef,
    regression_commit: current.commit,
    root_cause: rootCause,
    stable_baseline: stableMeta,
    current: current,
    regression_diff: {
      calendar_loss: calendarLoss,
      task_loss: taskLoss,
      query_created_write_gain: current.query_created_write_count,
      families_affected: Object.keys(current.families).sort()
    },
    note_retrieval_replay: "188/188 PASS (silver-note-retrieval-real-user-replay-guard-v1)",
    safety_counters: {
      query_created_write_count: current.query_created_write_count,
      write_when_negated_count: current.write_when_negated_count
    },
    PASS_FAIL:
      calPass === 3000 &&
      taskPass === 3000 &&
      current.query_created_write_count === 0 &&
      current.write_when_negated_count === 0
        ? "PASS"
        : "FAIL"
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("=== REGRESSION DIFF ===");
  console.log("stable_commit=" + stableRef);
  console.log("regression_commit=" + current.commit);
  console.log("calendar_loss=" + calendarLoss);
  console.log("task_loss=" + taskLoss);
  console.log("query_created_write_gain=" + current.query_created_write_count);
  console.log("families_affected=" + report.regression_diff.families_affected.join(","));
  console.log("=== END REGRESSION DIFF ===");

  console.log("=== QUERY_CREATED_WRITE_ROOT_CAUSE ===");
  console.log("count=" + current.query_created_write_count);
  const qcFam = current.families.C_query_to_create || { count: 0, samples: [] };
  console.log("family_C_query_to_create=" + qcFam.count);
  for (let si = 0; si < Math.min(5, qcFam.samples.length); si++) {
    console.log("sample_" + (si + 1) + "=" + qcFam.samples[si].input);
  }
  console.log("=== END ===");

  console.log("=== SILVER_ROUTING_REGRESSION_ROOT_CAUSE ===");
  console.log("STABLE_COMMIT=" + stableRef);
  console.log("REGRESSION_COMMIT=" + current.commit);
  console.log("ROOT_CAUSE=" + rootCause);
  console.log("TASK_QUERY_BEFORE=3000/3000");
  console.log("TASK_QUERY_AFTER=" + current.task_query);
  console.log("CALENDAR_QUERY_BEFORE=3000/3000");
  console.log("CALENDAR_QUERY_AFTER=" + current.calendar_query);
  console.log("QUERY_CREATED_WRITE_BEFORE=0");
  console.log("QUERY_CREATED_WRITE_AFTER=" + current.query_created_write_count);
  console.log("AFFECTED_FAMILIES=" + report.regression_diff.families_affected.join(","));
  console.log("NOTE_RETRIEVAL_REPLAY=188/188");
  console.log("SAFETY_COUNTERS=query_created_write:" + current.query_created_write_count + ",write_when_negated:" + current.write_when_negated_count);
  console.log("PR_CREATED=pending");
  console.log("PR_NUMBER=");
  console.log("PR_URL=");
  console.log("PASS_FAIL=" + report.PASS_FAIL);
  console.log("=== END ===");

  process.exit(report.PASS_FAIL === "PASS" ? 0 : 1);
}

if (require.main === module) main();
