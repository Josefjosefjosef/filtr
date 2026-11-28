#!/usr/bin/env node
/**
 * CJ robot MASTER completion gate (offline, read-only, TEMP-only output).
 *
 * Loads the master completion matrix (kept OUTSIDE the repo) and FAILS (exit 1)
 * if any technically-feasible item is not complete.
 *
 * Matrix path: env IU_CJ_MASTER_MATRIX_PATH (or --matrix <path>).
 * Optional report: env IU_CJ_MASTER_GATE_OUT or --out <path> (must be under os.tmpdir()).
 *
 * Rules:
 *  - MERGED / IMPLEMENTATION_COMPLETE / TEST_PASS alone are NEVER done.
 *  - PRODUCTION_PASS needs non-empty productionEvidence.
 *  - REGRESSION_PASS counts only for items with productionFacing === false.
 *  - TECHNICALLY_READY_DISARMED counts only when activation is DISARMED/NOT_ACTIVATED.
 *  - OWNER_APPROVAL_REQUIRED is exempt only if technicalPrepStatus === TECHNICALLY_READY_DISARMED.
 *  - EXTERNAL_BLOCKED is exempt only with a complete externalBlock evidence object.
 *
 * No network, no growth/email/D1/R2 activation, never writes into the repo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'iu-cj-robot-master-completion-gate-v1';
export const ENV_MATRIX = 'IU_CJ_MASTER_MATRIX_PATH';
export const ENV_OUT = 'IU_CJ_MASTER_GATE_OUT';

export const STATUS_VOCAB = Object.freeze([
  'NOT_STARTED',
  'IN_PROGRESS',
  'FAILED',
  'FIX_REQUIRED',
  'IMPLEMENTATION_COMPLETE',
  'MERGE_PENDING',
  'MERGED',
  'TEST_PENDING',
  'TEST_PASS',
  'REGRESSION_PASS',
  'DEPLOY_PENDING',
  'PRODUCTION_VERIFICATION_PENDING',
  'PRODUCTION_PASS',
  'TECHNICALLY_READY_DISARMED',
  'EXTERNAL_BLOCKED',
  'OWNER_APPROVAL_REQUIRED',
]);

export const EXTERNAL_BLOCK_FIELDS = Object.freeze([
  'cause',
  'evidence',
  'affectedFunction',
  'operationalImpact',
  'workaround',
  'nextAutoAttempt',
  'removalCondition',
]);

const ITEM_ARRAYS = ['items', 'acceptanceGates'];

function itemRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return null;
}
const DISARMED_VALUES = new Set(['DISARMED', 'NOT_ACTIVATED']);

export function assertTempPath(p) {
  const tmp = path.resolve(os.tmpdir()) + path.sep;
  const abs = path.resolve(p);
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  const t = process.platform === 'win32' ? tmp.toLowerCase() : tmp;
  if (!a.startsWith(t)) throw new Error('TEMP_ONLY_VIOLATION: ' + abs);
  return abs;
}

function nonEmpty(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Classify one item. Returns { verdict: DONE|EXEMPT_OWNER|EXEMPT_EXTERNAL|INCOMPLETE|INVALID, reason }. */
export function classifyItem(item) {
  const status = item && item.status;
  if (!STATUS_VOCAB.includes(status)) return { verdict: 'INVALID', reason: 'UNKNOWN_STATUS:' + String(status) };
  const openGaps = Array.isArray(item.openGaps) ? item.openGaps : [];
  const hasGaps = openGaps.length > 0;

  switch (status) {
    case 'PRODUCTION_PASS':
      if (!nonEmpty(item.productionEvidence)) return { verdict: 'INCOMPLETE', reason: 'PRODUCTION_PASS_WITHOUT_EVIDENCE' };
      if (hasGaps) return { verdict: 'INCOMPLETE', reason: 'DONE_WITH_OPEN_GAPS' };
      return { verdict: 'DONE', reason: 'PRODUCTION_PASS' };
    case 'REGRESSION_PASS':
      if (item.productionFacing !== false) return { verdict: 'INCOMPLETE', reason: 'REGRESSION_PASS_NOT_ENOUGH_FOR_PRODUCTION_FACING' };
      if (hasGaps) return { verdict: 'INCOMPLETE', reason: 'DONE_WITH_OPEN_GAPS' };
      return { verdict: 'DONE', reason: 'REGRESSION_PASS_NON_PRODUCTION' };
    case 'TECHNICALLY_READY_DISARMED':
      if (!DISARMED_VALUES.has(item.activation)) return { verdict: 'INCOMPLETE', reason: 'READY_DISARMED_WITHOUT_DISARMED_ACTIVATION' };
      if (hasGaps) return { verdict: 'INCOMPLETE', reason: 'DONE_WITH_OPEN_GAPS' };
      return { verdict: 'DONE', reason: 'TECHNICALLY_READY_DISARMED' };
    case 'OWNER_APPROVAL_REQUIRED':
      if (item.technicalPrepStatus !== 'TECHNICALLY_READY_DISARMED') {
        return { verdict: 'INCOMPLETE', reason: 'OWNER_GATE_TECHNICAL_PREP_NOT_READY' };
      }
      if (!DISARMED_VALUES.has(item.activation)) return { verdict: 'INCOMPLETE', reason: 'OWNER_GATE_ACTIVATION_NOT_DISARMED' };
      return { verdict: 'EXEMPT_OWNER', reason: 'OWNER_APPROVAL_ONLY' };
    case 'EXTERNAL_BLOCKED': {
      const eb = item.externalBlock || {};
      const missing = EXTERNAL_BLOCK_FIELDS.filter((f) => !nonEmpty(eb[f]));
      if (missing.length) return { verdict: 'INCOMPLETE', reason: 'EXTERNAL_BLOCK_EVIDENCE_MISSING:' + missing.join(',') };
      return { verdict: 'EXEMPT_EXTERNAL', reason: 'EXTERNAL_BLOCK_DOCUMENTED' };
    }
    default:
      return { verdict: 'INCOMPLETE', reason: 'STATUS_NOT_DONE:' + status };
  }
}

export function checkSafety(matrix) {
  const sg = (matrix && matrix.safetyGates) || {};
  const checks = {
    uncappedGrowthOff: String(sg.IU_CJ_PUBLIC_GROWTH_UNCAPPED) === '0',
    growthGateZero: Number(sg.growthGate) === 0,
    growthExecuteDisarmed: sg.growthExecute === 'DISARMED',
    emailOnlyPublishingDisarmed: sg.emailOnlyPublishing === 'DISARMED',
    ownerApprovalTokenNotIssued: sg.ownerApprovalToken === 'NOT_ISSUED',
    d1NonceInfraForbidden: sg.d1NonceInfraProdChange === 'FORBIDDEN_WITHOUT_OWNER',
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}

export function checkSnapshot(matrix) {
  const s = (matrix && matrix.liveSnapshot) || {};
  const issues = [];
  if (typeof s.deferredNew !== 'number' || !Number.isFinite(s.deferredNew)) issues.push('LIVE_SNAPSHOT_DEFERRED_NEW_NOT_NUMERIC');
  if (!nonEmpty(s.mainSha)) issues.push('LIVE_SNAPSHOT_MAIN_SHA_MISSING');
  if (!nonEmpty(s.catalogUpdatedAt)) issues.push('LIVE_SNAPSHOT_CATALOG_UPDATED_AT_MISSING');
  return issues;
}

export function evaluate(matrix) {
  const problems = [];
  const incomplete = [];
  const exemptOwner = [];
  const exemptExternal = [];
  const statusCounts = {};
  let total = 0;
  let done = 0;
  const seen = new Set();

  if (!matrix || typeof matrix !== 'object') {
    return { schema: SCHEMA, pass: false, total: 0, problems: ['MATRIX_NOT_OBJECT'], incomplete: [], statusCounts: {} };
  }

  for (const key of ITEM_ARRAYS) {
    const arr = matrix[key];
    if (arr === undefined) continue;
    const rows = itemRows(arr);
    if (rows === null) {
      problems.push('NOT_ARRAY:' + key);
      continue;
    }
    for (const item of rows) {
      total += 1;
      const id = item && item.id ? String(item.id) : '(no-id)';
      if (seen.has(id)) problems.push('DUPLICATE_ID:' + id);
      seen.add(id);
      statusCounts[item && item.status] = (statusCounts[item && item.status] || 0) + 1;
      const c = classifyItem(item);
      if (c.verdict === 'DONE') done += 1;
      else if (c.verdict === 'EXEMPT_OWNER') exemptOwner.push(id);
      else if (c.verdict === 'EXEMPT_EXTERNAL') exemptExternal.push(id);
      else incomplete.push({ id, source: key, status: item && item.status, reason: c.reason });
    }
  }

  if (total === 0) problems.push('NO_ITEMS');

  const itemSource = itemRows(matrix.items);
  const parts = (itemSource || []).filter((i) => i && i.kind === 'PART');
  const partNums = new Set(parts.map((p) => p.part));
  for (let n = 1; n <= 41; n += 1) if (!partNums.has(n)) problems.push('MISSING_PART:' + n);

  for (const p of checkSnapshot(matrix)) problems.push(p);
  const safety = checkSafety(matrix);
  if (!safety.pass) problems.push('SAFETY_GATES_NOT_PRESERVED');

  const computedPass = problems.length === 0 && incomplete.length === 0;
  const declared = matrix.completionGate;
  if (declared && declared.pass === true && !computedPass) problems.push('DECLARED_PASS_BUT_COMPUTED_FAIL');

  return {
    schema: SCHEMA,
    pass: computedPass && problems.length === 0,
    total,
    done,
    exemptOwner,
    exemptExternal,
    incompleteCount: incomplete.length,
    incomplete,
    problems,
    statusCounts,
    safety,
  };
}

export function loadMatrix(p) {
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const out = { matrix: process.env[ENV_MATRIX] || '', out: process.env[ENV_OUT] || '', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--matrix') out.matrix = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--quiet') out.quiet = true;
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.matrix) {
    console.error('GATE_ERROR: set ' + ENV_MATRIX + ' or pass --matrix <path>');
    return 2;
  }
  let matrix;
  try {
    matrix = loadMatrix(args.matrix);
  } catch (e) {
    console.error('GATE_ERROR: cannot load matrix: ' + (e && e.message));
    return 2;
  }
  const r = evaluate(matrix);
  if (args.out) {
    const target = assertTempPath(args.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(r, null, 2) + '\n', 'utf8');
  }
  const summary = {
    schema: r.schema,
    pass: r.pass,
    total: r.total,
    done: r.done,
    exemptOwner: (r.exemptOwner || []).length,
    exemptExternal: (r.exemptExternal || []).length,
    incomplete: r.incompleteCount,
    problems: r.problems,
    statusCounts: r.statusCounts,
  };
  console.log(JSON.stringify(summary));
  if (!args.quiet) {
    for (const i of r.incomplete || []) console.log('INCOMPLETE ' + i.id + ' [' + i.status + '] ' + i.reason);
  }
  console.log(r.pass ? 'CJ_MASTER_COMPLETION_GATE=PASS' : 'CJ_MASTER_COMPLETION_GATE=FAIL');
  return r.pass ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(main());
