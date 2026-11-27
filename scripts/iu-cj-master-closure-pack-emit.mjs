#!/usr/bin/env node
/**
 * CJ robot MASTER TASK closure pack emitter (offline, TEMP-only).
 *
 * Reads CJ_ROBOT_MASTER_COMPLETION_MATRIX.json and writes a summary JSON
 * (+ optional zip) ONLY under os.tmpdir(). Never writes into the repo.
 * Read-only w.r.t. matrix; does not arm growth/email; no network.
 *
 * Usage:
 *   node scripts/iu-cj-master-closure-pack-emit.mjs [--matrix <path>] [--zip]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MATRIX = 'C:\\projects\\iu-cj-audits\\CJ_ROBOT_MASTER_COMPLETION_MATRIX.json';
export const REQUIRED_MERGED_PRS = ['14036', '14037', '14039', '14043'];
export const SCHEMA = 'iu-cj-master-closure-pack-v1';

export function assertTempPath(p) {
  const tmp = path.resolve(os.tmpdir()) + path.sep;
  const abs = path.resolve(p);
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  const t = process.platform === 'win32' ? tmp.toLowerCase() : tmp;
  if (!a.startsWith(t)) throw new Error('TEMP_ONLY_VIOLATION: ' + abs);
  return abs;
}

export function summarize(matrix) {
  const sg = matrix.safetyGates || {};
  const gateChecks = {
    uncappedGrowthOff: String(sg.IU_CJ_PUBLIC_GROWTH_UNCAPPED) === '0',
    growthGateZero: Number(sg.growthGate) === 0,
    growthExecuteDisarmed: sg.growthExecute === 'DISARMED',
    emailOnlyPublishingDisarmed: sg.emailOnlyPublishing === 'DISARMED',
    ownerApprovalTokenNotIssued: sg.ownerApprovalToken === 'NOT_ISSUED',
    d1NonceInfraForbidden: sg.d1NonceInfraProdChange === 'FORBIDDEN_WITHOUT_OWNER',
    snapshotNotUncapped: !matrix.liveSnapshot || matrix.liveSnapshot.uncapped === false,
  };
  const safetyGatesDisarmed = Object.values(gateChecks).every(Boolean);

  const proof = matrix.utf8ProductionProof || {};
  const itemA = (matrix.items || []).find((i) => i.id === 'A-UTF8-PR14036');
  const utf8StatusOk = /CLEARED|REGRESSION_PROOF/i.test(String(proof.status || ""));
  const itemAOk =
    !itemA ||
    /CLEARED|DONE|REGRESSION_PROOF|PRODUCTION_PASS/i.test(String(itemA.status || ""));
  const utf8 = {
    cleared:
      utf8StatusOk &&
      proof.titleBox === 0 &&
      proof.pass === true &&
      itemAOk,
    titleBox: proof.titleBox ?? null,
    checkedAt: proof.checkedAt ?? null,
    dataClearPr: proof.dataClearPr ?? null,
    codeFixPr: proof.codeFixPr ?? null,
    codeFixState: (matrix.activePrs?.[String(proof.codeFixPr)] || {}).state ?? null,
    status: proof.status ?? null,
  };

  const prs = matrix.activePrs || {};
  const mergedPrs = {};
  for (const n of REQUIRED_MERGED_PRS) {
    const e = prs[n];
    mergedPrs[n] = { state: e ? e.state : 'MISSING', merged: !!e && e.state === 'MERGED', mergedAt: e?.mergedAt ?? null };
  }
  const allRequiredMerged = REQUIRED_MERGED_PRS.every((n) => mergedPrs[n].merged);

  const openPrs = Object.entries(prs)
    .filter(([, v]) => v.state === 'OPEN')
    .map(([n, v]) => ({ pr: n, status: v.status ?? null, url: v.url ?? null }));

  const ownerGateItems = (matrix.items || []).filter(
    (i) => i.status === 'OWNER_APPROVAL_REQUIRED' || (i.id || '').startsWith('OWNER-'),
  );
  const openOwnerGates = {
    items: ownerGateItems.map((i) => ({ id: i.id, status: i.status, activation: i.activation ?? null, requirement: i.requirement })),
    openGaps: (matrix.items || [])
      .filter((i) => Array.isArray(i.openGaps) && i.openGaps.length)
      .flatMap((i) => i.openGaps.map((g) => ({ item: i.id, gap: g }))),
    ownerApprovalToken: sg.ownerApprovalToken ?? null,
    d1NonceInfraProdChange: sg.d1NonceInfraProdChange ?? null,
  };

  const statusCounts = {};
  for (const i of matrix.items || []) statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;

  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    matrixSchema: matrix.schema ?? null,
    matrixUpdatedAt: matrix.updatedAt ?? null,
    verdictNow: matrix.verdictNow ?? null,
    safetyGatesDisarmed,
    safetyGateChecks: gateChecks,
    utf8,
    mergedPrs,
    allRequiredMerged,
    openPrs,
    openOwnerGates,
    itemStatusCounts: statusCounts,
    liveSnapshot: matrix.liveSnapshot ?? null,
    armed: false,
  };
}

// ---- minimal zip writer (deflate) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function emit({ matrixPath = DEFAULT_MATRIX, outDir, zip = false, stamp } = {}) {
  const dir = assertTempPath(outDir || path.join(os.tmpdir(), 'iu-cj-master-closure-pack'));
  fs.mkdirSync(dir, { recursive: true });
  const raw = fs.readFileSync(matrixPath);
  const matrix = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  const summary = summarize(matrix);
  summary.matrixSha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const ts = stamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const jsonPath = assertTempPath(path.join(dir, `CJ_MASTER_CLOSURE_PACK_${ts}.json`));
  const jsonBuf = Buffer.from(JSON.stringify(summary, null, 2) + '\n', 'utf8');
  fs.writeFileSync(jsonPath, jsonBuf);
  let zipPath = null;
  if (zip) {
    zipPath = assertTempPath(path.join(dir, `CJ_MASTER_CLOSURE_PACK_${ts}.zip`));
    fs.writeFileSync(
      zipPath,
      buildZip([
        { name: path.basename(jsonPath), data: jsonBuf },
        { name: 'CJ_ROBOT_MASTER_COMPLETION_MATRIX.json', data: raw },
      ]),
    );
  }
  return { jsonPath, zipPath, summary };
}

function parseArgs(argv) {
  const o = { zip: false, matrixPath: DEFAULT_MATRIX };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--zip') o.zip = true;
    else if (argv[i] === '--matrix') o.matrixPath = argv[++i];
    else if (argv[i] === '--out') o.outDir = argv[++i];
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const r = emit(parseArgs(process.argv.slice(2)));
  console.log('JSON=' + r.jsonPath);
  if (r.zipPath) console.log('ZIP=' + r.zipPath);
  console.log('safetyGatesDisarmed=' + r.summary.safetyGatesDisarmed);
  console.log('utf8Cleared=' + r.summary.utf8.cleared);
  console.log('allRequiredMerged=' + r.summary.allRequiredMerged);
  console.log('openOwnerGates=' + r.summary.openOwnerGates.items.length + ' items, ' + r.summary.openOwnerGates.openGaps.length + ' gaps');
}
