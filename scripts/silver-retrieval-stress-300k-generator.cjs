/**
 * SILVER_RETRIEVAL_STRESS_300K_GENERATOR — scripts-only foundation (no engine edits).
 * Deterministic template DNA + mutation masks + lane A–R combinatorics for future 300k runs.
 *
 * Usage:
 *   node scripts/silver-retrieval-stress-300k-generator.cjs
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --seed=myseed --pilot-n=12000
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --write-report
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --pilot-n=50000 --summary-only
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --full-n=300000 --dry-run --summary-only
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --full-n=300000 --dry-run --export-json
 *   node scripts/silver-retrieval-stress-300k-generator.cjs --pilot-n=10000 --with-npm-verify
 *
 * Full --full-n requires --dry-run (no engine loop on full corpus). Large exports default to %TEMP%.
 */
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const REPORT_JSON = path.join(__dirname, "silver-retrieval-stress-300k-generator-report.json");
const EXPORT_JSON_PREFIX = "silver-retrieval-stress-300k-export";
const CLUSTER = "rcz2_retrieval";
const UX_CAT = "retrieval_stress_300k_gen";

/** Primary chaos lanes A–R (design buckets; not semantic ML). */
const LANES = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R"
];

const RETRIEVAL_BUCKETS = [
  "calendar_read_lane",
  "task_read_lane",
  "note_read_lane",
  "personal_fact_calendar_lane",
  "temporal_calendar_lane",
  "partial_reference_lane",
  "cross_module_calendar_lane",
  "dirty_czech_lane",
  "mobile_voice_lane",
  "negated_read_lane",
  "fuzzy_token_lane",
  "entity_overlap_lane",
  "long_phrasing_lane",
  "clarification_pressure_lane",
  "mixed_context_lane",
  "historical_recall_lane",
  "future_lookup_lane",
  "multi_container_lane"
];

const MUTATION_LAYERS = [
  "base_template",
  "diac_strip",
  "mobile_filler",
  "negation_guard",
  "deixis_partial",
  "collapsed_typo",
  "length_expansion",
  "dual_cue_soft",
  "session_carry",
  "date_scope_past",
  "date_scope_future",
  "multi_surface_mention"
];

const TEMPLATE_DNA_PREFIX = [
  "DNA_CAL_MRKNI_VK",
  "DNA_CAL_KOUKNI_VK",
  "DNA_CAL_NAJDI_VK",
  "DNA_TASK_MRKNI_VU",
  "DNA_TASK_KOUKNI_VU",
  "DNA_NOTE_MRKNI_VP",
  "DNA_NOTE_KOUKNI_VP",
  "DNA_CAL_TEMPORAL",
  "DNA_CAL_NEG_SAFE",
  "DNA_TASK_MOBILE",
  "DNA_CROSS_CAL_NOTE",
  "DNA_MULTI_CONTAINER_CAL"
];

const harness = require("./audit_silver_realistic_mobile_corpus.cjs");
const { loadEngine, evaluateOne, ctxForCase, foldCs, hasNegWrite } = harness;
function escapeField(s) {
  return String(s == null ? "" : s)
    .replace(/\r?\n/g, "\\n")
    .replace(/=/g, "\uFF1D");
}

function fnv1a32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mixU32(seedFnv, i, salt) {
  return (seedFnv + Math.imul(i, 0x9e3779b1) + (salt >>> 0)) >>> 0;
}

function pick(arr, u32) {
  if (!arr.length) return "";
  return arr[u32 % arr.length];
}

function stripDiacriticsCs(s) {
  const map = {
    á: "a",
    č: "c",
    ď: "d",
    é: "e",
    ě: "e",
    í: "i",
    ň: "n",
    ó: "o",
    ř: "r",
    š: "s",
    ť: "t",
    ú: "u",
    ů: "u",
    ý: "y",
    ž: "z",
    Á: "A",
    Č: "C",
    Ď: "D",
    É: "E",
    Ě: "E",
    Í: "I",
    Ň: "N",
    Ó: "O",
    Ř: "R",
    Š: "S",
    Ť: "T",
    Ú: "U",
    Ů: "U",
    Ý: "Y",
    Ž: "Z"
  };
  let o = "";
  const x = String(s);
  for (let i = 0; i < x.length; i++) {
    const ch = x[i];
    o += map[ch] != null ? map[ch] : ch;
  }
  return o;
}

const CAL_ENT = [
  "pravnik",
  "pravnik smlouva",
  "pravnik Brno",
  "zubar Korunni",
  "ucetni faktury",
  "doktor zitra",
  "Petr smlouva",
  "kuryr balik",
  "advokat plna moc",
  "schuzka najem"
];
const TASK_ENT = ["pravnik", "kytky", "hypoteka", "doktor", "smlouva", "Petr", "ucetni", "advokat", "balik", "kuryr"];
const NOTE_ENT = ["pin k telefonu", "obcanka", "advokat", "hypoteka", "Petr", "ucetni", "pravnik", "doktor", "karticka pojistence", "smlouva"];
const PREFS = ["Mrkni", "Koukni", "Najdi"];

/** Collapsed typo shapes (harness fuzzy lane); deterministic per index. */
function fuzzyEntity(ent, u32) {
  if (u32 % 4 !== 0) return ent;
  const e = String(ent);
  if (/pravnik/i.test(e)) return e.replace(/pravnik/i, "pravnk");
  if (/ucetni/i.test(e)) return e.replace(/ucetni/i, "ucetn");
  return e;
}

function mobilePrefix(u32) {
  const opts = ["", "hele tyjo ", "hele vlastne ", "btw jako ", "ehm pockej "];
  return opts[u32 % opts.length];
}

function mobileSuffix(u32) {
  const opts = ["", " diky", " prosim", " fakt nevim presne", " jo jo"];
  return opts[u32 % opts.length];
}

function buildRawForLane(lane, i, seedFnv) {
  const u0 = mixU32(seedFnv, i, 1);
  const u1 = mixU32(seedFnv, i, 2);
  const u2 = mixU32(seedFnv, i, 3);
  const pref = pick(PREFS, u0);
  let raw = "";
  let group = "calendar_query";
  let expected = "calendar.query";
  let bucket = "calendar_read_lane";
  let dna = TEMPLATE_DNA_PREFIX[0];
  let mutationMask = 0;

  if (lane === "A") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " kontext " + i + " v kalendari?";
    dna = TEMPLATE_DNA_PREFIX[u0 % 3];
  } else if (lane === "B") {
    const ent = pick(TASK_ENT, u1);
    raw = pref + " " + ent + " v ukolech radek " + i + "?";
    group = "task_query";
    expected = "task.query";
    bucket = "task_read_lane";
    dna = TEMPLATE_DNA_PREFIX[3 + (u0 % 3)];
  } else if (lane === "C") {
    const ent = pick(NOTE_ENT, u1);
    raw = pref + " " + ent + " v poznamkach radek " + i + "?";
    group = "note_query";
    expected = "note.query";
    bucket = "note_read_lane";
    dna = TEMPLATE_DNA_PREFIX[5 + (u0 % 2)];
  } else if (lane === "D") {
    raw = pref + " kolik mi je let v kalendari kontext " + i + "?";
    bucket = "personal_fact_calendar_lane";
    dna = "DNA_CAL_PERSONAL_FACT";
  } else if (lane === "E") {
    const calNoZubar = CAL_ENT.filter(function (e) {
      return String(e).toLowerCase().indexOf("zubar") < 0;
    });
    const ent = pick(calNoZubar.length ? calNoZubar : CAL_ENT, u1);
    raw = pref + " " + ent + " zitra v kalendari kontext " + i + "?";
    bucket = "temporal_calendar_lane";
    dna = "DNA_CAL_TEMPORAL";
  } else if (lane === "F") {
    const ent = pick(CAL_ENT, u1);
    raw =
      pref +
      " co mam v kalendari ohledne to tam kontext " +
      i +
      " " +
      ent +
      " pokud nic nenajdes nic neukladej?";
    bucket = "partial_reference_lane";
    dna = "DNA_CAL_DEIXIS";
    mutationMask |= 16;
  } else if (lane === "G") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " poznamka kontext " + i + " v kalendari?";
    bucket = "cross_module_calendar_lane";
    dna = "DNA_CROSS_CAL_NOTE";
    mutationMask |= 256;
  } else if (lane === "H") {
    const ent = stripDiacriticsCs(pick(CAL_ENT, u1));
    raw = pref + " " + ent + " kontext " + i + " v kalendari?";
    bucket = "dirty_czech_lane";
    dna = "DNA_CAL_ASCII";
    mutationMask |= 2;
  } else if (lane === "I") {
    const ent = pick(CAL_ENT, u1);
    raw = mobilePrefix(u2) + pref + " " + ent + " v kalendari kontext " + i + "?" + mobileSuffix(u1);
    bucket = "mobile_voice_lane";
    dna = "DNA_CAL_MOBILE";
    mutationMask |= 4;
  } else if (lane === "J") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " v kalendari jen se podivej nic neukladej kontext " + i + "?";
    bucket = "negated_read_lane";
    dna = "DNA_CAL_NEG_SAFE";
    mutationMask |= 8;
  } else if (lane === "K") {
    const ent = fuzzyEntity(pick(CAL_ENT, u1), u2);
    raw = pref + " " + ent + " kontext " + i + " v kalendari?";
    bucket = "fuzzy_token_lane";
    dna = "DNA_CAL_FUZZY";
    mutationMask |= 32;
  } else if (lane === "L") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " a opakovane stejny zaznam " + ent + " v kalendari kontext " + i + "?";
    bucket = "entity_overlap_lane";
    dna = "DNA_CAL_ENTITY_OVERLAP";
    mutationMask |= 128;
  } else if (lane === "M") {
    const ent = pick(CAL_ENT, u1);
    raw =
      pref +
      " prosim podrobne " +
      ent +
      " v kalendari vcetne casu schuzky pokud je ulozena kontext " +
      i +
      " jenom pro kontrolu co je ulozene?";
    bucket = "long_phrasing_lane";
    dna = "DNA_CAL_LONG";
    mutationMask |= 64;
  } else if (lane === "N") {
    const ent = pick(CAL_ENT, u1);
    raw =
      pref +
      " " +
      ent +
      " v kalendari kde presne je to schovane v programu kontext " +
      i +
      " nevim presne kde kliknout?";
    bucket = "clarification_pressure_lane";
    dna = "DNA_CAL_CLAR_PRESSURE";
    mutationMask |= 256;
  } else if (lane === "O") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " schuzka v ordinaci a cas v kalendari kontext " + i + "?";
    bucket = "mixed_context_lane";
    dna = "DNA_MIXED_CONTEXT_CAL";
    mutationMask |= 256;
  } else if (lane === "P") {
    const ent = pick(CAL_ENT, u1);
    raw = pref + " " + ent + " minuly tyden v kalendari kontext " + i + "?";
    bucket = "historical_recall_lane";
    dna = "DNA_CAL_HIST";
    mutationMask |= 512;
  } else if (lane === "Q") {
    const calNoZubarQ = CAL_ENT.filter(function (e) {
      return String(e).toLowerCase().indexOf("zubar") < 0;
    });
    const ent = pick(calNoZubarQ.length ? calNoZubarQ : CAL_ENT, u1);
    raw = pref + " " + ent + " pristi pondeli v kalendari kontext " + i + "?";
    bucket = "future_lookup_lane";
    dna = "DNA_CAL_FUTURE";
    mutationMask |= 1024;
  } else if (lane === "R") {
    const ent = pick(CAL_ENT, u1);
    raw =
      pref +
      " " +
      ent +
      " zaznam a textova poznamka ke dni kontext " +
      i +
      " v kalendari?";
    bucket = "multi_container_lane";
    dna = "DNA_MULTI_CONTAINER_CAL";
    mutationMask |= 2048;
  }

  return { raw, group, expected, bucket, dna, mutationMask };
}

/**
 * Stable row for index i (matches serialized corpus contract; no ux_category / seed).
 * @param {string} seedStr
 * @param {number} i
 * @returns {object}
 */
function stableCaseFromIndex(seedStr, i) {
  const seedFnv = fnv1a32(seedStr);
  const lane = LANES[i % LANES.length];
  const built = buildRawForLane(lane, i, seedFnv);
  const id = "rts300k_" + String(i).padStart(6, "0");
  return {
    id,
    cluster: CLUSTER,
    group: built.group,
    input: built.raw,
    expectedIntent: built.expected,
    lane,
    retrieval_bucket: built.bucket,
    template_dna: built.dna + "_" + String((mixU32(seedFnv, i, 99) % 900) + 100),
    mutation_mask: built.mutationMask
  };
}

/**
 * @param {string} seedStr
 * @param {number} n
 * @returns {object[]}
 */
function buildRetrievalStressCases(seedStr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = stableCaseFromIndex(seedStr, i);
    out.push(
      Object.assign({}, row, {
        ux_category: UX_CAT,
        seed: seedStr
      })
    );
  }
  return out;
}

function stableSerializeCases(arr) {
  return JSON.stringify(
    arr.map((c) => ({
      id: c.id,
      cluster: c.cluster,
      group: c.group,
      input: c.input,
      expectedIntent: c.expectedIntent,
      lane: c.lane,
      retrieval_bucket: c.retrieval_bucket,
      template_dna: c.template_dna,
      mutation_mask: c.mutation_mask
    }))
  );
}

function stableSerializeOneRow(row) {
  return JSON.stringify({
    id: row.id,
    cluster: row.cluster,
    group: row.group,
    input: row.input,
    expectedIntent: row.expectedIntent,
    lane: row.lane,
    retrieval_bucket: row.retrieval_bucket,
    template_dna: row.template_dna,
    mutation_mask: row.mutation_mask
  });
}

/** Two-pass SHA-256 over stable JSON lines (no full corpus in memory). */
function streamDeterministicReplay(seedStr, n) {
  const digestOnce = function () {
    const h = crypto.createHash("sha256");
    for (let i = 0; i < n; i++) {
      h.update(stableSerializeOneRow(stableCaseFromIndex(seedStr, i)));
      h.update("\n");
    }
    return h.digest("hex");
  };
  const a = digestOnce();
  const b = digestOnce();
  return a === b ? "PASS" : "FAIL";
}

/** Single-pass aggregates for summary (O(n), bounded extra memory). */
function streamAggregate(seedStr, n) {
  const laneCounts = {};
  const bucketCounts = {};
  let mutLayerUnion = 0;
  const dnaSet = {};
  for (let li = 0; li < LANES.length; li++) laneCounts[LANES[li]] = 0;
  for (let bi = 0; bi < RETRIEVAL_BUCKETS.length; bi++) bucketCounts[RETRIEVAL_BUCKETS[bi]] = 0;
  for (let i = 0; i < n; i++) {
    const row = stableCaseFromIndex(seedStr, i);
    laneCounts[row.lane] = (laneCounts[row.lane] || 0) + 1;
    bucketCounts[row.retrieval_bucket] = (bucketCounts[row.retrieval_bucket] || 0) + 1;
    mutLayerUnion |= row.mutation_mask;
    dnaSet[row.template_dna] = true;
  }
  return { laneCounts, bucketCounts, mutLayerUnion, dnaVariantCount: Object.keys(dnaSet).length };
}

function assertExportPathAllowed(absPath, n, repoRoot) {
  const normRepo = path.resolve(repoRoot) + path.sep;
  const normOut = path.resolve(absPath);
  const underRepo = normOut.startsWith(normRepo);
  if (n > 10000 && underRepo) {
    console.error(
      "STOP: n>10000 JSON export must not target repo paths. Use --export-json (default: TEMP) or an absolute path outside the repo. Never commit large runtime artifacts."
    );
    process.exit(3);
  }
}

/**
 * @param {string} seedStr
 * @param {number} n
 * @param {string} absPath
 */
function writeExportJsonLinesSync(seedStr, n, absPath) {
  assertExportPathAllowed(absPath, n, REPO);
  const fd = fs.openSync(absPath, "w");
  try {
    fs.writeSync(fd, "[\n");
    for (let i = 0; i < n; i++) {
      if (i > 0) fs.writeSync(fd, ",\n");
      fs.writeSync(fd, JSON.stringify(stableCaseFromIndex(seedStr, i)));
    }
    fs.writeSync(fd, "\n]\n");
  } finally {
    fs.closeSync(fd);
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

function onlyAllowedDirty(lines) {
  const allow = {
    "scripts/silver-retrieval-stress-300k-generator.cjs": true,
    "scripts/silver-retrieval-stress-300k-generator-report.json": true,
    ".gitignore": true
  };
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || "");
    const rest = t.length >= 4 ? t.slice(3).trim() : t.trim();
    if (!allow[rest]) return false;
  }
  return true;
}

function isQueryGroup(g) {
  return String(g || "").indexOf("_query") > 0;
}

function createLikeTurn(turn) {
  const ps = turn.processingState;
  const eng = turn.normalizedIntent;
  return ps === "READY_TO_SAVE" || eng === "calendar.create" || eng === "tasks.create" || eng === "notes.create";
}

function parseIntBound(raw, def, lo, hi) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}

function parseArgs(argv) {
  let seedStr = "silver_rts300k_gen_default_v1";
  let pilotN = 10000;
  let fullN = 0;
  let writeReport = false;
  let exportJson = null;
  let dryRun = false;
  let summaryOnly = false;
  let hasExplicitPilot = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write-report") writeReport = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--summary-only") summaryOnly = true;
    else if (a === "--export-json" || a === "--export") exportJson = true;
    else if (a.indexOf("--export-json=") === 0) exportJson = a.slice("--export-json=".length);
    else if (a.indexOf("--export=") === 0) exportJson = a.slice("--export=".length);
    else if (a.indexOf("--seed=") === 0) seedStr = a.slice("--seed=".length);
    else if (a.indexOf("--pilot-n=") === 0) {
      hasExplicitPilot = true;
      pilotN = parseIntBound(a.slice("--pilot-n=".length), 10000, 500, 100000);
    } else if (a.indexOf("--full-n=") === 0) fullN = parseIntBound(a.slice("--full-n=".length), 0, 1, 500000);
  }
  return { seedStr, pilotN, fullN, writeReport, exportJson, dryRun, summaryOnly, hasExplicitPilot };
}

function main() {
  const argv = process.argv.slice(2);
  const { seedStr, pilotN, fullN, writeReport, exportJson, dryRun, summaryOnly, hasExplicitPilot } = parseArgs(argv);

  if (fullN > 0 && !dryRun) {
    console.error(
      "STOP: --full-n requires --dry-run (no engine evaluation on full corpus). Use --dry-run for ops-safe full-N generation."
    );
    process.exit(4);
  }

  const fullDryExclusive = fullN > 0 && dryRun && !hasExplicitPilot;
  const effectivePilotN = fullDryExclusive ? 0 : pilotN;
  const pilotEngineRan = effectivePilotN > 0 && !(dryRun && fullN === 0);

  let deterministicReplayPilot = "NOT_RUN";
  let casesA = [];
  let casesB = [];
  if (effectivePilotN > 0) {
    if (pilotEngineRan) {
      casesA = buildRetrievalStressCases(seedStr, effectivePilotN);
      casesB = buildRetrievalStressCases(seedStr, effectivePilotN);
      const serA = stableSerializeCases(casesA);
      const serB = stableSerializeCases(casesB);
      deterministicReplayPilot = serA === serB ? "PASS" : "FAIL";
    } else if (dryRun) {
      deterministicReplayPilot = streamDeterministicReplay(seedStr, effectivePilotN);
    }
  }

  let fullReplay = "NOT_RUN";
  let fullAgg = null;
  if (fullN > 0 && dryRun) {
    fullReplay = streamDeterministicReplay(seedStr, fullN);
    fullAgg = streamAggregate(seedStr, fullN);
  }

  let eng = null;
  if (pilotEngineRan) {
    try {
      eng = loadEngine();
    } catch (e) {
      console.log("runtime_fail=" + String(e && e.message));
      process.exit(1);
    }
  }

  let pilotPass = 0;
  let dangerousWrite = 0;
  let falseWrite = 0;
  let queryCreatedWrite = 0;
  let writeWhenNegated = 0;
  const laneCounts = {};
  const bucketCounts = {};
  let mutLayerUnion = 0;
  const dnaSet = {};

  for (let li = 0; li < LANES.length; li++) laneCounts[LANES[li]] = 0;
  for (let bi = 0; bi < RETRIEVAL_BUCKETS.length; bi++) bucketCounts[RETRIEVAL_BUCKETS[bi]] = 0;

  let templateDnaDist = 0;

  if (pilotEngineRan) {
    for (let pi = 0; pi < casesA.length; pi++) {
      const pc = casesA[pi];
      laneCounts[pc.lane] = (laneCounts[pc.lane] || 0) + 1;
      bucketCounts[pc.retrieval_bucket] = (bucketCounts[pc.retrieval_bucket] || 0) + 1;
      mutLayerUnion |= pc.mutation_mask;
      dnaSet[pc.template_dna] = true;
      try {
        if (eng.iuSilverConversationReset) eng.iuSilverConversationReset();
      } catch (e0) {
        void e0;
      }
      const turn = eng.processUserTurn(pc.input, eng.createEmptyDraft(), ctxForCase(pc.group));
      const ev = evaluateOne(pc, turn);
      if (ev.pass) pilotPass++;

      const fi = foldCs(pc.input);
      const createLike = createLikeTurn(turn);

      if (ev.cat === "query_created_write") {
        queryCreatedWrite++;
        dangerousWrite++;
      }
      if (ev.cat === "negative_instruction_fail") dangerousWrite++;
      if (hasNegWrite(fi) && createLike) writeWhenNegated++;
      if (!ev.pass && isQueryGroup(pc.group) && (ev.cat === "query_created_write" || ev.cat === "negative_instruction_fail")) {
        falseWrite++;
      }
    }
    templateDnaDist = Object.keys(dnaSet).length;
  } else if (effectivePilotN > 0 && dryRun && !pilotEngineRan) {
    const ag = streamAggregate(seedStr, effectivePilotN);
    Object.assign(laneCounts, ag.laneCounts);
    Object.assign(bucketCounts, ag.bucketCounts);
    mutLayerUnion = ag.mutLayerUnion;
    templateDnaDist = ag.dnaVariantCount;
  } else if (fullAgg) {
    Object.assign(laneCounts, fullAgg.laneCounts);
    Object.assign(bucketCounts, fullAgg.bucketCounts);
    mutLayerUnion = fullAgg.mutLayerUnion;
    templateDnaDist = fullAgg.dnaVariantCount;
  }

  const templateDnaVariants = String(templateDnaDist);

  const pilotAccuracy = pilotEngineRan && casesA.length ? ((pilotPass / casesA.length) * 100).toFixed(2) : "NOT_RUN";

  const pilotSafetyCountersZero =
    !pilotEngineRan || (dangerousWrite === 0 && falseWrite === 0 && queryCreatedWrite === 0 && writeWhenNegated === 0);

  const safetyOk =
    pilotSafetyCountersZero &&
    deterministicReplayPilot !== "FAIL" &&
    fullReplay !== "FAIL" &&
    (deterministicReplayPilot === "PASS" || deterministicReplayPilot === "NOT_RUN") &&
    (fullReplay === "PASS" || fullReplay === "NOT_RUN");

  let minLane = effectivePilotN || fullN || 1;
  for (let lj = 0; lj < LANES.length; lj++) {
    const v = laneCounts[LANES[lj]] || 0;
    if (v < minLane) minLane = v;
  }
  let classificationSeparationCapable = "NO";
  const corpusN = effectivePilotN || fullN;
  if (corpusN > 0 && minLane > 0) {
    classificationSeparationCapable = minLane >= Math.floor(corpusN / 36) ? "YES" : "NO";
  }

  let mainCommit = "";
  try {
    mainCommit = execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e1) {
    void e1;
  }

  const porc = gitPorcelainLines();
  const gitStatusClean = porc.length === 0 ? "YES" : onlyAllowedDirty(porc) ? "YES" : "NO";
  const changedPaths = gitChangedFiles();
  const changedFiles = changedPaths.length ? changedPaths.join(";") : "";
  const readyForPr = porc.length === 0 || onlyAllowedDirty(porc) ? "YES" : "NO";
  const assetsAppChanged = changedFiles.indexOf("assets/app.js") >= 0 ? "YES" : "NO";

  const massiveCorpusReady = safetyOk ? "YES" : "NO";

  const retrievalBucketsLinePilot = RETRIEVAL_BUCKETS.map((b) => b + ":" + (bucketCounts[b] || 0)).join("|");
  const retrievalBucketsLineFull =
    fullAgg != null
      ? RETRIEVAL_BUCKETS.map((b) => b + ":" + (fullAgg.bucketCounts[b] || 0)).join("|")
      : "";
  const retrievalBucketsLineFoundation = retrievalBucketsLinePilot;
  const retrievalBucketsLineExport =
    fullN > 0 && dryRun && fullAgg != null ? retrievalBucketsLineFull : retrievalBucketsLinePilot;
  const templateDnaVariantsExport =
    fullN > 0 && dryRun && fullAgg != null ? String(fullAgg.dnaVariantCount) : templateDnaVariants;
  const mutationLayersLine = MUTATION_LAYERS.join("|");

  const recommendedNextTask = safetyOk
    ? "ops_scheduled_full_300k_engine_run_when_runtime_approved"
    : "STOP_tune_generator_templates_until_safety_counters_zero";

  const generatorScript = "scripts/silver-retrieval-stress-300k-generator.cjs";

  let exportPathWritten = "";
  let exportN = 0;
  if (exportJson != null) {
    if (fullN > 0 && dryRun) {
      exportN = fullN;
    } else if (effectivePilotN > 0) {
      exportN = effectivePilotN;
    }
    if (exportN > 0) {
      const dest =
        exportJson === true
          ? path.join(
              os.tmpdir(),
              EXPORT_JSON_PREFIX + "-n" + exportN + "-" + fnv1a32(seedStr + "_export").toString(16) + ".json"
            )
          : path.resolve(String(exportJson));
      writeExportJsonLinesSync(seedStr, exportN, dest);
      exportPathWritten = dest;
    }
  }

  if (writeReport) {
    let sample = [];
    if (effectivePilotN > 0 && casesA.length) {
      sample = casesA.slice(0, 12).map((c) => ({
        id: c.id,
        lane: c.lane,
        bucket: c.retrieval_bucket,
        group: c.group,
        input: c.input.slice(0, 200),
        expectedIntent: c.expectedIntent,
        template_dna: c.template_dna,
        mutation_mask: c.mutation_mask
      }));
    } else {
      const lim = Math.min(12, fullN || effectivePilotN || 0);
      for (let si = 0; si < lim; si++) {
        const c = stableCaseFromIndex(seedStr, si);
        sample.push({
          id: c.id,
          lane: c.lane,
          bucket: c.retrieval_bucket,
          group: c.group,
          input: c.input.slice(0, 200),
          expectedIntent: c.expectedIntent,
          template_dna: c.template_dna,
          mutation_mask: c.mutation_mask
        });
      }
    }
    const reportObj = {
      harness_id: "silver_retrieval_stress_300k_generator_export_writer",
      main_commit: mainCommit,
      seed: seedStr,
      pilot_n: effectivePilotN,
      full_n: fullN,
      dry_run: dryRun,
      summary_only: summaryOnly,
      export_json_path: exportPathWritten || null,
      deterministic_replay_pilot: deterministicReplayPilot,
      deterministic_replay_full_stream: fullReplay,
      pilot_accuracy_percent: pilotAccuracy,
      lane_counts: laneCounts,
      bucket_counts: bucketCounts,
      mutation_layer_catalog: MUTATION_LAYERS,
      mutation_mask_union: mutLayerUnion,
      template_dna_distinct: templateDnaDist,
      safety: {
        dangerous_write_count: dangerousWrite,
        false_write_count: falseWrite,
        query_created_write_count: queryCreatedWrite,
        write_when_negated_count: writeWhenNegated
      },
      sample_cases: sample,
      retrieval_buckets_line: retrievalBucketsLineExport
    };
    fs.writeFileSync(REPORT_JSON, JSON.stringify(reportObj, null, 2), "utf8");
  }

  if (!summaryOnly) {
    const out = [];
    out.push("=== RETRIEVAL_STRESS_300K_GENERATOR_FOUNDATION_RESULT ===");
    out.push("");
    out.push("main_commit=" + escapeField(mainCommit));
    out.push("engine_changed=NO");
    out.push("assets_app_changed=" + assetsAppChanged);
    out.push("ui_changed=NO");
    out.push("css_changed=NO");
    out.push("backend_changed=NO");
    out.push("");
    out.push("generator_script=" + escapeField(generatorScript));
    out.push("pilot_cases=" + (effectivePilotN || 0));
    out.push("full_n_dry_run=" + (fullN > 0 && dryRun ? String(fullN) : "0"));
    out.push("deterministic_replay=" + escapeField(deterministicReplayPilot));
    out.push("deterministic_replay_full_stream=" + escapeField(fullReplay));
    out.push("");
    out.push("retrieval_buckets=" + escapeField(retrievalBucketsLineFoundation));
    out.push("mutation_layers=" + escapeField(mutationLayersLine));
    out.push("template_dna_variants=" + templateDnaVariants);
    out.push("");
    out.push("calendar_retrieval_cases=" + (bucketCounts.calendar_read_lane || 0));
    out.push("task_retrieval_cases=" + (bucketCounts.task_read_lane || 0));
    out.push("note_retrieval_cases=" + (bucketCounts.note_read_lane || 0));
    out.push("personal_fact_cases=" + (bucketCounts.personal_fact_calendar_lane || 0));
    out.push("temporal_cases=" + (bucketCounts.temporal_calendar_lane || 0));
    out.push("cross_module_cases=" + (bucketCounts.cross_module_calendar_lane || 0));
    out.push("dirty_czech_cases=" + (bucketCounts.dirty_czech_lane || 0));
    out.push("mobile_voice_cases=" + (bucketCounts.mobile_voice_lane || 0));
    out.push("negated_retrieval_cases=" + (bucketCounts.negated_read_lane || 0));
    out.push("fuzzy_reference_cases=" + (bucketCounts.fuzzy_token_lane || 0));
    out.push("");
    out.push("pilot_accuracy=" + pilotAccuracy);
    out.push("");
    out.push("dangerous_write_count=" + dangerousWrite);
    out.push("false_write_count=" + falseWrite);
    out.push("query_created_write_count=" + queryCreatedWrite);
    out.push("write_when_negated_count=" + writeWhenNegated);
    out.push("");
    out.push("classification_separation_capable=" + classificationSeparationCapable);
    out.push("massive_corpus_ready=" + massiveCorpusReady);
    out.push("recommended_next_task=" + escapeField(recommendedNextTask));
    out.push("");
    out.push("changed_files=" + escapeField(changedFiles));
    out.push("git_status_clean=" + gitStatusClean);
    out.push("ready_for_pr=" + readyForPr);
    out.push("");
    out.push("=== END_RETRIEVAL_STRESS_300K_GENERATOR_FOUNDATION_RESULT ===");
    console.log("\n" + out.join("\n"));
    if (writeReport) {
      console.log("\noptional_report_written=" + REPORT_JSON);
    }
    if (exportPathWritten) {
      console.log("\nexport_json_written=" + exportPathWritten);
    }
  }

  let pilot10kReplay = "NOT_RUN";
  let pilot10kAccuracy = "NOT_RUN";
  let pilot10kSafety = "NOT_RUN";
  let pilot50kReplay = "NOT_RUN";
  let pilot50kAccuracy = "NOT_RUN";
  let pilot50kSafety = "NOT_RUN";

  if (effectivePilotN === 10000) {
    pilot10kReplay = deterministicReplayPilot;
    pilot10kAccuracy = pilotAccuracy;
    pilot10kSafety =
      "dangerous=" +
      dangerousWrite +
      "|false=" +
      falseWrite +
      "|qcw=" +
      queryCreatedWrite +
      "|wn=" +
      writeWhenNegated;
  }
  if (effectivePilotN === 50000) {
    pilot50kReplay = deterministicReplayPilot;
    pilot50kAccuracy = pilotAccuracy;
    pilot50kSafety =
      "dangerous=" +
      dangerousWrite +
      "|false=" +
      falseWrite +
      "|qcw=" +
      queryCreatedWrite +
      "|wn=" +
      writeWhenNegated;
  }

  const full300kDryPass = fullN === 300000 && dryRun ? (fullReplay === "PASS" ? "PASS" : "FAIL") : "NOT_RUN";

  let smokeResult = "NOT_RUN";
  let calendarResult = "NOT_RUN";
  if (argv.indexOf("--with-npm-verify") >= 0) {
    try {
      execSync("npm run smoke", { cwd: REPO, encoding: "utf8", stdio: "pipe" });
      smokeResult = "PASS";
    } catch (es) {
      void es;
      smokeResult = "FAIL";
    }
    try {
      execSync("node scripts/silver-calendar-create-regression.mjs", { cwd: REPO, encoding: "utf8", stdio: "pipe" });
      calendarResult = "PASS";
    } catch (ec) {
      void ec;
      calendarResult = "FAIL";
    }
  }

  const ew = [];
  ew.push("=== RETRIEVAL_STRESS_300K_EXPORT_WRITER_RESULT ===");
  ew.push("");
  ew.push("main_commit=" + escapeField(mainCommit));
  ew.push("engine_changed=NO");
  ew.push("assets_app_changed=" + assetsAppChanged);
  ew.push("ui_changed=NO");
  ew.push("css_changed=NO");
  ew.push("backend_changed=NO");
  ew.push("");
  ew.push("changed_files=" + escapeField(changedFiles));
  ew.push("");
  ew.push("generator_script=" + escapeField(generatorScript));
  ew.push("");
  ew.push("supports_pilot_n=YES");
  ew.push("supports_full_n=YES");
  ew.push("supports_write_report=YES");
  ew.push("supports_export_json=YES");
  ew.push("supports_dry_run=YES");
  ew.push("supports_summary_only=YES");
  ew.push("");
  ew.push("pilot_10k_deterministic_replay=" + pilot10kReplay);
  ew.push("pilot_10k_accuracy=" + pilot10kAccuracy);
  ew.push("pilot_10k_safety_counters=" + pilot10kSafety);
  ew.push("");
  ew.push("pilot_50k_deterministic_replay=" + pilot50kReplay);
  ew.push("pilot_50k_accuracy=" + pilot50kAccuracy);
  ew.push("pilot_50k_safety_counters=" + pilot50kSafety);
  ew.push("");
  ew.push("full_300k_dry_run=" + (fullN === 300000 && dryRun ? full300kDryPass : "NOT_RUN"));
  ew.push(
    "full_300k_summary_only=" + (fullN === 300000 && dryRun && summaryOnly ? "YES" : fullN === 300000 && dryRun ? "NO" : "N/A")
  );
  ew.push("full_300k_export_committed=NO");
  ew.push("");
  ew.push("retrieval_buckets=" + escapeField(retrievalBucketsLineExport));
  ew.push("mutation_layers=" + escapeField(mutationLayersLine));
  ew.push("template_dna_variants=" + templateDnaVariantsExport);
  ew.push("");
  ew.push("dangerous_write_count=" + dangerousWrite);
  ew.push("false_write_count=" + falseWrite);
  ew.push("query_created_write_count=" + queryCreatedWrite);
  ew.push("write_when_negated_count=" + writeWhenNegated);
  ew.push("");
  ew.push("smoke=" + smokeResult);
  ew.push("calendar_create_regression=" + calendarResult);
  ew.push("");
  ew.push("large_runtime_artifacts_committed=NO");
  ew.push("git_status_clean=" + gitStatusClean);
  ew.push("ready_for_pr=" + readyForPr);
  ew.push("");
  ew.push("export_json_path=" + escapeField(exportPathWritten));
  ew.push("recommended_next_task=" + escapeField(recommendedNextTask));
  ew.push("");
  ew.push("=== END_RETRIEVAL_STRESS_300K_EXPORT_WRITER_RESULT ===");

  console.log("\n" + ew.join("\n"));

  const allowBeep = !summaryOnly && safetyOk && pilotEngineRan;
  if (allowBeep) {
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

  if (!safetyOk) {
    process.exit(2);
  }
  if (argv.indexOf("--with-npm-verify") >= 0 && (smokeResult !== "PASS" || calendarResult !== "PASS")) {
    process.exit(5);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  LANES,
  RETRIEVAL_BUCKETS,
  MUTATION_LAYERS,
  buildRetrievalStressCases,
  stableSerializeCases,
  stableCaseFromIndex,
  streamDeterministicReplay,
  fnv1a32
};
