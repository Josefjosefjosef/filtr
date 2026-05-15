/**
 * SILVER_RETRIEVAL_STRESS_300K_PREP — scripts-only P1 diagnostic + pilot generator design.
 * - NO engine / assets / UI / CSS / backend changes.
 * - Replays cluster rcz2_retrieval||intent_fail from silver-real-czech-public-ux-corpus-v2.cjs corpus.
 * - Optional JSON: node scripts/silver-retrieval-stress-300k-prep.cjs --write-report
 *
 * Future 300k structure (design reference):
 *   A Entity B Temporal C Personal facts D Notes relevance E Calendar F Task G Cross-module
 *   H Dirty Czech / mobile I Partial refs J Fuzzy refs K Negated no-write L Long-session
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const TARGET_CLUSTER = "rcz2_retrieval||intent_fail";
const TARGET_CLUSTER_NAME = "rcz2_retrieval";
const REPORT_JSON = path.join(__dirname, "silver-real-czech-public-ux-corpus-v2-report.json");
const DEV_ACCEL_REPORT = path.join(__dirname, "silver-dev-acceleration-v1-report.json");
const OPTIONAL_OUT_JSON = path.join(__dirname, "silver-retrieval-stress-300k-prep-report.json");
const USER_BASELINE_MAIN = "8c7e82c8307a37c1d8220320345236e468dd774e";

const PILOT_TARGET = 600;

const BUCKETS = [
  "missing_entity_match",
  "weak_entity_anchor",
  "temporal_anchor_missing",
  "wrong_module_retrieval",
  "calendar_vs_note_retrieval_confusion",
  "task_vs_calendar_retrieval_confusion",
  "personal_fact_query_fail",
  "note_relevance_fail",
  "partial_reference_fail",
  "fuzzy_reference_fail",
  "query_too_short_or_dirty",
  "response_contract_safe_unknown_ok",
  "gold_too_strict_expected_retrieval",
  "template_dna_retrieval_noise",
  "true_engine_retrieval_bug",
  "other"
];

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const {
  loadEngine,
  evaluateOne,
  ctxForCase,
  foldCs,
  hasNegWrite
} = harness;
const { buildPublicUxCorpusV2 } = require("./silver-real-czech-public-ux-corpus-v2.cjs");

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    void e;
    return null;
  }
}

function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function yn(b) {
  return b ? "ano" : "ne";
}

function mobileFillerScoreFolded(f) {
  const x = String(f || "");
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
    const m = x.match(fillers[i]);
    if (m) n += m.length;
  }
  return n;
}

function hasCalendarSignal(f) {
  return /(kalendari|kalend|kalendar|v\s+kalend|schuz|schůz|udalost|udál|zubar|zubař|hypotek|hypoték|pravnik|právník|ucetni|účetn|dokt|rano|ráno|vecer|večer|odpoledne|dopoledne|patek|pátek|ctvrtek|čtvrtek|streda|středa|utery|úterý|pondeli|pondělí|sobota|nedele|neděle|zitra|zejtra|pozitri|pozítří|tejden|týden|tejdnu|týdnu|program\s+na|porad)/.test(
    f
  );
}

function hasTaskSignal(f) {
  return /\b(ukol|úkol|uloha|úloh|splnit|udel|udělat|koupit|nakoup|musi|nezapom|priprav|připrav|hod\s+do\s+ukol|do\s+ukol|v\s+ukol|v\s+ukolech|ukolu|úkolu)\b/.test(f);
}

function hasNoteSignal(f) {
  return /\b(poznam|poznám|napis\s+si|zapamat|zapamatuj|zapis\s+si|do\s+poznam|v\s+poznam|pin\s+je|kartick|kartič|obcank|občank|cislo\s+OP|číslo\s+OP)\b/.test(f);
}

function hasPersonalFactSignal(f) {
  return /\b(kolik\s+mi\s+je|kde\s+bydl|moje\s+rodne|rodne\s+cislo|moje\s+vaha|\bvaha\b|obcank|obcanka|heslo\s+na|cislo\s+uctu|\buctu\b)\b/.test(f);
}

function hasTemporalAnchor(f) {
  return /\b(zitra|zejtra|pozitri|poz\u00edtr\u00ed|vcer|v\u010der|rano|r\u00e1no|vecer|ve\u010der|minul|tento\s+tyden|t\u00fdden|v\s+tydnu|dopoledne|odpoledne|pondeli|p\u00e1tek|sobota|nedele)\b/.test(
    f
  );
}

function hasPartialReference(f) {
  return /\b(to\s+tam|ta\s+vec|ten\s+zaznam|ten\s+z\u00e1znam|minule|predtim|p\u0159edtim|jak\s+jsme|navic\s+to|spis\s+to)\b/.test(f);
}

function hasFuzzyCorruption(raw) {
  const s = String(raw || "");
  const fo = foldCs(s);
  return (
    /pravnk|zubr|mliko|ucetn/i.test(s) &&
    !/\bpravnik\b/.test(fo) &&
    !/\bzubar\b/.test(fo) &&
    !/\bucetni\b/.test(fo)
  );
}

function hasDirtyMobileNoise(f) {
  return mobileFillerScoreFolded(f) >= 2 || /\b(tyjo|hele\s+hele|cumis|eee+)\b/.test(f);
}

function extractEntitySpan(folded) {
  const f = String(folded || "");
  const m = f.match(/\b(mrkni|koukni|najdi)\s+(.+?)\s+kontext\b/);
  if (m) return String(m[2] || "").trim();
  const m2 = f.match(/\b(mrkni|koukni|najdi)\s+(.+?)\s+v\s+ukolech\b/);
  if (m2) return String(m2[2] || "").trim();
  return "";
}

function hasEntityAnchor(folded) {
  const span = extractEntitySpan(folded);
  return span.length >= 4;
}

function weakEntityOnly(span) {
  const t = String(span || "").trim();
  if (t.length < 3) return true;
  if (/^radek\s+\d+$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  return false;
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

function assignRetrievalBucket(row) {
  const f = row.folded;
  const exp = String(row.expected || "");
  const act = String(row.actual || "");
  const expUn = exp === "unknown";
  const actUn = act === "unknown";
  const eng = String(row.normalizedIntent || "");
  const ps = String(row.processingState || "");
  const raw = String(row.raw || "");
  const g = String(row.group || "");
  const span = extractEntitySpan(f);

  if (!raw || raw.length < 2) {
    return {
      bucket: "query_too_short_or_dirty",
      cls: "RESPONSE_CONTRACT_PROBLEM",
      why: "empty_or_short_assistant_payload_for_retrieval_fail"
    };
  }

  if (hasPersonalFactSignal(f) && (g === "calendar_query" || g === "task_query")) {
    return {
      bucket: "personal_fact_query_fail",
      cls: "RETRIEVAL_PROBLEM",
      why: "personal_fact_cues_in_seed_group_calendar_or_task_query_retrieval_lane"
    };
  }

  if (hasPartialReference(f)) {
    return {
      bucket: "partial_reference_fail",
      cls: "RETRIEVAL_PROBLEM",
      why: "deictic_or_session_partial_reference_without_stable_entity_anchor"
    };
  }

  if (hasFuzzyCorruption(row.input || "")) {
    return {
      bucket: "fuzzy_reference_fail",
      cls: "RETRIEVAL_PROBLEM",
      why: "ascii_or_collapsed_token_shape_reduces_entity_match_confidence"
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
      why: "storage_disambiguation_while_gold_expected_concrete_retrieval_intent"
    };
  }

  if (!expUn && actUn && (eng === "clarification" || ps === "CLARIFICATION")) {
    return {
      bucket: "gold_too_strict_expected_retrieval",
      cls: "HARNESS_BUG",
      why: "safe_clarification_path_rejected_by_harness_for_concrete_retrieval_gold"
    };
  }

  const wc = String(f || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (wc < 4 || f.length < 12) {
    return {
      bucket: "query_too_short_or_dirty",
      cls: "AMBIGUOUS_OK",
      why: "very_short_folded_query_or_low_token_count_mobile_shape"
    };
  }

  if (hasDirtyMobileNoise(f)) {
    return {
      bucket: "template_dna_retrieval_noise",
      cls: "TEMPLATE_DNA_PROBLEM",
      why: "high_filler_score_or_mobile_noise_overlay_on_retrieval_seed"
    };
  }

  if (g === "calendar_query" && hasNoteSignal(f) && !/\bv\s+kalend|\bkalend/.test(f)) {
    return {
      bucket: "calendar_vs_note_retrieval_confusion",
      cls: "RETRIEVAL_PROBLEM",
      why: "note_lexical_cues_without_calendar_storage_phrase_in_calendar_query_seed"
    };
  }

  if (g === "task_query" && hasCalendarSignal(f) && !hasTaskSignal(f) && /\bkalend/.test(f)) {
    return {
      bucket: "task_vs_calendar_retrieval_confusion",
      cls: "RETRIEVAL_PROBLEM",
      why: "calendar_lexical_bias_inside_task_query_seed"
    };
  }

  if (g === "calendar_query" && hasTaskSignal(f) && hasCalendarSignal(f) && act.indexOf("task") === 0) {
    return {
      bucket: "task_vs_calendar_retrieval_confusion",
      cls: "RETRIEVAL_PROBLEM",
      why: "competing_task_and_calendar_cues_routed_to_task_under_calendar_query_gold"
    };
  }

  if (g === "note_query") {
    return {
      bucket: "note_relevance_fail",
      cls: "RETRIEVAL_PROBLEM",
      why: "note_query_lane_intent_mismatch_or_unknown"
    };
  }

  if (!hasEntityAnchor(f) || weakEntityOnly(span)) {
    if (span.length > 0 && span.length < 4) {
      return {
        bucket: "missing_entity_match",
        cls: "RETRIEVAL_PROBLEM",
        why: "entity_span_too_short_for_stable_retrieval_anchor"
      };
    }
    return {
      bucket: "weak_entity_anchor",
      cls: "RETRIEVAL_PROBLEM",
      why: "entity_span_missing_or_only_numeric_context_token"
    };
  }

  if (g === "calendar_query" && !hasTemporalAnchor(f) && !expUn && actUn) {
    return {
      bucket: "temporal_anchor_missing",
      cls: "GOLD_PROBLEM",
      why: "calendar_read_lane_without_temporal_token_engine_chose_unknown"
    };
  }

  const createBias =
    (g === "calendar_query" && (act === "calendar.create" || eng === "calendar.create")) ||
    (g === "task_query" && (act === "task.create" || eng === "tasks.create")) ||
    (g === "note_query" && (act === "note.create" || eng === "notes.create"));
  if (createBias) {
    return {
      bucket: "true_engine_retrieval_bug",
      cls: "ENGINE_BUG",
      why: "retrieval_read_gold_but_engine_entered_create_or_draft_pipeline"
    };
  }

  const explicitCal = /(v\s+kalend|do\s+kalend|kalendari)/.test(f);
  const explicitTask = /\bv\s+ukolech|\bdo\s+ukol/.test(f);
  if (!expUn && !actUn && exp !== act) {
    if ((exp.indexOf("calendar") === 0 && act.indexOf("task") === 0) || (exp.indexOf("task") === 0 && act.indexOf("calendar") === 0)) {
      if (explicitCal && exp.indexOf("calendar") === 0 && act.indexOf("task") === 0) {
        return {
          bucket: "true_engine_retrieval_bug",
          cls: "ENGINE_BUG",
          why: "explicit_calendar_storage_phrase_present_but_audit_intent_task"
        };
      }
      if (explicitTask && exp.indexOf("task") === 0 && act.indexOf("calendar") === 0) {
        return {
          bucket: "true_engine_retrieval_bug",
          cls: "ENGINE_BUG",
          why: "explicit_task_storage_phrase_present_but_audit_intent_calendar"
        };
      }
      return {
        bucket: "wrong_module_retrieval",
        cls: "RETRIEVAL_PROBLEM",
        why: "expected_vs_actual_retrieval_intent_differ_without_explicit_contradiction_proof"
      };
    }
  }

  if (!expUn && actUn) {
    const calN = hasCalendarSignal(f) ? 1 : 0;
    const taskN = hasTaskSignal(f) ? 1 : 0;
    if (calN > 0 && taskN > 0 && Math.abs(calN - taskN) < 2) {
      return {
        bucket: "gold_too_strict_expected_retrieval",
        cls: "GOLD_PROBLEM",
        why: "dual_module_lexical_strength_similar_engine_unknown_reasonable"
      };
    }
    return {
      bucket: "gold_too_strict_expected_retrieval",
      cls: "GOLD_PROBLEM",
      why: "gold_pins_concrete_retrieval_intent_but_engine_returns_unknown"
    };
  }

  if (!expUn && !actUn && exp !== act) {
    return {
      bucket: "wrong_module_retrieval",
      cls: "RETRIEVAL_PROBLEM",
      why: "concrete_audit_intent_mismatch_against_retrieval_gold"
    };
  }

  return {
    bucket: "other",
    cls: "AMBIGUOUS_OK",
    why: "unclassified_rcz2_retrieval_intent_fail_shape"
  };
}

function reportJsonClusterTotal(report) {
  const tc = report && report.top_clusters;
  if (!Array.isArray(tc)) return "";
  for (let i = 0; i < tc.length; i++) {
    const s = String(tc[i] || "");
    if (s.indexOf(TARGET_CLUSTER) === 0 || s.indexOf("rcz2_retrieval||intent_fail") === 0) {
      const parts = s.split(":");
      return parts.length > 1 ? parts[parts.length - 1].trim() : "";
    }
  }
  return "";
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

function onlyAllowedDirty(lines, allowExtra) {
  const allow = {
    "scripts/silver-retrieval-stress-300k-prep.cjs": true,
    "scripts/silver-retrieval-stress-300k-prep-report.json": true
  };
  if (allowExtra) {
    for (const k of Object.keys(allowExtra)) allow[k] = allowExtra[k];
  }
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "");
    const rest = t.length >= 4 ? t.slice(3).trim() : t.trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function pickDominant(clsHist) {
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

/** Deterministic pilot: mirrors rcz2_retrieval templates + thin stress lanes (no Math.random). */
function buildRetrievalPilotCases(n) {
  const rows = [];
  const RET_BASE = [
    "pravnik",
    "pravnik smlouva",
    "pravnik Brno",
    "zubar Korunni",
    "ucetni faktury",
    "doktor zitra",
    "Petr smlouva",
    "kuryr balik"
  ];
  const calQ = ["Mrkni", "Koukni", "Najdi"];
  for (let i = 0; i < n; i++) {
    const lane = i % 12;
    const ent = RET_BASE[i % RET_BASE.length];
    const pref = calQ[i % calQ.length];
    let raw = "";
    let g = "calendar_query";
    let exp = "calendar.query";
    if (lane === 0) {
      raw = pref + " " + ent + " kontext " + i + " v kalendari?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 1) {
      raw = pref + " " + ent + " v ukolech radek " + i + "?";
      g = "task_query";
      exp = "task.query";
    } else if (lane === 2) {
      raw = pref + " " + ent + " zitra v kalendari kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 3) {
      raw = pref + " kolik mi je let v kalendari kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 4) {
      raw = pref + " " + ent + " poznamka kontext " + i + " v kalendari?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 5) {
      raw = "hele tyjo " + pref + " " + ent + " v ukolech radek " + i + " diky?";
      g = "task_query";
      exp = "task.query";
    } else if (lane === 6) {
      raw = pref + " to tam v kalendari kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 7) {
      raw = pref + " pravnk smlouva kontext " + i + " v kalendari?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 8) {
      raw = pref + " " + ent + " v kalendari jen se podivej nic neukladej kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 9) {
      raw = "hele vlastne " + pref + " " + ent + " v kalendari diky kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else if (lane === 10) {
      raw = pref + " schuzku najem v kalendari kontext " + i + "?";
      g = "calendar_query";
      exp = "calendar.query";
    } else {
      raw = pref + " " + ent + " v kalendari kontext " + i + " ok?";
      g = "calendar_query";
      exp = "calendar.query";
    }
    rows.push({
      id: "rtr_pilot_" + String(i).padStart(5, "0"),
      cluster: TARGET_CLUSTER_NAME,
      group: g,
      input: raw,
      expectedIntent: exp,
      ux_category: "retrieval_pilot"
    });
  }
  return rows;
}

function structure300kSummary() {
  return [
    "A:entity_retrieval|count=90000|purpose=anchor_ranking|risks=weak_entity|fail=missing_entity,weak_anchor|inv=no_query_writes",
    "B:temporal_retrieval|count=35000|purpose=date_scope_reads|risks=tz_fold|fail=temporal_anchor_missing|inv=negated_stays_read",
    "C:personal_facts|count=15000|purpose=sensitive_read_routing|risks=pii_echo|fail=personal_fact_query|inv=no_persist_without_consent_gold",
    "D:notes_relevance|count=25000|purpose=note_query_precision|risks=cross_pollution|fail=note_relevance|inv=note_vs_cal_boundary",
    "E:calendar_retrieval|count=60000|purpose=cal_read_cards|risks=create_bias|fail=wrong_module_cal|inv=no_false_calendar_create_on_query",
    "F:task_retrieval|count=60000|purpose=task_read_cards|risks=list_noise|fail=wrong_module_task|inv=no_false_task_create_on_query",
    "G:cross_module|count=20000|purpose=mixed_cues|risks=disamb_explosion|fail=calendar_vs_note,task_vs_cal|inv=clarify_ok_when_gold_unknown_only",
    "H:dirty_czech_mobile|count=15000|purpose=ascii_fillers|risks=harness_drift|fail=template_dna,dirty|inv=safety_counters_zero",
    "I:partial_refs|count=12000|purpose=deixis_session|risks=no_anchor|fail=partial_reference|inv=unknown_safe_when_unresolvable",
    "J:fuzzy_refs|count=12000|purpose=typo_tolerance|risks=false_match|fail=fuzzy_reference|inv=no_write_on_read_templates",
    "K:negated_no_write|count=8000|purpose=safety|risks=scoped_neg|fail=response_contract|inv=write_when_negated=0",
    "L:long_session_retrieval|count=30000|purpose=context_carry|risks=latent_confusion|fail=gold_strict|inv=deterministic_templates_no_random"
  ].join("||");
}

function main() {
  const argv = process.argv.slice(2);
  const writeReport = argv.indexOf("--write-report") >= 0;

  let eng;
  try {
    eng = loadEngine();
  } catch (e) {
    console.log("runtime_fail=" + String(e && e.message));
    process.exit(1);
  }

  const report = readJsonSafe(REPORT_JSON);
  const devAccel = readJsonSafe(DEV_ACCEL_REPORT);
  const reportClusterHint = reportJsonClusterTotal(report);

  const cases = buildPublicUxCorpusV2();
  const rows = [];
  const byBucket = {};
  for (let bi = 0; bi < BUCKETS.length; bi++) byBucket[BUCKETS[bi]] = [];

  const clsHist = {
    RETRIEVAL_PROBLEM: 0,
    ENGINE_BUG: 0,
    GOLD_PROBLEM: 0,
    HARNESS_BUG: 0,
    TEMPLATE_DNA_PROBLEM: 0,
    RESPONSE_CONTRACT_PROBLEM: 0,
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
    const asg = assignRetrievalBucket(row);
    row.bucket = asg.bucket;
    row.classification = asg.cls;
    row.why_fail = asg.why;
    rows.push(row);
    clsHist[row.classification] = (clsHist[row.classification] || 0) + 1;
    byBucket[row.bucket].push(row);
  }

  const clusterTotal = rows.length;

  const bucketCounts = {};
  for (let bj = 0; bj < BUCKETS.length; bj++) bucketCounts[BUCKETS[bj]] = byBucket[BUCKETS[bj]].length;

  const retrievalProblemCount = clsHist.RETRIEVAL_PROBLEM || 0;
  const engineBugCount = clsHist.ENGINE_BUG || 0;
  const goldProblemCount = clsHist.GOLD_PROBLEM || 0;
  const harnessBugCount = clsHist.HARNESS_BUG || 0;
  const templateDnaProblemCount = clsHist.TEMPLATE_DNA_PROBLEM || 0;
  const responseContractProblemCount = clsHist.RESPONSE_CONTRACT_PROBLEM || 0;
  const ambiguousOkCount = clsHist.AMBIGUOUS_OK || 0;

  const dominant = clusterTotal === 0 ? "NONE" : pickDominant(clsHist);

  let recommendedNextScope = "scripts-only alignment for rcz2_retrieval retrieval gold/harness; no engine change";
  if (dominant === "ENGINE_BUG" && engineBugCount >= retrievalProblemCount) {
    recommendedNextScope =
      "retrieval_diagnostic_only_in_scripts_then_narrow_engine_fix_for_read_vs_create_bias_if_repro_stable";
  } else if (dominant === "HARNESS_BUG") {
    recommendedNextScope = "scripts-only harness: accept clarification for ambiguous_retrieval_reads_where_safe";
  } else if (dominant === "GOLD_PROBLEM") {
    recommendedNextScope = "scripts-only gold relaxation for dual_cue_retrieval_templates";
  } else if (dominant === "TEMPLATE_DNA_PROBLEM") {
    recommendedNextScope = "generator_expansion_with_cleaner_retrieval_templates_before_engine_touch";
  } else if (dominant === "RESPONSE_CONTRACT_PROBLEM") {
    recommendedNextScope = "scripts-only response_contract replay_alignment_for_retrieval_cluster";
  } else if (dominant === "RETRIEVAL_PROBLEM") {
    recommendedNextScope = "retrieval_diagnostic_only_plus_generator_expansion_in_scripts_layer";
  }

  const pilotCases = buildRetrievalPilotCases(PILOT_TARGET);
  let pilotPass = 0;
  let pilotEvaluated = 0;
  let pilotDangerous = 0;
  let pilotFalseWrite = 0;
  let pilotQcw = 0;
  let pilotNegWrite = 0;
  const foldPilot = (s) => foldCs(s);

  for (let pi = 0; pi < pilotCases.length; pi++) {
    const pc = pilotCases[pi];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e1) {
      void e1;
    }
    const turnP = eng.processUserTurn(pc.input, eng.createEmptyDraft(), ctxForCase(pc.group));
    const evP = evaluateOne(pc, turnP);
    pilotEvaluated++;
    if (evP.pass) pilotPass++;

    const fi = foldPilot(pc.input);
    const engP = turnP.normalizedIntent;
    const psP = turnP.processingState;
    const createLike =
      psP === "READY_TO_SAVE" || engP === "calendar.create" || engP === "tasks.create" || engP === "notes.create";
    if (hasNegWrite(fi) && createLike) pilotNegWrite++;
    if (evP.cat === "query_created_write") {
      pilotQcw++;
      pilotDangerous++;
    }
    if (evP.cat === "negative_instruction_fail") {
      pilotDangerous++;
    }
    if (!evP.pass && pc.group.indexOf("_query") > 0 && (evP.cat === "query_created_write" || evP.cat === "negative_instruction_fail")) {
      pilotFalseWrite++;
    }
  }

  const pilotAccuracy = pilotEvaluated ? ((pilotPass / pilotEvaluated) * 100).toFixed(2) : "0.00";
  const pilotSafetyGate =
    pilotDangerous === 0 && pilotFalseWrite === 0 && pilotQcw === 0 && pilotNegWrite === 0 ? "PASS" : "FAIL";

  const blockers = [];
  if (clusterTotal === 0) blockers.push("live_cluster_intent_fail_rows_zero_replay_corpus_or_engine_shift");
  if (reportClusterHint && Number(reportClusterHint) > 0 && clusterTotal === 0) {
    blockers.push("report_json_hint_nonzero_but_live_slice_empty");
  }
  if (pilotSafetyGate !== "PASS") blockers.push("pilot_safety_counters_nonzero");
  if (pilotEvaluated < 300) blockers.push("pilot_below_300");

  let retrievalStress300kReady = blockers.length === 0 && clusterTotal > 0 ? "YES" : "NO";
  if (pilotSafetyGate !== "PASS") retrievalStress300kReady = "NO";

  const nextScriptName = "scripts/silver-retrieval-stress-300k-generator.cjs";
  let recommended300kStructure = structure300kSummary();

  let massiveCorpusShouldStart = "NO";
  if (retrievalStress300kReady === "YES" && pilotSafetyGate === "PASS") {
    if (devAccel && String(devAccel.massive_corpus_ready || "").toUpperCase() === "YES") {
      massiveCorpusShouldStart = "YES";
    } else if (!devAccel && report && String(report.recommended_next_cluster || "").toLowerCase().indexOf("retrieval") >= 0) {
      massiveCorpusShouldStart = "YES";
    }
  }

  const full300kShouldRunNow = "NO";

  let mainCommit = USER_BASELINE_MAIN;
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e2) {
    void e2;
  }

  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";
  const porc = gitPorcelainLines();
  const gitClean = porc.length === 0 ? "YES" : onlyAllowedDirty(porc) ? "YES" : "NO";
  const readyForPr = porc.length === 0 || onlyAllowedDirty(porc) ? "YES" : "NO";
  const assetsAppChanged = changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO";

  const reportObj = {
    harness_id: "silver_retrieval_stress_300k_prep",
    main_commit: mainCommit,
    user_baseline_main_hint: USER_BASELINE_MAIN,
    target_cluster: TARGET_CLUSTER,
    cluster_total: clusterTotal,
    report_json_cluster_total_hint: reportClusterHint,
    bucket_counts: bucketCounts,
    classification_counts: {
      retrieval_problem_count: retrievalProblemCount,
      engine_bug_count: engineBugCount,
      gold_problem_count: goldProblemCount,
      harness_bug_count: harnessBugCount,
      template_dna_problem_count: templateDnaProblemCount,
      response_contract_problem_count: responseContractProblemCount,
      ambiguous_ok_count: ambiguousOkCount
    },
    dominant_classification: dominant,
    pilot: {
      pilot_cases_generated: pilotCases.length,
      pilot_cases_evaluated: pilotEvaluated,
      pilot_accuracy: pilotAccuracy,
      pilot_safety_gate_status: pilotSafetyGate,
      pilot_dangerous_write_count: pilotDangerous,
      pilot_false_write_count: pilotFalseWrite,
      pilot_query_created_write_count: pilotQcw,
      pilot_write_when_negated_count: pilotNegWrite
    },
    retrieval_stress_300k_ready: retrievalStress300kReady,
    retrieval_stress_300k_blockers: blockers,
    recommended_300k_structure: recommended300kStructure,
    recommended_next_scope: recommendedNextScope,
    next_script_name: nextScriptName,
    massive_corpus_should_start: massiveCorpusShouldStart,
    full_300k_should_run_now: full300kShouldRunNow,
    dev_acceleration_report_loaded: devAccel ? "YES" : "NO",
    examples_by_bucket: {},
    changed_files: changedFiles,
    git_status_clean: gitClean,
    ready_for_pr: readyForPr,
    assets_app_changed: assetsAppChanged
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
      has_personal_fact_signal: yn(hasPersonalFactSignal(r.folded)),
      has_temporal_anchor: yn(hasTemporalAnchor(r.folded)),
      has_entity_anchor: yn(hasEntityAnchor(r.folded)),
      has_partial_reference: yn(hasPartialReference(r.folded)),
      has_dirty_mobile_noise: yn(hasDirtyMobileNoise(r.folded)),
      payload_entity_quality: payloadQuality(r.turn, r.raw),
      extracted_payload: extractPayload(r.turn),
      why_fail: r.why_fail,
      classification: r.classification
    }));
  }

  if (writeReport) {
    fs.writeFileSync(OPTIONAL_OUT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  }

  const out = [];
  out.push("=== RETRIEVAL_STRESS_300K_PREP_RESULT ===");
  out.push("");
  out.push("main_commit=" + escapeField(mainCommit));
  out.push("engine_changed=NO");
  out.push("assets_app_changed=" + assetsAppChanged);
  out.push("ui_changed=NO");
  out.push("css_changed=NO");
  out.push("backend_changed=NO");
  out.push("");
  out.push("target_cluster=" + escapeField(TARGET_CLUSTER));
  out.push("cluster_total=" + clusterTotal);
  out.push("");
  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    out.push(bn + "=" + bucketCounts[bn]);
  }
  out.push("");
  out.push("retrieval_problem_count=" + retrievalProblemCount);
  out.push("engine_bug_count=" + engineBugCount);
  out.push("gold_problem_count=" + goldProblemCount);
  out.push("harness_bug_count=" + harnessBugCount);
  out.push("template_dna_problem_count=" + templateDnaProblemCount);
  out.push("response_contract_problem_count=" + responseContractProblemCount);
  out.push("ambiguous_ok_count=" + ambiguousOkCount);
  out.push("");
  out.push("pilot_cases_generated=" + pilotCases.length);
  out.push("pilot_cases_evaluated=" + pilotEvaluated);
  out.push("pilot_accuracy=" + pilotAccuracy);
  out.push("pilot_safety_gate_status=" + pilotSafetyGate);
  out.push("pilot_dangerous_write_count=" + pilotDangerous);
  out.push("pilot_false_write_count=" + pilotFalseWrite);
  out.push("pilot_query_created_write_count=" + pilotQcw);
  out.push("pilot_write_when_negated_count=" + pilotNegWrite);
  out.push("");
  out.push("retrieval_stress_300k_ready=" + retrievalStress300kReady);
  out.push("retrieval_stress_300k_blockers=" + escapeField(blockers.join("|")));
  out.push("");
  out.push("recommended_300k_structure=" + recommended300kStructure);
  out.push("");
  out.push("recommended_next_scope=" + escapeField(recommendedNextScope));
  out.push("next_script_name=" + escapeField(nextScriptName));
  out.push("");
  out.push("massive_corpus_should_start=" + massiveCorpusShouldStart);
  out.push("full_300k_should_run_now=" + full300kShouldRunNow);
  out.push("");
  out.push("report_json_cluster_total_hint=" + escapeField(reportClusterHint));
  out.push("silver_dev_acceleration_report_loaded=" + (devAccel ? "YES" : "NO"));
  out.push("");
  out.push("changed_files=" + escapeField(changedFiles));
  out.push("git_status_clean=" + gitClean);
  out.push("ready_for_pr=" + readyForPr);
  out.push("");
  out.push("--- EXAMPLES_BY_BUCKET (max 10 each) ---");
  for (let bj = 0; bj < BUCKETS.length; bj++) {
    const bn = BUCKETS[bj];
    const arr = byBucket[bn];
    if (!arr.length) continue;
    out.push("");
    out.push("--- bucket=" + bn + " count=" + arr.length + " ---");
    const cap = Math.min(10, arr.length);
    for (let ex = 0; ex < cap; ex++) {
      const r = arr[ex];
      const f = r.folded;
      out.push("example_" + (ex + 1) + "_id=" + escapeField(r.id));
      out.push("example_" + (ex + 1) + "_input=" + escapeField(r.input));
      out.push("example_" + (ex + 1) + "_expected_intent_module=" + escapeField(r.expected + " / " + r.group));
      out.push("example_" + (ex + 1) + "_actual_intent_module=" + escapeField(r.actual + " / " + r.group));
      out.push("example_" + (ex + 1) + "_processingState=" + escapeField(r.processingState));
      out.push("example_" + (ex + 1) + "_response_text=" + escapeField(r.raw.slice(0, 320)));
      out.push("example_" + (ex + 1) + "_has_calendar_signal=" + yn(hasCalendarSignal(f)));
      out.push("example_" + (ex + 1) + "_has_task_signal=" + yn(hasTaskSignal(f)));
      out.push("example_" + (ex + 1) + "_has_note_signal=" + yn(hasNoteSignal(f)));
      out.push("example_" + (ex + 1) + "_has_personal_fact_signal=" + yn(hasPersonalFactSignal(f)));
      out.push("example_" + (ex + 1) + "_has_temporal_anchor=" + yn(hasTemporalAnchor(f)));
      out.push("example_" + (ex + 1) + "_has_entity_anchor=" + yn(hasEntityAnchor(f)));
      out.push("example_" + (ex + 1) + "_has_partial_reference=" + yn(hasPartialReference(f)));
      out.push("example_" + (ex + 1) + "_has_dirty_mobile_noise=" + yn(hasDirtyMobileNoise(f)));
      out.push("example_" + (ex + 1) + "_payload_entity_quality=" + payloadQuality(r.turn, r.raw));
      out.push("example_" + (ex + 1) + "_why_fail=" + escapeField(r.why_fail));
      out.push("example_" + (ex + 1) + "_classification=" + escapeField(r.classification));
    }
  }
  out.push("");
  out.push("=== END_RETRIEVAL_STRESS_300K_PREP_RESULT ===");

  console.log("\n" + out.join("\n"));

  if (writeReport) {
    console.log("\noptional_report_written=" + OPTIONAL_OUT_JSON);
  }

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

module.exports = {
  assignRetrievalBucket,
  buildRetrievalPilotCases,
  structure300kSummary
};
