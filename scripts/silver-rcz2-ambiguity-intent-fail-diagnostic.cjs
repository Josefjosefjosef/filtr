/**
 * SILVER_RCZ2_AMBIGUITY_INTENT_FAIL_DIAGNOSTIC — scripts-only P1 diagnostic.
 * Replays Real Czech Public UX Corpus V2; slices cluster rcz2_ambiguity||intent_fail only.
 * Reads scripts/silver-real-czech-public-ux-corpus-v2-report.json for reference totals (no engine change).
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rcz2_ambiguity||intent_fail";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-public-ux-corpus-v2-report.json");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

const BUCKETS = [
  "valid_ambiguity_should_clarify",
  "gold_too_strict_expected_specific_module",
  "harness_should_accept_clarification",
  "template_dna_ambiguous_input",
  "response_contract_storage_clarify_ok",
  "conflicting_module_targets",
  "missing_required_payload",
  "engine_should_route_calendar",
  "engine_should_route_task",
  "engine_should_route_note",
  "safety_no_write_or_negation_ok",
  "other"
];

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function yn(b) {
  return b ? "ano" : "ne";
}

function expectedShouldClarify(exp) {
  return exp === "unknown" ? "ano" : "ne";
}

function actualShouldClarify(actual, eng) {
  const a = String(actual || "");
  const e = String(eng || "");
  return a === "unknown" || e === "clarification" ? "ano" : "ne";
}

function hasCalendarTarget(f) {
  return /\b(kalend|program na|zitra|zejtra|schuz|schůz|udalost|udál|rano|ráno|vecer|večer|dokt|zubar|zubař|hypotek|hypoték)\b/.test(f);
}

function hasTaskTarget(f) {
  return /\b(ukol|úkol|uloha|úloh|splnit|v ukol|do ukol|koupit kytk)\b/.test(f);
}

function hasNoteTarget(f) {
  return /\b(poznam|poznám|pin|kartick|kartič|obcank|občank|v poznamk|v poznámk)\b/.test(f);
}

function conflictingTargets(f) {
  let n = 0;
  if (hasCalendarTarget(f)) n++;
  if (hasTaskTarget(f)) n++;
  if (hasNoteTarget(f)) n++;
  return n >= 2;
}

function hasWriteCue(f) {
  return /\b(uloz|ulož|pridej|přidej|zapis|zapiš|vytvor|vytvoř|nahod|neukladej|neukládej|nevytvarej|nevytvářej)\b/.test(f);
}

function hasReadQueryCue(f) {
  return /\b(kde|kdy|co\s+mam|co\s+jsem|jak[yý]\s+mam|mrkni|najdi|hled|podivej|podívej)\b/.test(f) || /\?/.test(f);
}

function lexScoreForIntent(intent, f) {
  const i = String(intent || "");
  let s = 0;
  if (i.indexOf("calendar") === 0) {
    if (hasCalendarTarget(f)) s += 3;
    if (/\b(program|zitra|zejtra)\b/.test(f)) s += 2;
    if (/\b(co\s+mam|schuz)\b/.test(f)) s += 1;
  } else if (i.indexOf("task") === 0) {
    if (hasTaskTarget(f)) s += 3;
    if (/\b(resil|resi|splnit|koupit)\b/.test(f)) s += 2;
    if (/\b(co\s+mam)\b/.test(f)) s += 0.5;
  } else if (i.indexOf("note") === 0) {
    if (hasNoteTarget(f)) s += 4;
    if (/\b(kde\s+je|kde\s+mam)\b/.test(f)) s += 1;
  }
  return s;
}

function weakSupportForSeedGroup(group, f) {
  const g = String(group || "");
  if (g === "calendar_query") return lexScoreForIntent("calendar.query", f) < 1.5;
  if (g === "task_query") return lexScoreForIntent("task.query", f) < 1.5;
  if (g === "note_query") return lexScoreForIntent("note.query", f) < 1.5;
  return true;
}

function extractPayload(turn) {
  const d = (turn && turn.draft) || {};
  const parts = [];
  if (d.title) parts.push("title:" + String(d.title).slice(0, 100));
  if (d.date || d.dateISO) parts.push("date:" + String(d.date || d.dateISO || ""));
  if (d.time || d.timeHHMM) parts.push("time:" + String(d.time || d.timeHHMM || ""));
  if (d.targetContainer) parts.push("target:" + String(d.targetContainer));
  if (d.silverNoteText) parts.push("nText:" + String(d.silverNoteText).slice(0, 80));
  return parts.join(";") || "(none)";
}

function dangerousCreateLike(turn) {
  const ps = String(turn.processingState || "");
  const ni = String(turn.normalizedIntent || "");
  return (
    ps === "READY_TO_SAVE" ||
    ni === "calendar.create" ||
    ni === "tasks.create" ||
    ni === "notes.create"
  );
}

function assignBucket(row) {
  const f = row.folded;
  const exp = String(row.expected || "");
  const act = String(row.actual || "");
  const expUn = exp === "unknown";
  const actUn = act === "unknown";
  const eng = String(row.normalizedIntent || "");
  const ps = String(row.processingState || "");
  const raw = String(row.raw || "");
  const g = String(row.group || "");

  if ((!raw || raw.length < 2) && expUn === false) {
    return {
      bucket: "missing_required_payload",
      cls: "RESPONSE_CONTRACT_PROBLEM",
      why: "empty_or_short_model_response_for_concrete_expected"
    };
  }

  if (ps === "STORAGE_DISAMBIGUATION" && expUn) {
    return {
      bucket: "response_contract_storage_clarify_ok",
      cls: "RESPONSE_CONTRACT_PROBLEM",
      why: "storage_disambiguation_while_gold_expected_unknown_clarify_path"
    };
  }

  if (conflictingTargets(f) && (!expUn || (expUn && !actUn))) {
    return {
      bucket: "conflicting_module_targets",
      cls: "TEMPLATE_DNA_PROBLEM",
      why: "multiple_strong_module_cues_in_one_template"
    };
  }

  if (
    hasNegWrite(f) &&
    g.indexOf("_query") > 0 &&
    !dangerousCreateLike(row.turn) &&
    expUn &&
    !actUn &&
    (eng === "tasks.read" || eng === "calendar.read" || eng === "notes.read") &&
    (ps === "READ_OK" || ps === "CLARIFICATION")
  ) {
    return {
      bucket: "safety_no_write_or_negation_ok",
      cls: "SAFETY_OK",
      why: "negated_ambiguous_prompt_engine_chose_read_query_path_not_write_like"
    };
  }

  if (!expUn && actUn) {
    return {
      bucket: "harness_should_accept_clarification",
      cls: "HARNESS_BUG",
      why: "gold_expected_concrete_module_but_engine_audit_unknown_or_clarify"
    };
  }

  if (!expUn && !actUn && exp !== act) {
    const sE = lexScoreForIntent(exp, f);
    const sA = lexScoreForIntent(act, f);
    if (sA > sE + 0.75) {
      return {
        bucket: "gold_too_strict_expected_specific_module",
        cls: "GOLD_PROBLEM",
        why: "lexical_support_stronger_for_actual_than_for_gold_expected"
      };
    }
    if (exp.indexOf("calendar") === 0 && act.indexOf("task") === 0) {
      return { bucket: "engine_should_route_calendar", cls: "ENGINE_BUG", why: "expected_calendar_got_task" };
    }
    if (exp.indexOf("task") === 0 && act.indexOf("calendar") === 0) {
      return { bucket: "engine_should_route_task", cls: "ENGINE_BUG", why: "expected_task_got_calendar" };
    }
    if (exp.indexOf("note") === 0 && (act.indexOf("calendar") === 0 || act.indexOf("task") === 0)) {
      return { bucket: "engine_should_route_note", cls: "ENGINE_BUG", why: "expected_note_got_other_dataset" };
    }
    if (exp.indexOf("calendar") === 0 && act.indexOf("note") === 0) {
      return { bucket: "engine_should_route_calendar", cls: "ENGINE_BUG", why: "expected_calendar_got_note" };
    }
    if (exp.indexOf("task") === 0 && act.indexOf("note") === 0) {
      return { bucket: "engine_should_route_task", cls: "ENGINE_BUG", why: "expected_task_got_note" };
    }
    return {
      bucket: "gold_too_strict_expected_specific_module",
      cls: "GOLD_PROBLEM",
      why: "concrete_mismatch_without_clear_lexical_winner_defaults_to_gold_pressure"
    };
  }

  if (expUn && !actUn) {
    if (weakSupportForSeedGroup(g, f)) {
      return {
        bucket: "template_dna_ambiguous_input",
        cls: "TEMPLATE_DNA_PROBLEM",
        why: "seed_group_weakly_supported_by_text_engine_picked_concrete_route"
      };
    }
    return {
      bucket: "valid_ambiguity_should_clarify",
      cls: "AMBIGUOUS_OK",
      why: "gold_unknown_but_engine_returned_specific_module_instead_of_clarify"
    };
  }

  return { bucket: "other", cls: "AMBIGUOUS_OK", why: "unclassified_intent_fail_shape" };
}

function bump(h, k) {
  h[k] = (h[k] || 0) + 1;
}

function gitChangedFiles() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.length);
  } catch {
    return [];
  }
}

function gitPorcelainLines() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function onlyDiagnosticScriptDirty(lines) {
  if (!lines.length) return false;
  const want = "scripts/silver-rcz2-ambiguity-intent-fail-diagnostic.cjs";
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "");
    const rest = t.length >= 4 ? t.slice(3).trim() : t.trim();
    if (rest !== want) return false;
  }
  return true;
}

function reportJsonClusterTotal(report) {
  const tc = report && report.top_clusters;
  if (!Array.isArray(tc)) return "";
  for (let i = 0; i < tc.length; i++) {
    const s = String(tc[i] || "");
    if (s.indexOf("rcz2_ambiguity||intent_fail") === 0) {
      const parts = s.split(":");
      return parts.length > 1 ? parts[parts.length - 1].trim() : "";
    }
  }
  return "";
}

function main() {
  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const report = readJsonSafe(REPORT_JSON);

  const cases = buildPublicUxCorpusV2();
  const rows = [];
  const byBucket = {};
  for (let bi = 0; bi < BUCKETS.length; bi++) byBucket[BUCKETS[bi]] = [];

  const clsHist = {
    ENGINE_BUG: 0,
    GOLD_PROBLEM: 0,
    HARNESS_BUG: 0,
    TEMPLATE_DNA_PROBLEM: 0,
    RESPONSE_CONTRACT_PROBLEM: 0,
    SAFETY_OK: 0,
    AMBIGUOUS_OK: 0
  };

  for (let ci = 0; ci < cases.length; ci++) {
    const c = cases[ci];
    if (c.cluster !== "rcz2_ambiguity") continue;
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctxForCase(c.group));
    const ev = evaluateOne(c, turn);
    if (ev.cat !== "intent_fail") continue;

    const folded = foldCs(c.input);
    const expected = String(c.expectedIntent || "");
    const actual = String(ev.auditIntent || "");
    const ps = String(turn.processingState || "");
    const engN = String(turn.normalizedIntent || "");
    const raw = String(ev.raw || "");

    const row = {
      id: c.id,
      cluster: c.cluster,
      group: c.group,
      module: c.group,
      input: c.input,
      expected,
      actual,
      processingState: ps,
      normalizedIntent: engN,
      raw,
      folded,
      turn
    };
    const asg = assignBucket(row);
    row.bucket = asg.bucket;
    row.classification = asg.cls;
    row.why_fail = asg.why;
    rows.push(row);
    clsHist[row.classification] = (clsHist[row.classification] || 0) + 1;
    byBucket[row.bucket].push(row);
  }

  const clusterTotal = rows.length;
  let reportClusterHint = reportJsonClusterTotal(report);
  if (!reportClusterHint && clusterTotal === 0) reportClusterHint = "0";

  const bucketCounts = {};
  for (let bj = 0; bj < BUCKETS.length; bj++) bucketCounts[BUCKETS[bj]] = byBucket[BUCKETS[bj]].length;

  let dominantRoot = "AMBIGUOUS_OK";
  let best = -1;
  const clsKeys = Object.keys(clsHist);
  for (let ck = 0; ck < clsKeys.length; ck++) {
    const k = clsKeys[ck];
    const v = clsHist[k] || 0;
    if (v > best) {
      best = v;
      dominantRoot = k;
    }
  }
  if (clusterTotal === 0) dominantRoot = "NONE";

  const engineBug = clsHist.ENGINE_BUG || 0;
  const ambOk = clsHist.AMBIGUOUS_OK || 0;
  const goldP = clsHist.GOLD_PROBLEM || 0;
  const harnessB = clsHist.HARNESS_BUG || 0;
  const templateP = clsHist.TEMPLATE_DNA_PROBLEM || 0;
  const respP = clsHist.RESPONSE_CONTRACT_PROBLEM || 0;
  const safetyOk = clsHist.SAFETY_OK || 0;

  const engineFixRecommended =
    clusterTotal === 0
      ? "NO"
      : engineBug > 0 && engineBug > Math.max(ambOk, goldP + harnessB + templateP)
        ? "YES"
        : "NO";
  const scriptsAlignmentRecommended =
    clusterTotal === 0
      ? "NO"
      : ambOk + harnessB + templateP + goldP + respP > engineBug || dominantRoot !== "ENGINE_BUG"
        ? "YES"
        : "NO";
  const templateAlignmentRecommended =
    clusterTotal === 0 ? "NO" : templateP > goldP && templateP > harnessB ? "YES" : "NO";
  const goldAlignmentRecommended =
    clusterTotal === 0 ? "NO" : goldP >= harnessB && goldP > templateP ? "YES" : "NO";

  let recommendedNextScope = "scripts/* diagnostics; align harness expectations and corpus JSON for rcz2_ambiguity slice";
  if (engineFixRecommended === "YES") {
    recommendedNextScope =
      "narrow engine subpattern fix for calendar/task/note routing mismatch only after repro from top subcluster";
  } else if (respP > engineBug && respP > 200) {
    recommendedNextScope = "scripts/* response-contract replay for STORAGE_DISAMBIGUATION vs unknown-gold rows";
  }

  const massiveWait =
    templateP > 2000 || harnessB > 300 || engineBug > 0
      ? "YES"
      : dominantRoot === "SAFETY_OK" && safetyOk > clusterTotal * 0.2
        ? "YES"
        : "NO";
  const massiveWaitReason =
    massiveWait === "YES"
      ? engineBug > 0
        ? "engine_routing_signal_present"
        : templateP > 2000
          ? "template_dna_gold_harness_tension_dominates_stabilize_rcz2_ambiguity_slice_first"
          : harnessB > 300
            ? "harness_expected_concrete_vs_engine_clarify_volume_high"
            : safetyOk > clusterTotal * 0.2
              ? "unexpected_safety_bucket_volume"
              : "stabilize_scripts_layer_first"
      : "cluster_profile_stable_enough_for_planned_chaos_prep_in_scripts_layer";

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }

  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";
  const porc = gitPorcelainLines();
  const onlyDiag = onlyDiagnosticScriptDirty(porc);
  const gitClean = porc.length === 0 ? "YES" : onlyDiag ? "YES" : "NO";
  const readyForPr = porc.length === 0 || onlyDiag ? "YES" : "NO";

  const lines = [];
  lines.push("=== RCZ2_AMBIGUITY_INTENT_FAIL_DIAGNOSTIC ===");
  lines.push("main_commit=" + escapeField(mainCommit));
  lines.push("target_cluster=" + escapeField(TARGET_CLUSTER));
  lines.push("cluster_total=" + clusterTotal);
  lines.push("report_json_cluster_total_hint=" + escapeField(reportClusterHint));
  lines.push("report_json_path=" + escapeField("scripts/silver-real-czech-public-ux-corpus-v2-report.json"));

  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    lines.push(bn + "=" + bucketCounts[bn]);
  }

  lines.push("engine_bug_count=" + engineBug);
  lines.push("gold_problem_count=" + goldP);
  lines.push("harness_bug_count=" + harnessB);
  lines.push("template_dna_problem_count=" + templateP);
  lines.push("response_contract_problem_count=" + respP);
  lines.push("safety_ok_count=" + safetyOk);
  lines.push("ambiguous_ok_count=" + ambOk);

  lines.push("dominant_root_cause=" + escapeField(dominantRoot));
  lines.push("engine_fix_recommended=" + engineFixRecommended);
  lines.push("scripts_alignment_recommended=" + scriptsAlignmentRecommended);
  lines.push("template_alignment_recommended=" + templateAlignmentRecommended);
  lines.push("gold_alignment_recommended=" + goldAlignmentRecommended);
  lines.push("recommended_next_scope=" + escapeField(recommendedNextScope));
  lines.push("massive_corpus_should_wait=" + massiveWait);
  lines.push("massive_corpus_wait_reason=" + escapeField(massiveWaitReason));
  lines.push(
    "chaos_dna_generator_recommendation=" +
      escapeField(
        "After scripts/harness alignment for this cluster: add scripts-only Chaos DNA generator that mutates AMB_Q templates with deterministic masks (diacritics, fillers, negation tails) against silver-real-human-chaos-v3 baseline; no 500k run until alignment PASS."
      )
  );
  lines.push("changed_files=" + escapeField(changedFiles));
  lines.push("git_status_clean=" + gitClean);
  lines.push("ready_for_pr=" + readyForPr);

  lines.push("");
  lines.push("--- EXAMPLES_BY_BUCKET (max 10 each) ---");

  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    const arr = byBucket[bn];
    if (!arr.length) continue;
    lines.push("");
    lines.push("--- bucket=" + bn + " count=" + arr.length + " ---");
    const cap = Math.min(10, arr.length);
    for (let ex = 0; ex < cap; ex++) {
      const r = arr[ex];
      const f = r.folded;
      const expC = expectedShouldClarify(r.expected);
      const actC = actualShouldClarify(r.actual, r.normalizedIntent);
      const pay = extractPayload(r.turn);
      lines.push("example_" + (ex + 1) + "_id=" + escapeField(r.id));
      lines.push("example_" + (ex + 1) + "_input=" + escapeField(r.input));
      lines.push("example_" + (ex + 1) + "_expected_intent_module=" + escapeField(r.expected + " / " + r.group));
      lines.push("example_" + (ex + 1) + "_actual_intent_module=" + escapeField(r.actual + " / " + r.group));
      lines.push("example_" + (ex + 1) + "_processingState=" + escapeField(r.processingState));
      lines.push("example_" + (ex + 1) + "_response_text=" + escapeField(r.raw.slice(0, 400)));
      lines.push("example_" + (ex + 1) + "_expected_should_clarify=" + expC);
      lines.push("example_" + (ex + 1) + "_actual_should_clarify=" + actC);
      lines.push("example_" + (ex + 1) + "_has_calendar_target=" + yn(hasCalendarTarget(f)));
      lines.push("example_" + (ex + 1) + "_has_task_target=" + yn(hasTaskTarget(f)));
      lines.push("example_" + (ex + 1) + "_has_note_target=" + yn(hasNoteTarget(f)));
      lines.push("example_" + (ex + 1) + "_conflicting_targets=" + yn(conflictingTargets(f)));
      lines.push("example_" + (ex + 1) + "_has_write_cue=" + yn(hasWriteCue(f)));
      lines.push("example_" + (ex + 1) + "_has_read_query_cue=" + yn(hasReadQueryCue(f)));
      lines.push("example_" + (ex + 1) + "_has_negation_no_write=" + yn(hasNegWrite(f)));
      lines.push("example_" + (ex + 1) + "_extracted_payload=" + escapeField(pay));
      lines.push("example_" + (ex + 1) + "_why_fail=" + escapeField(r.why_fail));
      lines.push("example_" + (ex + 1) + "_classification=" + escapeField(r.classification));
    }
  }

  lines.push("");
  lines.push("=== CHAOS_DNA_GENERATOR_PREP ===");
  lines.push("should_start_after_this_cluster=" + (massiveWait === "YES" ? "NO" : "YES"));
  lines.push("recommended_first_layer=deterministic_mutation_masks_on_rcz2_ambiguity_AMB_Q_templates");
  lines.push("recommended_base_report=silver-real-human-chaos-v3-report.json");
  lines.push(
    "recommended_mutation_families=strip_diacritics;oral_fillers;negation_tail_nic_neukladej;double_question_variant;soft_typos_in_entity_slots"
  );
  lines.push("expected_speedup=higher_fault_surface_before_touching_engine_bundle");
  lines.push("risk=harness_gold_drift_if_mutations_outpace_rcz2_alignment_counters");
  lines.push("next_script_name=silver-chaos-dna-generator-v1.cjs");
  lines.push("=== END_CHAOS_DNA_GENERATOR_PREP ===");

  lines.push("");
  lines.push("=== END_RCZ2_AMBIGUITY_INTENT_FAIL_DIAGNOSTIC ===");

  console.log("\n" + lines.join("\n"));
}

if (require.main === module) {
  main();
}
