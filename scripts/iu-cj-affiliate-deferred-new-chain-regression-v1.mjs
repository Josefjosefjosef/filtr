#!/usr/bin/env node
/**
 * DeferredNew chain regression (offers → prod-meta → optional matrix liveSnapshot).
 *
 * FAIL if offers.publicGrowthBudget.deferredNew is nullish / non-finite.
 * Never treat a stale matrix null as pipeline truth.
 *
 * CLI:
 *   node ... --offers <offers.json> [--matrix <matrix.json>]
 *   Env: IU_CJ_MASTER_MATRIX_PATH optional for matrix check
 * Exit: 0 PASS, 1 FAIL, 2 unreadable input
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectProdMetaFromOffersJson } from "./iu-cj-affiliate-phase3z-prod-meta-collect-v51-8.mjs";

export const SCHEMA = "iu-cj-affiliate-deferred-new-chain-regression-v1";

function isFiniteNonNegNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * @param {object} doc offers-public JSON
 * @param {object} [opts]
 * @param {object} [opts.liveSnapshot] matrix.liveSnapshot (optional)
 * @returns {{ schema:string, pass:boolean, offersDeferredNew:number|null, prodMetaDeferredNew:number|null, problems:string[] }}
 */
export function checkChain(doc, opts = {}) {
  const problems = [];
  const gb = doc?.publicGrowthBudget;

  if (!gb || typeof gb !== "object") {
    problems.push("OFFERS_PUBLIC_GROWTH_BUDGET_MISSING");
  }

  const hasField = gb && Object.prototype.hasOwnProperty.call(gb, "deferredNew");
  const raw = hasField ? gb.deferredNew : undefined;

  if (!isFiniteNonNegNumber(raw)) {
    problems.push(
      "OFFERS_DEFERRED_NEW_NOT_FINITE_NUMBER:" +
        (raw === null || raw === undefined ? "nullish" : typeof raw),
    );
  }

  const meta = collectProdMetaFromOffersJson(doc && typeof doc === "object" ? doc : {}, opts);
  const offersDeferredNew = isFiniteNonNegNumber(raw) ? raw : null;
  const prodMetaDeferredNew = isFiniteNonNegNumber(meta.DEFERRED_NEW) ? meta.DEFERRED_NEW : null;

  if (offersDeferredNew != null && prodMetaDeferredNew !== offersDeferredNew) {
    problems.push(
      "PROD_META_MISMATCH:offers=" + offersDeferredNew + ":meta=" + String(meta.DEFERRED_NEW),
    );
  }

  const snap = opts.liveSnapshot;
  if (snap && typeof snap === "object" && Object.prototype.hasOwnProperty.call(snap, "deferredNew")) {
    const m = snap.deferredNew;
    if (!isFiniteNonNegNumber(m)) {
      problems.push("MATRIX_DEFERRED_NEW_NOT_FINITE_NUMBER:" + (m === null ? "null" : typeof m));
    } else if (offersDeferredNew != null && m !== offersDeferredNew) {
      problems.push("MATRIX_DEFERRED_NEW_STALE:matrix=" + m + ":offers=" + offersDeferredNew);
    }
  }

  return {
    schema: SCHEMA,
    pass: problems.length === 0,
    offersDeferredNew,
    prodMetaDeferredNew,
    problems,
  };
}

function readJson(p) {
  const t = fs.readFileSync(p, "utf8");
  return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
}

function parseArgs(argv) {
  const out = { offers: null, matrix: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--offers" && argv[i + 1]) {
      out.offers = argv[++i];
    } else if (argv[i] === "--matrix" && argv[i + 1]) {
      out.matrix = argv[++i];
    } else if (argv[i] === "--selftest") {
      out.selftest = true;
    } else if (!argv[i].startsWith("-") && !out.offers) {
      out.offers = argv[i];
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.selftest) {
    // Prefer dedicated selftest file when present
    console.error("Use: node scripts/iu-cj-affiliate-deferred-new-chain-regression-v1-selftest.mjs");
    process.exit(2);
  }
  if (!args.offers) {
    console.error("Usage: node iu-cj-affiliate-deferred-new-chain-regression-v1.mjs --offers <offers.json> [--matrix <matrix.json>]");
    process.exit(2);
  }
  let doc;
  try {
    doc = readJson(args.offers);
  } catch {
    console.log("DEFERRED_NEW_CHAIN=FAIL");
    console.error("UNREADABLE_OFFERS");
    process.exit(2);
  }
  let liveSnapshot = undefined;
  const matrixPath = args.matrix || process.env.IU_CJ_MASTER_MATRIX_PATH || null;
  if (matrixPath) {
    try {
      const m = readJson(matrixPath);
      liveSnapshot = m.liveSnapshot || null;
    } catch {
      console.log("DEFERRED_NEW_CHAIN=FAIL");
      console.error("UNREADABLE_MATRIX");
      process.exit(2);
    }
  }
  const r = checkChain(doc, { liveSnapshot, sourceUrl: args.offers });
  console.log(r.pass ? "DEFERRED_NEW_CHAIN=PASS" : "DEFERRED_NEW_CHAIN=FAIL");
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.pass ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) main();
