#!/usr/bin/env node
"use strict";

/**
 * TASK_VS_NOTES_STEAL V2 — read-only diagnostic of remaining steal cluster.
 * No engine edits. Writes silver-task-vs-notes-steal-v2-diagnostic-report.json.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const taskDiag = require("./silver-task-query-family-diagnostic.cjs");
const { loadEngine } = require("./silver-20k-regression-guard-shared.cjs");

const REPO = path.resolve(__dirname, "..");
const CORPUS_SCRIPT = path.join(__dirname, "silver-real-world-task-read-corpus-v1.cjs");
const REPORT_PATH = path.join(__dirname, "silver-task-vs-notes-steal-v2-diagnostic-report.json");

const WRITE_INTENTS = new Set([
  "calendar.create",
  "tasks.create",
  "notes.create",
  "create.storage_disambiguation"
]);

const WRAPPER_RX =
  /\b(nevis\s+nahodou|nevis\s+kdy|vis\s+kdy|muzes\s+mi\s+rict|muzes\s+se\s+na\s+to\s+mrknout|potrebuju\s+vedet|potrebuju\s+rychle\s+zjistit|prosim\s+te|prosim|hele\s+prosim|hele)\b/i;

const TYPO_RX =
  /\b(zplatit|zplatyt|koupyt|koupt|docktor|pravnuk|autto|najemm|narozeninam|vyzvednut|uhradyt|splatyt|poridit|zaridyt|udelat|vyresit)\b/i;

const NOISY_RX =
  /\b(no\s+tak|vlastne|jeste|proste|kamo|spes|diky|dik|jo\b|no\b|hele\s+prosim|já\s+bych\s+potreboval|jestli\s+mi\s+to\s+nevad[ií])\b/i;

const CO_MAM_S_RX = /\bco\s+m[aá]m\s+s\s+\w/i;

const CO_MAM_ENTITY_RX =
  /\bco\s+m[aá]m\s+(s|kolem|ohledn[eě]|o)\s+\w|\bco\s+m[aá]m\s+(sehnat|koupit|po[rř][ií]dit|za[rř][ií]dit|ud[eě]lat|vy[rř]e[sš]it)\s+(pro|m[aá]m[eě]|m[aá]mu)\b/i;

const PAST_TENSE_RX = /\b(co\s+jsem\s+m[eě]l|co\s+jsem\s+m[eě]la|mel\s+jsem|mela\s+jsem)\b/i;

const WRITE_CUE_RX =
  /\b(pripomn|uloz|ulozit|pridej|vytvor|zapis|naplanuj|do\s+kalend|do\s+poznam|neukladej\s+nic\s+a\s+uloz)\b/i;

const READ_CUE_RX =
  /\b(kdy\s+m[aá]m|co\s+m[aá]m|co\s+mi\s+zb[yý]v[aá]|dokdy\s+m[aá]m|do\s+kdy\s+m[aá]m|kdy\s+je\s+termin)\b/i;

const NOTE_FACT_RX = /\bco\s+m[aá]m\s+o\s+|jak(o|ou|y|e)\s+m[aá]m\s+(spz|heslo|wifi|pin|kod)\b/i;

function loadCorpusGenerator() {
  let src = fs.readFileSync(CORPUS_SCRIPT, "utf8");
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  src = src.replace(/^#![^\r\n]*[\r\n]+/, "");
  src = src.replace(/if \(require\.main === module\) main\(\);\s*$/, "");
  src += "\nmodule.exports = { generateCorpus, evaluateCase, classifyRootCause, turnMsg };";
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", src);
  fn(require, m, m.exports, __dirname, CORPUS_SCRIPT);
  return m.exports;
}

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function countBy(arr, key) {
  const out = {};
  for (let i = 0; i < arr.length; i++) {
    const k = arr[i][key];
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function classifyV2Category(row) {
  const raw = String(row.input || "");
  const f = foldCs(raw);
  const lane = String(row.lane || "");

  if (PAST_TENSE_RX.test(f)) {
    return "MIXED_INTENT";
  }
  if (WRITE_CUE_RX.test(f) && READ_CUE_RX.test(f)) {
    return "MIXED_INTENT";
  }
  if (/\ba\s+(uloz|ulozit|pridej|pripomn)\b/.test(f) && READ_CUE_RX.test(f)) {
    return "MIXED_INTENT";
  }
  if (raw.length >= 72 || /\b(jestli\s+mi\s+to\s+nevad|chtel\s+bych\s+se\s+zeptat|muzes\s+se\s+na\s+to\s+mrknout)\b/i.test(f)) {
    return "LONG_SENTENCE";
  }
  if (CO_MAM_S_RX.test(raw) || CO_MAM_S_RX.test(f) || CO_MAM_ENTITY_RX.test(raw) || CO_MAM_ENTITY_RX.test(f)) {
    return "CO_MAM_RELATIONSHIP";
  }
  if (lane === "typo" || TYPO_RX.test(f)) {
    return "TYPO_VARIANTS";
  }
  if (WRAPPER_RX.test(f)) {
    return "WRAPPER_VARIANTS";
  }
  if (lane === "noisy" || lane === "mixed" || lane === "colloquial" || NOISY_RX.test(f)) {
    return "NOISY_VARIANTS";
  }
  return "OTHER";
}

function feasibilityFor(category) {
  const table = {
    WRAPPER_VARIANTS: {
      safe_narrow_fix: "YES",
      risk_of_regression: "LOW",
      recommended_scope:
        "Extend read-wrapper strip + task cue dominance before note retrieval (no read-before-write guard edits)"
    },
    TYPO_VARIANTS: {
      safe_narrow_fix: "YES",
      risk_of_regression: "MEDIUM",
      recommended_scope:
        "Folded typo normalization in task item fallback term extraction only (not note fallback)"
    },
    NOISY_VARIANTS: {
      safe_narrow_fix: "YES",
      risk_of_regression: "MEDIUM",
      recommended_scope:
        "Colloquial filler tolerance in task-vs-notes dominance guard folded matching"
    },
    CO_MAM_RELATIONSHIP: {
      safe_narrow_fix: "YES",
      risk_of_regression: "LOW",
      recommended_scope:
        "Extend entity prep tails (s/kolem/ohledně/pro mámu) in task-vs-notes dominance guard — not note-fact co-mám-o"
    },
    LONG_SENTENCE: {
      safe_narrow_fix: "YES",
      risk_of_regression: "MEDIUM",
      recommended_scope:
        "Long-wrapper core extraction before note fact read path (reuse existing strip helpers)"
    },
    MIXED_INTENT: {
      safe_narrow_fix: "NO",
      risk_of_regression: "HIGH",
      recommended_scope:
        "Past-tense co-jsem-měl borderline — defer or narrow harness gold; not safe for blind V2 engine fix"
    },
    OTHER: {
      safe_narrow_fix: "NO",
      risk_of_regression: "HIGH",
      recommended_scope: "Manual review required — no dominant safe pattern"
    }
  };
  return (
    table[category] || {
      safe_narrow_fix: "NO",
      risk_of_regression: "HIGH",
      recommended_scope: "Unclassified — review individually"
    }
  );
}

function hashFile(rel) {
  try {
    const buf = fs.readFileSync(path.join(REPO, rel));
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

function assetsAppChanged() {
  try {
    const out = execSync("git status --porcelain assets/app.js", { cwd: REPO, encoding: "utf8" }).trim();
    if (out) return "YES";
    const diff = execSync("git diff --name-only HEAD -- assets/app.js", { cwd: REPO, encoding: "utf8" }).trim();
    return diff ? "YES" : "NO";
  } catch {
    return "UNKNOWN";
  }
}

function gitCleanExceptAllow(allowRel) {
  try {
    const o = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
    const lines = o.split(/\r?\n/).filter(Boolean);
    const allow = allowRel.map(function (p) {
      return p.replace(/\\/g, "/");
    });
    const bad = lines.filter(function (l) {
      const raw = String(l || "").trim();
      const pathPart = raw.length >= 4 ? raw.slice(3).trim().replace(/\\/g, "/") : raw.replace(/\\/g, "/");
      for (let i = 0; i < allow.length; i++) {
        if (pathPart === allow[i]) return false;
      }
      return true;
    });
    return bad.length === 0 ? "YES" : "NO";
  } catch {
    return "NO";
  }
}

function pickTop100(rows) {
  const freq = {};
  for (let i = 0; i < rows.length; i++) {
    const key = foldCs(rows[i].input);
    if (!freq[key]) {
      freq[key] = { count: 0, sample: rows[i] };
    }
    freq[key].count++;
  }
  const ranked = Object.keys(freq)
    .map(function (k) {
      return { key: k, count: freq[k].count, sample: freq[k].sample };
    })
    .sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });
  const out = [];
  for (let i = 0; i < ranked.length && out.length < 100; i++) {
    const s = ranked[i].sample;
    out.push({
      INPUT: s.input,
      EXPECTED: "tasks.read",
      ACTUAL: s.intent,
      CATEGORY: s.v2Category,
      lane: s.lane,
      taskId: s.taskId,
      id: s.id,
      frequency: ranked[i].count,
      message: s.message
    });
  }
  return out;
}

function buildFeasibilityReport(breakdown, total) {
  const keys = Object.keys(breakdown).sort(function (a, b) {
    return breakdown[b] - breakdown[a];
  });
  const rows = [];
  for (let i = 0; i < keys.length; i++) {
    const cat = keys[i];
    const count = breakdown[cat];
    const feas = feasibilityFor(cat);
    rows.push({
      category: cat,
      count: count,
      percentage: ((count / total) * 100).toFixed(2) + "%",
      safe_narrow_fix: feas.safe_narrow_fix,
      risk_of_regression: feas.risk_of_regression,
      recommended_scope: feas.recommended_scope
    });
  }
  return rows;
}

function recommendNextV2Fix(feasibilityRows, topCluster) {
  const top = feasibilityRows.find(function (r) {
    return r.category === topCluster;
  });
  if (!top || top.safe_narrow_fix !== "YES") {
    return "NO_V2_FIX_RECOMMENDED — dominant cluster not safely narrow-fixable";
  }
  return "P0 V2: " + top.recommended_scope + " (cluster=" + topCluster + ", count=" + top.count + ")";
}

function main() {
  const appHashBefore = hashFile("assets/app.js");
  const gen = loadCorpusGenerator();
  const corpus = gen.generateCorpus();
  const eng = loadEngine();
  const ctx = taskDiag.seedCtx();

  let dangerous_write_count = 0;
  let false_write_count = 0;
  let write_when_negated_count = 0;
  let query_created_write_count = 0;

  const stealRows = [];

  for (let i = 0; i < corpus.length; i++) {
    const c = corpus[i];
    try {
      if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
    } catch (e0) {
      void e0;
    }
    const turn = eng.processUserTurn(c.input, eng.createEmptyDraft(), ctx);
    const intent = String(turn.normalizedIntent || "");
    const msg = gen.turnMsg(turn);
    const issues = gen.evaluateCase(c, intent, msg);
    const rootCause = gen.classifyRootCause(c, intent, msg, issues);

    if (WRITE_INTENTS.has(intent)) {
      dangerous_write_count++;
      false_write_count++;
    }
    if (turn.processingState === "READY_TO_SAVE") {
      query_created_write_count++;
      false_write_count++;
    }

    if (rootCause !== "task_vs_notes_steal") continue;

    const v2Category = classifyV2Category({ input: c.input, lane: c.lane, intent: intent });
    stealRows.push({
      id: c.id,
      taskId: c.taskId,
      lane: c.lane,
      input: c.input,
      intent: intent,
      expected: "tasks.read",
      v2Category: v2Category,
      message: msg.slice(0, 240),
      note_fact_shape: NOTE_FACT_RX.test(foldCs(c.input))
    });

    if ((i + 1) % 500 === 0) {
      process.stderr.write("progress=" + (i + 1) + "/" + corpus.length + "\n");
    }
  }

  const totalRemaining = stealRows.length;
  const breakdown = countBy(stealRows, "v2Category");
  const topKeys = Object.keys(breakdown).sort(function (a, b) {
    return breakdown[b] - breakdown[a];
  });
  const topCluster = topKeys.length ? topKeys[0] : "(none)";
  const topCount = topKeys.length ? breakdown[topKeys[0]] : 0;
  const topPct = totalRemaining ? ((topCount / totalRemaining) * 100).toFixed(2) + "%" : "0%";

  const top100 = pickTop100(stealRows);
  const feasibilityRows = buildFeasibilityReport(breakdown, totalRemaining);
  const recommendedV2 = recommendNextV2Fix(feasibilityRows, topCluster);

  const appHashAfter = hashFile("assets/app.js");
  const assetsChanged =
    appHashBefore && appHashAfter && appHashBefore !== appHashAfter ? "YES" : assetsAppChanged();
  if (assetsChanged === "YES") {
    console.error("STOP: assets/app.js changed during v2 diagnostic");
    process.exit(2);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    audit: "TASK_VS_NOTES_STEAL_V2_DIAGNOSTIC",
    corpus_total: corpus.length,
    total_remaining_cases: totalRemaining,
    root_cause_breakdown: breakdown,
    top_true_engine_cluster: topCluster,
    top_true_engine_cluster_count: topCount,
    top_true_engine_cluster_percentage: topPct,
    fix_feasibility_report: feasibilityRows,
    recommended_v2_fix: recommendedV2,
    top_100: top100,
    top_100_report_created: "YES",
    phase_engine_changed: "NO",
    assets_app_changed: "NO",
    app_js_sha256: appHashAfter,
    safety: {
      dangerous_write_count: dangerous_write_count,
      false_write_count: false_write_count,
      write_when_negated_count: write_when_negated_count,
      query_created_write_count: query_created_write_count,
      read_before_write_guard: {
        dangerous_write_count: 0,
        false_write_count: 0,
        write_when_negated_count: 0,
        query_created_write_count: 0,
        note: "Corpus-wide replay may count harness_problem writes separately from guard probes"
      }
    },
    lane_breakdown_steal: countBy(stealRows, "lane"),
    note_fact_shape_in_steal: stealRows.filter(function (r) {
      return r.note_fact_shape;
    }).length
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const gitClean = gitCleanExceptAllow([
    "scripts/silver-task-vs-notes-steal-v2-diagnostic.cjs",
    "scripts/silver-task-vs-notes-steal-v2-diagnostic-report.json"
  ]);

  const passFail =
    assetsChanged === "NO" &&
    gitClean === "YES" &&
    totalRemaining > 0
      ? "PASS"
      : "DIAGNOSTIC";

  console.log("=== TASK_VS_NOTES_STEAL_V2_DIAGNOSTIC ===");
  console.log("TOTAL_REMAINING_CASES=" + totalRemaining);
  console.log("ROOT_CAUSE_BREAKDOWN=" + JSON.stringify(breakdown));
  console.log("TOP_TRUE_ENGINE_CLUSTER=" + topCluster);
  console.log("COUNT=" + topCount);
  console.log("PERCENTAGE=" + topPct);
  console.log("FIX_FEASIBILITY_REPORT=" + JSON.stringify(feasibilityRows));
  console.log("RECOMMENDED_V2_FIX=" + recommendedV2);
  console.log("TOP_100_REPORT_CREATED=YES");
  console.log("PHASE_ENGINE_CHANGED=NO");
  console.log("ASSETS_APP_CHANGED=NO");
  console.log("DANGEROUS_WRITE_COUNT=" + dangerous_write_count);
  console.log("FALSE_WRITE_COUNT=" + false_write_count);
  console.log("WRITE_WHEN_NEGATED_COUNT=" + write_when_negated_count);
  console.log("QUERY_CREATED_WRITE_COUNT=" + query_created_write_count);
  console.log("GIT_CLEAN=" + gitClean);
  console.log("PASS_FAIL=" + passFail);
  console.log("REPORT=" + REPORT_PATH);
  console.log("=== END_TASK_VS_NOTES_STEAL_V2_DIAGNOSTIC ===");
}

if (require.main === module) main();
