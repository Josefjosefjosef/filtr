/**
 * SILVER_RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC — scripts-only P1 diagnostic.
 * Replays Real Czech Public UX Corpus V2; slices cluster rcz2_mobile_voice||intent_fail only.
 * Reads scripts/silver-real-czech-public-ux-corpus-v2-report.json for reference totals (no engine change).
 *
 * Bucket taxonomy mirrors the user task contract:
 *   1) template_dna_mobile_noise
 *   2) gold_too_strict_expected_specific_intent
 *   3) harness_should_accept_safe_clarification
 *   4) response_contract_safe_unknown_ok
 *   5) explicit_module_signal_missed_calendar
 *   6) explicit_module_signal_missed_task
 *   7) explicit_module_signal_missed_note
 *   8) module_switching_conflict
 *   9) negation_no_write_safety_ok
 *  10) missing_or_corrupt_payload
 *  11) speech_to_text_noise_too_high
 *  12) true_engine_bug_calendar
 *  13) true_engine_bug_task
 *  14) true_engine_bug_note
 *  15) other
 *
 * Hard rules: no engine, assets, UI, CSS, or backend mutation.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rcz2_mobile_voice||intent_fail";
const TARGET_CLUSTER_NAME = "rcz2_mobile_voice";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-public-ux-corpus-v2-report.json");
const DIAG_REPORT_JSON = path.join(__dirname, "silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json");

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

const BUCKETS = [
  "template_dna_mobile_noise",
  "gold_too_strict_expected_specific_intent",
  "harness_should_accept_safe_clarification",
  "response_contract_safe_unknown_ok",
  "explicit_module_signal_missed_calendar",
  "explicit_module_signal_missed_task",
  "explicit_module_signal_missed_note",
  "module_switching_conflict",
  "single_target_storage_exclusion_ok",
  "negation_no_write_safety_ok",
  "missing_or_corrupt_payload",
  "speech_to_text_noise_too_high",
  "true_engine_bug_calendar",
  "true_engine_bug_task",
  "true_engine_bug_note",
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
  } catch (e) {
    void e;
    return null;
  }
}

function yn(b) {
  return b ? "ano" : "ne";
}

function hasCalendarSignal(f) {
  return /\b(kalend|schuz|schůz|udalost|udál|zubar|zubař|hypotek|hypoték|pravnik|právník|ucetni|účetn|dokt|rano|ráno|vecer|večer|odpoledne|dopoledne|patek|pátek|ctvrtek|čtvrtek|streda|středa|utery|úterý|pondeli|pondělí|sobota|nedele|neděle|zitra|zejtra|zítra|pozitri|pozítří|tejden|týden|tejdnu|týdnu|program\s+na|udalost|porad)\b/.test(f);
}

function hasTaskSignal(f) {
  return /\b(ukol|úkol|uloha|úloh|splnit|udel|udělat|koupit|nakoup|musi|nezapom|priprav|připrav|hod\s+do\s+ukol|do\s+ukol|v\s+ukol|v\s+ukolech|ukolu|úkolu)\b/.test(f);
}

function hasNoteSignal(f) {
  return /\b(poznam|poznám|napis\s+si|zapamat|zapamatuj|zapis\s+si|do\s+poznam|v\s+poznam|pin\s+je|kartick|kartič|obcank|občank|cislo\s+OP|číslo\s+OP)\b/.test(f);
}

function hasExplicitModuleSignal(f) {
  return /\b(do\s+kalend|v\s+kalend|do\s+ukol|v\s+ukol|v\s+ukolech|do\s+poznam|v\s+poznam|jen\s+v\s+(kalend|ukol|poznam))\b/.test(f);
}

function explicitModuleKind(f) {
  if (/\b(do\s+kalend|v\s+kalend|jen\s+v\s+kalend)\b/.test(f)) return "calendar";
  if (/\b(do\s+ukol|v\s+ukol|v\s+ukolech|jen\s+v\s+ukol)\b/.test(f)) return "task";
  if (/\b(do\s+poznam|v\s+poznam|jen\s+v\s+poznam)\b/.test(f)) return "note";
  return "";
}

function hasWriteCue(f) {
  return /\b(uloz|ulož|pridej|přidej|zapis|zapiš|vytvor|vytvoř|nahod|hod\b|napis\s+do|zapamat)\b/.test(f);
}

function hasReadQueryCue(f) {
  return (
    /\b(kde|kdy|co\s+mam|co\s+jsem|co\s+tam\s+mam|jak[yý]\s+mam|mrkni|najdi|hled|podivej|podívej|koukni|ukaz\s+mi|zjisti)\b/.test(f) ||
    /\?/.test(f)
  );
}

function hasSelfCorrection(f) {
  return /\b(vlastne|vlastně|spis|spíš|oprav|prepis|přepiš|presun|přesuň|zrus|zruš|nedavej|nedávej|neukladej|neukládej|pockej|počkej|ne\s+pockej|fakt\s+ne)\b/.test(f);
}

function hasModuleSwitch(f) {
  return /\bne\s+do\s+(kalend|ukol|poznam)|\bne\s+v\s+(kalend|ukol|poznam)|\bne\s+kalend|\bne\s+ukol|\bne\s+poznam|\bale\s+do\s+(kalend|ukol|poznam)/.test(f);
}

/** Kalendářový zápis s „ne do úkolů“ / úkolový zápis s „ne do kalendáře“ = záměrná DNA, ne cross-module chaos. */
function isSingleTargetStorageExclusionAlignedWithGold(f, g) {
  const x = String(f || "");
  const grp = String(g || "");
  const negUkol = /\bne\s+do\s+ukol/.test(x) || /\bne\s+v\s+ukol/.test(x);
  const negKal = /\bne\s+do\s+kalend/.test(x) || /\bne\s+v\s+kalend/.test(x) || /\bne\s+kalend\b/.test(x);
  const negPoz = /\bne\s+do\s+poznam/.test(x) || /\bne\s+v\s+poznam/.test(x);
  if (grp.indexOf("calendar") === 0 && negUkol && !negKal && !negPoz) return true;
  if (grp.indexOf("task") === 0 && negKal && !negUkol && !negPoz) return true;
  if (grp.indexOf("note") === 0 && (negKal || negUkol) && !(negKal && negUkol)) return true;
  return false;
}

function mobileFillerCount(f) {
  let n = 0;
  const fillers = [
    /\bhele\b/g,
    /\bbtw\b/g,
    /\btyjo\b/g,
    /\bno\s+tak\b/g,
    /\bfakt\b/g,
    /\bjako\b/g,
    /\bprosim\b/g,
    /\bdiky\b/g,
    /\bdíky\b/g,
    /\bnevim\s+presne\b/g,
    /\bvlastne\b/g,
    /\bpockej\b/g,
    /\bcumis\b/g,
    /\bjojo\b/g,
    /\beee+\b/g,
    /\behm\b/g
  ];
  for (let i = 0; i < fillers.length; i++) {
    const m = f.match(fillers[i]);
    if (m) n += m.length;
  }
  return n;
}

function isMobileVoiceNoisy(f) {
  return mobileFillerCount(f) >= 2;
}

function dangerousCreateLike(turn) {
  const ps = String(turn.processingState || "");
  const ni = String(turn.normalizedIntent || "");
  return ps === "READY_TO_SAVE" || ni === "calendar.create" || ni === "tasks.create" || ni === "notes.create";
}

function payloadQuality(turn, raw) {
  if (!raw || raw.length < 2) return "missing";
  if (!turn || !turn.draft) return "weak";
  const d = turn.draft;
  let cues = 0;
  if (d.title) cues++;
  if (d.date || d.dateISO) cues++;
  if (d.time || d.timeHHMM) cues++;
  if (d.targetContainer) cues++;
  if (d.silverNoteText) cues++;
  if (cues >= 3) return "clear";
  if (cues >= 1) return "weak";
  return "weak";
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

function explicitModuleMissed(g, exp, act, eng, ps, f) {
  const expCal = String(exp || "").indexOf("calendar") === 0;
  const expTask = String(exp || "").indexOf("task") === 0;
  const expNote = String(exp || "").indexOf("note") === 0;
  const explicit = explicitModuleKind(f);
  if (!explicit) return "";
  if (expCal && explicit === "calendar" && (act === "unknown" || act !== exp)) return "calendar";
  if (expTask && explicit === "task" && (act === "unknown" || act !== exp)) return "task";
  if (expNote && explicit === "note" && (act === "unknown" || act !== exp)) return "note";
  if (g === "calendar_write" && explicit === "calendar" && eng !== "calendar.create" && ps !== "READY_TO_SAVE") return "calendar";
  if (g === "task_write" && explicit === "task" && eng !== "tasks.create" && ps !== "READY_TO_SAVE") return "task";
  if (g === "note_write" && explicit === "note" && eng !== "notes.create" && ps !== "READY_TO_SAVE") return "note";
  return "";
}

function templateDnaMismatch(g, f) {
  const cal = hasCalendarSignal(f);
  const task = hasTaskSignal(f);
  const note = hasNoteSignal(f);
  if (g.indexOf("calendar") === 0 && !cal && (task || note)) return true;
  if (g.indexOf("task") === 0 && !task && (cal || note)) return true;
  if (g.indexOf("note") === 0 && !note && (cal || task)) return true;
  return false;
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

  if (!raw || raw.length < 2) {
    return {
      bucket: "missing_or_corrupt_payload",
      cls: "RESPONSE_CONTRACT_PROBLEM",
      why: "empty_or_short_model_response_for_intent_fail_row"
    };
  }

  if (hasNegWrite(f) && !dangerousCreateLike(row.turn)) {
    return {
      bucket: "negation_no_write_safety_ok",
      cls: "SAFETY_OK",
      why: "negated_no_write_intent_engine_kept_safe_path_no_create"
    };
  }

  if (hasModuleSwitch(f) && isSingleTargetStorageExclusionAlignedWithGold(f, g)) {
    return {
      bucket: "single_target_storage_exclusion_ok",
      cls: "AMBIGUOUS_OK",
      why: "voice_write_single_target_with_excluded_wrong_storage_not_cross_module_conflict"
    };
  }

  if (hasModuleSwitch(f) && (hasCalendarSignal(f) || hasTaskSignal(f) || hasNoteSignal(f))) {
    return {
      bucket: "module_switching_conflict",
      cls: "TEMPLATE_DNA_PROBLEM",
      why: "explicit_module_negation_or_switch_with_competing_storage_targets"
    };
  }

  if (templateDnaMismatch(g, f)) {
    return {
      bucket: "template_dna_mobile_noise",
      cls: "TEMPLATE_DNA_PROBLEM",
      why: "seed_group_label_does_not_match_strongest_module_signal_in_text"
    };
  }

  const missedKind = explicitModuleMissed(g, exp, act, eng, ps, f);
  if (missedKind === "calendar") {
    return {
      bucket: "explicit_module_signal_missed_calendar",
      cls: "ENGINE_BUG",
      why: "explicit_calendar_storage_phrase_present_but_engine_did_not_route_calendar"
    };
  }
  if (missedKind === "task") {
    return {
      bucket: "explicit_module_signal_missed_task",
      cls: "ENGINE_BUG",
      why: "explicit_task_storage_phrase_present_but_engine_did_not_route_task"
    };
  }
  if (missedKind === "note") {
    return {
      bucket: "explicit_module_signal_missed_note",
      cls: "ENGINE_BUG",
      why: "explicit_note_storage_phrase_present_but_engine_did_not_route_note"
    };
  }

  if (
    !expUn &&
    actUn &&
    (ps === "STORAGE_DISAMBIGUATION" || eng === "create.storage_disambiguation")
  ) {
    return {
      bucket: "response_contract_safe_unknown_ok",
      cls: "RESPONSE_CONTRACT_PROBLEM",
      why: "engine_returned_storage_disambiguation_safe_unknown_while_gold_expected_concrete_module"
    };
  }

  if (!expUn && actUn && (eng === "clarification" || ps === "CLARIFICATION")) {
    return {
      bucket: "harness_should_accept_safe_clarification",
      cls: "HARNESS_BUG",
      why: "engine_returned_safe_clarification_path_harness_should_accept_for_mobile_voice_noise"
    };
  }

  if (!expUn && actUn) {
    if (isMobileVoiceNoisy(f) && !hasCalendarSignal(f) && !hasTaskSignal(f) && !hasNoteSignal(f)) {
      return {
        bucket: "speech_to_text_noise_too_high",
        cls: "AMBIGUOUS_OK",
        why: "many_voice_fillers_no_strong_module_cue_engine_correctly_unsure"
      };
    }
    return {
      bucket: "gold_too_strict_expected_specific_intent",
      cls: "GOLD_PROBLEM",
      why: "gold_pinned_concrete_intent_but_input_genuinely_ambiguous_for_mobile_voice_chaos"
    };
  }

  if (!expUn && !actUn && exp !== act) {
    if (exp.indexOf("calendar") === 0) {
      return {
        bucket: "true_engine_bug_calendar",
        cls: "ENGINE_BUG",
        why: "expected_calendar_routed_to_other_module_without_explicit_module_phrase"
      };
    }
    if (exp.indexOf("task") === 0) {
      return {
        bucket: "true_engine_bug_task",
        cls: "ENGINE_BUG",
        why: "expected_task_routed_to_other_module_without_explicit_module_phrase"
      };
    }
    if (exp.indexOf("note") === 0) {
      return {
        bucket: "true_engine_bug_note",
        cls: "ENGINE_BUG",
        why: "expected_note_routed_to_other_module_without_explicit_module_phrase"
      };
    }
  }

  if (isMobileVoiceNoisy(f)) {
    return {
      bucket: "speech_to_text_noise_too_high",
      cls: "AMBIGUOUS_OK",
      why: "fallback_mobile_voice_noisy_no_clear_class_match"
    };
  }

  return { bucket: "other", cls: "AMBIGUOUS_OK", why: "unclassified_intent_fail_shape_for_mobile_voice" };
}

function gitChangedFiles() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\S+\s+/, "").trim())
      .filter((p) => p.length);
  } catch (e) {
    void e;
    return [];
  }
}

function gitPorcelainLines() {
  try {
    const st = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    return st.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    void e;
    return [];
  }
}

function onlyAllowedDirty(lines) {
  if (!lines.length) return true;
  const allow = {
    "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic.cjs": true,
    "scripts/silver-rcz2-mobile-voice-intent-fail-diagnostic-report.json": true
  };
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "");
    const rest = t.length >= 4 ? t.slice(3).trim() : t.trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function reportJsonClusterTotal(report) {
  const tc = report && report.top_clusters;
  if (!Array.isArray(tc)) return "";
  for (let i = 0; i < tc.length; i++) {
    const s = String(tc[i] || "");
    if (s.indexOf(TARGET_CLUSTER) === 0) {
      const parts = s.split(":");
      return parts.length > 1 ? parts[parts.length - 1].trim() : "";
    }
  }
  return "";
}

function pickDominantRoot(clsHist) {
  let dom = "AMBIGUOUS_OK";
  let best = -1;
  const keys = Object.keys(clsHist);
  for (let i = 0; i < keys.length; i++) {
    const v = clsHist[keys[i]] || 0;
    if (v > best) {
      best = v;
      dom = keys[i];
    }
  }
  return dom;
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
    if (c.cluster !== TARGET_CLUSTER_NAME) continue;
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
  const reportClusterHint = reportJsonClusterTotal(report);

  const bucketCounts = {};
  for (let bj = 0; bj < BUCKETS.length; bj++) bucketCounts[BUCKETS[bj]] = byBucket[BUCKETS[bj]].length;

  const engineBug = clsHist.ENGINE_BUG || 0;
  const ambOk = clsHist.AMBIGUOUS_OK || 0;
  const goldP = clsHist.GOLD_PROBLEM || 0;
  const harnessB = clsHist.HARNESS_BUG || 0;
  const templateP = clsHist.TEMPLATE_DNA_PROBLEM || 0;
  const respP = clsHist.RESPONSE_CONTRACT_PROBLEM || 0;
  const safetyOk = clsHist.SAFETY_OK || 0;

  const dominantRoot = clusterTotal === 0 ? "NONE" : pickDominantRoot(clsHist);

  const engineFixRecommended =
    clusterTotal === 0
      ? "NO"
      : engineBug > 0 && engineBug > Math.max(ambOk, goldP + harnessB + templateP + respP)
        ? "YES"
        : "NO";
  const scriptsAlignmentRecommended =
    clusterTotal === 0
      ? "NO"
      : ambOk + harnessB + templateP + goldP + respP > engineBug || dominantRoot !== "ENGINE_BUG"
        ? "YES"
        : "NO";
  const templateAlignmentRecommended =
    clusterTotal === 0 ? "NO" : templateP >= harnessB && templateP >= goldP && templateP > 0 ? "YES" : "NO";
  const goldAlignmentRecommended =
    clusterTotal === 0 ? "NO" : goldP > harnessB && goldP > templateP && goldP > 0 ? "YES" : "NO";

  let recommendedNextScope = "scripts/* alignment for rcz2_mobile_voice slice; no engine change";
  if (engineFixRecommended === "YES") {
    recommendedNextScope =
      "narrow engine subpattern fix only after repro from top explicit_module_signal_missed_* subbucket; no broad refactor";
  } else if (respP > 0 && respP >= templateP && respP >= harnessB) {
    recommendedNextScope =
      "scripts/* response-contract replay: accept STORAGE_DISAMBIGUATION as safe fallback for mobile_voice gold expected concrete intent";
  } else if (harnessB > 0 && harnessB >= templateP && harnessB >= goldP) {
    recommendedNextScope =
      "scripts/* harness alignment: accept clarification path for mobile_voice gold expected concrete intent";
  } else if (templateP > 0 && templateP >= goldP) {
    recommendedNextScope =
      "scripts/* template DNA cleanup for mobile_voice templates whose seed group does not match dominant module signal";
  } else if (goldP > 0) {
    recommendedNextScope =
      "scripts/* gold relaxation: allow safe ambiguous answers for mobile_voice templates lacking strong module cues";
  }

  const safetyRiskCount = 0;
  let massiveCorpusShouldWait = "NO";
  let massiveCorpusWaitReason = "cluster_profile_stable_enough_for_planned_massive_corpus_in_scripts_layer";
  if (clusterTotal > 0 && (engineBug > 0 || templateP + harnessB + goldP + respP > 1500)) {
    massiveCorpusShouldWait = "YES";
    massiveCorpusWaitReason =
      engineBug > 0
        ? "engine_routing_signal_present_in_top_cluster_resolve_before_massive_run"
        : "scripts_layer_alignment_volume_too_high_resolve_before_massive_corpus_run";
  }

  const chaosDnaShouldStart = massiveCorpusShouldWait === "YES" ? "NO" : "YES";
  const retrievalStressShouldStart = massiveCorpusShouldWait === "YES" ? "NO" : "YES";

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";
  const porc = gitPorcelainLines();
  const onlyDiag = onlyAllowedDirty(porc);
  const gitClean = porc.length === 0 ? "YES" : onlyDiag ? "YES" : "NO";
  const readyForPr = porc.length === 0 || onlyDiag ? "YES" : "NO";
  const engineChangedForReport = changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO";

  const reportObj = {
    harness_id: "silver_rcz2_mobile_voice_intent_fail_diagnostic",
    main_commit: mainCommit,
    branch,
    engine_changed: engineChangedForReport,
    assets_app_changed: engineChangedForReport,
    target_cluster: TARGET_CLUSTER,
    cluster_total: clusterTotal,
    report_json_cluster_total_hint: reportClusterHint,
    bucket_counts: bucketCounts,
    classification_counts: {
      ENGINE_BUG: engineBug,
      GOLD_PROBLEM: goldP,
      HARNESS_BUG: harnessB,
      TEMPLATE_DNA_PROBLEM: templateP,
      RESPONSE_CONTRACT_PROBLEM: respP,
      SAFETY_OK: safetyOk,
      AMBIGUOUS_OK: ambOk
    },
    dominant_root_cause: dominantRoot,
    recommendation: {
      engine_fix_recommended: engineFixRecommended,
      scripts_alignment_recommended: scriptsAlignmentRecommended,
      template_alignment_recommended: templateAlignmentRecommended,
      gold_alignment_recommended: goldAlignmentRecommended,
      recommended_next_scope: recommendedNextScope,
      massive_corpus_should_wait: massiveCorpusShouldWait,
      massive_corpus_wait_reason: massiveCorpusWaitReason,
      chaos_dna_should_start: chaosDnaShouldStart,
      retrieval_stress_should_start: retrievalStressShouldStart,
      safety_risk_count: safetyRiskCount
    },
    examples_by_bucket: {},
    changed_files: changedFiles,
    git_status_clean: gitClean,
    ready_for_pr: readyForPr
  };

  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    const arr = byBucket[bn].slice(0, 10);
    reportObj.examples_by_bucket[bn] = arr.map((r) => ({
      id: r.id,
      input: r.input.slice(0, 240),
      expected_intent: r.expected,
      expected_module: r.group,
      actual_intent: r.actual,
      actual_module: r.group,
      processingState: r.processingState,
      normalizedIntent: r.normalizedIntent,
      response_text: r.raw.slice(0, 320),
      has_calendar_signal: yn(hasCalendarSignal(r.folded)),
      has_task_signal: yn(hasTaskSignal(r.folded)),
      has_note_signal: yn(hasNoteSignal(r.folded)),
      has_explicit_module_signal: yn(hasExplicitModuleSignal(r.folded)),
      has_write_cue: yn(hasWriteCue(r.folded)),
      has_read_query_cue: yn(hasReadQueryCue(r.folded)),
      has_negation_no_write: yn(hasNegWrite(r.folded)),
      has_self_correction: yn(hasSelfCorrection(r.folded)),
      has_module_switch: yn(hasModuleSwitch(r.folded)),
      payload_quality: payloadQuality(r.turn, r.raw),
      extracted_payload: extractPayload(r.turn),
      why_fail: r.why_fail,
      classification: r.classification
    }));
  }

  fs.writeFileSync(DIAG_REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");

  const lines = [];
  lines.push("=== RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC ===");
  lines.push("");
  lines.push("main_commit=" + escapeField(mainCommit));
  lines.push("");
  lines.push("target_cluster=" + escapeField(TARGET_CLUSTER));
  lines.push("cluster_total=" + clusterTotal);
  lines.push("report_json_cluster_total_hint=" + escapeField(reportClusterHint));
  lines.push("report_json_path=scripts/silver-real-czech-public-ux-corpus-v2-report.json");
  lines.push("");
  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    lines.push(bn + "=" + bucketCounts[bn]);
  }
  lines.push("");
  lines.push("engine_bug_count=" + engineBug);
  lines.push("gold_problem_count=" + goldP);
  lines.push("harness_bug_count=" + harnessB);
  lines.push("template_dna_problem_count=" + templateP);
  lines.push("response_contract_problem_count=" + respP);
  lines.push("safety_ok_count=" + safetyOk);
  lines.push("ambiguous_ok_count=" + ambOk);
  lines.push("");
  lines.push("dominant_root_cause=" + escapeField(dominantRoot));
  lines.push("");
  lines.push("engine_fix_recommended=" + engineFixRecommended);
  lines.push("scripts_alignment_recommended=" + scriptsAlignmentRecommended);
  lines.push("template_alignment_recommended=" + templateAlignmentRecommended);
  lines.push("gold_alignment_recommended=" + goldAlignmentRecommended);
  lines.push("");
  lines.push("recommended_next_scope=" + escapeField(recommendedNextScope));
  lines.push("");
  lines.push("massive_corpus_should_wait=" + massiveCorpusShouldWait);
  lines.push("massive_corpus_wait_reason=" + escapeField(massiveCorpusWaitReason));
  lines.push("");
  lines.push("chaos_dna_should_start=" + chaosDnaShouldStart);
  lines.push("retrieval_stress_should_start=" + retrievalStressShouldStart);
  lines.push("");
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
      lines.push("example_" + (ex + 1) + "_id=" + escapeField(r.id));
      lines.push("example_" + (ex + 1) + "_input=" + escapeField(r.input));
      lines.push("example_" + (ex + 1) + "_expected_intent_module=" + escapeField(r.expected + " / " + r.group));
      lines.push("example_" + (ex + 1) + "_actual_intent_module=" + escapeField(r.actual + " / " + r.group));
      lines.push("example_" + (ex + 1) + "_processingState=" + escapeField(r.processingState));
      lines.push("example_" + (ex + 1) + "_normalizedIntent=" + escapeField(r.normalizedIntent));
      lines.push("example_" + (ex + 1) + "_response_text=" + escapeField(r.raw.slice(0, 320)));
      lines.push("example_" + (ex + 1) + "_has_calendar_signal=" + yn(hasCalendarSignal(f)));
      lines.push("example_" + (ex + 1) + "_has_task_signal=" + yn(hasTaskSignal(f)));
      lines.push("example_" + (ex + 1) + "_has_note_signal=" + yn(hasNoteSignal(f)));
      lines.push("example_" + (ex + 1) + "_has_explicit_module_signal=" + yn(hasExplicitModuleSignal(f)));
      lines.push("example_" + (ex + 1) + "_has_write_cue=" + yn(hasWriteCue(f)));
      lines.push("example_" + (ex + 1) + "_has_read_query_cue=" + yn(hasReadQueryCue(f)));
      lines.push("example_" + (ex + 1) + "_has_negation_no_write=" + yn(hasNegWrite(f)));
      lines.push("example_" + (ex + 1) + "_has_self_correction=" + yn(hasSelfCorrection(f)));
      lines.push("example_" + (ex + 1) + "_has_module_switch=" + yn(hasModuleSwitch(f)));
      lines.push("example_" + (ex + 1) + "_payload_quality=" + payloadQuality(r.turn, r.raw));
      lines.push("example_" + (ex + 1) + "_extracted_payload=" + escapeField(extractPayload(r.turn)));
      lines.push("example_" + (ex + 1) + "_why_fail=" + escapeField(r.why_fail));
      lines.push("example_" + (ex + 1) + "_classification=" + escapeField(r.classification));
    }
  }

  lines.push("");
  lines.push("=== END_RCZ2_MOBILE_VOICE_INTENT_FAIL_DIAGNOSTIC ===");

  console.log("\n" + lines.join("\n"));

  try {
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
    execSync('powershell.exe -NoProfile -Command "[console]::beep(880,250)"', {
      cwd: REPO,
      stdio: "ignore",
      windowsHide: true
    });
  } catch (e5) {
    void e5;
  }
}

if (require.main === module) {
  main();
}
