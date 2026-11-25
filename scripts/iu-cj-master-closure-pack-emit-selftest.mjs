#!/usr/bin/env node
/** Offline selftest for iu-cj-master-closure-pack-emit.mjs (fixture only, TEMP-only). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { emit, summarize, assertTempPath } from './iu-cj-master-closure-pack-emit.mjs';

const fail = [];
const ok = (c, m) => { if (!c) fail.push(m); };

const fixture = {
  schema: 'fixture',
  updatedAt: '2026-01-01T00:00:00Z',
  liveSnapshot: { uncapped: false },
  safetyGates: {
    IU_CJ_PUBLIC_GROWTH_UNCAPPED: '0', growthGate: 0, growthExecute: 'DISARMED',
    emailOnlyPublishing: 'DISARMED', ownerApprovalToken: 'NOT_ISSUED',
    d1NonceInfraProdChange: 'FORBIDDEN_WITHOUT_OWNER',
  },
  activePrs: {
    14036: { state: 'MERGED' }, 14037: { state: 'MERGED' }, 14039: { state: 'MERGED' },
    14043: { state: 'MERGED' }, 14042: { state: 'OPEN', status: 'AUTO_MERGE_PENDING' },
  },
  items: [
    { id: 'A-UTF8-PR14036', status: 'PRODUCTION_CLEARED' },
    { id: 'E-EMAIL', status: 'X', openGaps: ['live IMAP owner secrets'] },
    { id: 'OWNER-ACTIVATION-GATES', status: 'OWNER_APPROVAL_REQUIRED', activation: 'NOT_ACTIVATED' },
  ],
  utf8ProductionProof: { status: 'CLEARED', titleBox: 0, pass: true, codeFixPr: 14042 },
};

const s = summarize(fixture);
ok(s.safetyGatesDisarmed === true, 'gates disarmed');
ok(s.utf8.cleared === true, 'utf8 cleared');
ok(s.allRequiredMerged === true, 'required merged');
ok(s.openPrs.length === 1 && s.openPrs[0].pr === '14042', 'open PR 14042');
ok(s.openOwnerGates.items.length === 1 && s.openOwnerGates.openGaps.length === 1, 'owner gates');

const armed = summarize({ ...fixture, safetyGates: { ...fixture.safetyGates, growthExecute: 'ARMED' } });
ok(armed.safetyGatesDisarmed === false, 'armed detected');
const dirty = summarize({ ...fixture, utf8ProductionProof: { status: 'CLEARED', titleBox: 3, pass: false } });
ok(dirty.utf8.cleared === false, 'utf8 dirty detected');
const missing = summarize({ ...fixture, activePrs: { 14036: { state: 'MERGED' } } });
ok(missing.allRequiredMerged === false, 'missing PR detected');

let threw = false;
try { assertTempPath(path.resolve('.')); } catch { threw = true; }
ok(threw, 'non-TEMP path rejected');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-cj-closure-selftest-'));
try {
  const mp = path.join(work, 'matrix.json');
  fs.writeFileSync(mp, JSON.stringify(fixture));
  const r = emit({ matrixPath: mp, outDir: path.join(work, 'out'), zip: true, stamp: 'SELFTEST' });
  const j = JSON.parse(fs.readFileSync(r.jsonPath, 'utf8'));
  ok(j.schema === 'iu-cj-master-closure-pack-v1' && j.armed === false, 'emitted json');
  ok(/^[0-9a-f]{64}$/.test(j.matrixSha256), 'sha256');
  const z = fs.readFileSync(r.zipPath);
  ok(z.readUInt32LE(0) === 0x04034b50, 'zip magic');
  const nameLen = z.readUInt16LE(26);
  const csize = z.readUInt32LE(18);
  const body = zlib.inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + csize));
  ok(body.toString('utf8').includes('"safetyGatesDisarmed": true'), 'zip content roundtrip');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

if (fail.length) { console.log('FAIL: ' + fail.join('; ')); process.exit(1); }
console.log('PASS iu-cj-master-closure-pack-emit-selftest');
