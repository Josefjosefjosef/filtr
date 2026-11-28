#!/usr/bin/env node
/**
 * Selftest for iu-cj-robot-master-completion-gate-v1.mjs (offline, TEMP-only fixtures).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STATUS_VOCAB, EXTERNAL_BLOCK_FIELDS, classifyItem, evaluate, assertTempPath } from './iu-cj-robot-master-completion-gate-v1.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(here, 'iu-cj-robot-master-completion-gate-v1.mjs');

const REQUIRED_VOCAB = [
  'IMPLEMENTATION_COMPLETE',
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
  'FIX_REQUIRED',
];

const doneItem = (id, extra = {}) => ({
  id,
  status: 'PRODUCTION_PASS',
  productionEvidence: 'live read-back',
  openGaps: [],
  ...extra,
});

function baseMatrix(overrides = {}) {
  const items = [];
  for (let n = 1; n <= 41; n += 1) items.push(doneItem('PART-' + String(n).padStart(2, '0'), { kind: 'PART', part: n }));
  return {
    schema: 'x',
    liveSnapshot: { mainSha: 'abc', catalogUpdatedAt: '2026-01-01T00:00:00Z', deferredNew: 294352 },
    safetyGates: {
      IU_CJ_PUBLIC_GROWTH_UNCAPPED: '0',
      growthGate: 0,
      growthExecute: 'DISARMED',
      emailOnlyPublishing: 'DISARMED',
      ownerApprovalToken: 'NOT_ISSUED',
      d1NonceInfraProdChange: 'FORBIDDEN_WITHOUT_OWNER',
    },
    items,
    acceptanceGates: [doneItem('ACC-01')],
    ...overrides,
  };
}

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log('ok ' + n + ' ' + name);
}

t('status vocabulary contains all required statuses', () => {
  for (const s of REQUIRED_VOCAB) assert.ok(STATUS_VOCAB.includes(s), s);
});

t('all-done matrix passes', () => {
  const r = evaluate(baseMatrix());
  assert.equal(r.pass, true, JSON.stringify(r.problems));
  assert.equal(r.incompleteCount, 0);
});

t('MERGED alone is NOT done', () => {
  assert.equal(classifyItem({ id: 'x', status: 'MERGED' }).verdict, 'INCOMPLETE');
  const m = baseMatrix();
  m.acceptanceGates = [{ id: 'ACC-01', status: 'MERGED' }];
  assert.equal(evaluate(m).pass, false);
});

t('IMPLEMENTATION_COMPLETE / TEST_PASS / pending statuses are NOT done', () => {
  for (const s of ['IMPLEMENTATION_COMPLETE', 'TEST_PASS', 'TEST_PENDING', 'DEPLOY_PENDING', 'PRODUCTION_VERIFICATION_PENDING', 'FIX_REQUIRED', 'NOT_STARTED', 'FAILED']) {
    assert.equal(classifyItem({ id: 'x', status: s }).verdict, 'INCOMPLETE', s);
  }
});

t('unknown status is INVALID and fails', () => {
  assert.equal(classifyItem({ id: 'x', status: 'DONE_WITH_REGRESSION_PROOF' }).verdict, 'INVALID');
  const m = baseMatrix();
  m.acceptanceGates = [{ id: 'ACC-01', status: 'PASS' }];
  assert.equal(evaluate(m).pass, false);
});

t('PRODUCTION_PASS requires evidence and no open gaps', () => {
  assert.equal(classifyItem({ id: 'x', status: 'PRODUCTION_PASS' }).verdict, 'INCOMPLETE');
  assert.equal(classifyItem({ id: 'x', status: 'PRODUCTION_PASS', productionEvidence: 'e', openGaps: ['g'] }).verdict, 'INCOMPLETE');
});

t('REGRESSION_PASS only counts for productionFacing=false', () => {
  assert.equal(classifyItem({ id: 'x', status: 'REGRESSION_PASS' }).verdict, 'INCOMPLETE');
  assert.equal(classifyItem({ id: 'x', status: 'REGRESSION_PASS', productionFacing: true }).verdict, 'INCOMPLETE');
  assert.equal(classifyItem({ id: 'x', status: 'REGRESSION_PASS', productionFacing: false }).verdict, 'DONE');
});

t('TECHNICALLY_READY_DISARMED requires DISARMED activation', () => {
  assert.equal(classifyItem({ id: 'x', status: 'TECHNICALLY_READY_DISARMED' }).verdict, 'INCOMPLETE');
  assert.equal(classifyItem({ id: 'x', status: 'TECHNICALLY_READY_DISARMED', activation: 'ARMED' }).verdict, 'INCOMPLETE');
  assert.equal(classifyItem({ id: 'x', status: 'TECHNICALLY_READY_DISARMED', activation: 'DISARMED' }).verdict, 'DONE');
});

t('OWNER_APPROVAL_REQUIRED exempt only when technical prep is ready+disarmed', () => {
  assert.equal(classifyItem({ id: 'x', status: 'OWNER_APPROVAL_REQUIRED', activation: 'NOT_ACTIVATED' }).verdict, 'INCOMPLETE');
  assert.equal(
    classifyItem({ id: 'x', status: 'OWNER_APPROVAL_REQUIRED', technicalPrepStatus: 'TEST_PENDING', activation: 'NOT_ACTIVATED' }).verdict,
    'INCOMPLETE',
  );
  assert.equal(
    classifyItem({ id: 'x', status: 'OWNER_APPROVAL_REQUIRED', technicalPrepStatus: 'TECHNICALLY_READY_DISARMED', activation: 'NOT_ACTIVATED' }).verdict,
    'EXEMPT_OWNER',
  );
});

t('EXTERNAL_BLOCKED exempt only with complete evidence', () => {
  assert.equal(classifyItem({ id: 'x', status: 'EXTERNAL_BLOCKED' }).verdict, 'INCOMPLETE');
  const eb = Object.fromEntries(EXTERNAL_BLOCK_FIELDS.map((f) => [f, 'v']));
  assert.equal(classifyItem({ id: 'x', status: 'EXTERNAL_BLOCKED', externalBlock: eb }).verdict, 'EXEMPT_EXTERNAL');
  const partial = { ...eb };
  delete partial.workaround;
  assert.equal(classifyItem({ id: 'x', status: 'EXTERNAL_BLOCKED', externalBlock: partial }).verdict, 'INCOMPLETE');
});

t('deferredNew null/undefined fails matrix', () => {
  const m = baseMatrix();
  m.liveSnapshot.deferredNew = null;
  const r = evaluate(m);
  assert.equal(r.pass, false);
  assert.ok(r.problems.includes('LIVE_SNAPSHOT_DEFERRED_NEW_NOT_NUMERIC'));
});

t('missing PART fails matrix', () => {
  const m = baseMatrix();
  m.items = m.items.filter((i) => i.part !== 41);
  const r = evaluate(m);
  assert.equal(r.pass, false);
  assert.ok(r.problems.includes('MISSING_PART:41'));
});

t('safety gate drift fails matrix', () => {
  const m = baseMatrix();
  m.safetyGates.growthExecute = 'ARMED';
  assert.equal(evaluate(m).pass, false);
  const m2 = baseMatrix();
  m2.safetyGates.IU_CJ_PUBLIC_GROWTH_UNCAPPED = '1';
  assert.equal(evaluate(m2).pass, false);
});

t('declared completionGate.pass=true with incomplete items is flagged', () => {
  const m = baseMatrix({ completionGate: { pass: true } });
  m.acceptanceGates = [{ id: 'ACC-01', status: 'TEST_PENDING' }];
  const r = evaluate(m);
  assert.equal(r.pass, false);
  assert.ok(r.problems.includes('DECLARED_PASS_BUT_COMPUTED_FAIL'));
});

t('object item map is read and a pending part stays incomplete', () => {
  const m = baseMatrix();
  m.items = {
    'PART-01': { id: 'PART-01', kind: 'PART', part: 1, status: 'TEST_PENDING', productionFacing: true, openGaps: ['x'] },
  };
  const r = evaluate(m);
  assert.equal(r.pass, false);
  assert.equal(r.problems.includes('NOT_ARRAY:items'), false);
  assert.ok(r.incomplete.some((row) => row.id === 'PART-01'));
});

t('duplicate ids fail matrix', () => {
  const m = baseMatrix();
  m.acceptanceGates = [doneItem('PART-01')];
  assert.equal(evaluate(m).pass, false);
});

t('assertTempPath rejects repo paths', () => {
  assert.throws(() => assertTempPath(path.join(here, 'x.json')), /TEMP_ONLY_VIOLATION/);
  assert.doesNotThrow(() => assertTempPath(path.join(os.tmpdir(), 'x.json')));
});

t('CLI loads matrix via IU_CJ_MASTER_MATRIX_PATH (pass=0, fail=1, no path=2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-cj-gate-selftest-'));
  try {
    const okP = path.join(dir, 'ok.json');
    const badP = path.join(dir, 'bad.json');
    const outP = path.join(dir, 'out', 'report.json');
    fs.writeFileSync(okP, JSON.stringify(baseMatrix()));
    const bad = baseMatrix();
    bad.acceptanceGates = [{ id: 'ACC-01', status: 'MERGED' }];
    fs.writeFileSync(badP, JSON.stringify(bad));
    const env = { ...process.env };
    delete env.IU_CJ_MASTER_MATRIX_PATH;
    delete env.IU_CJ_MASTER_GATE_OUT;

    const ok = spawnSync(process.execPath, [GATE, '--quiet'], { env: { ...env, IU_CJ_MASTER_MATRIX_PATH: okP }, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /CJ_MASTER_COMPLETION_GATE=PASS/);

    const ko = spawnSync(process.execPath, [GATE, '--quiet'], {
      env: { ...env, IU_CJ_MASTER_MATRIX_PATH: badP, IU_CJ_MASTER_GATE_OUT: outP },
      encoding: 'utf8',
    });
    assert.equal(ko.status, 1, ko.stdout + ko.stderr);
    assert.match(ko.stdout, /CJ_MASTER_COMPLETION_GATE=FAIL/);
    assert.equal(JSON.parse(fs.readFileSync(outP, 'utf8')).pass, false);

    const none = spawnSync(process.execPath, [GATE], { env, encoding: 'utf8' });
    assert.equal(none.status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log('iu-cj-robot-master-completion-gate-v1 selftest PASS (' + n + ' checks)');
