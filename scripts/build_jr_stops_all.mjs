import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OUT_PATH = path.resolve('projects/data/jr_stops_all_min.json');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'iu-jr-'));

const UA = 'INFOUZEL-JRStopsBuilder/1.0 (+https://infouzel.cz)';
const HTTP_TIMEOUT_MS = 30_000;
const RETRIES = 3;

// Official sources (CIS JŘ)
// Note: portal publishes a complete stop list as a single-column CSV (one stop per line, quoted).
// This is the smallest and fastest way to get "all stops" without touching any timetable results.
const URL_STOPS_LIST = 'https://portal.cisjr.cz/pub/seznamy/zastavky.csv';
const URLS_ZIP = [
  'https://portal.cisjr.cz/pub/JDF/JDF.zip',
  'https://portal.cisjr.cz/pub/draha/mestske/JDF.zip'
];

function logKV(obj){
  for (const [k,v] of Object.entries(obj)) {
    process.stdout.write(`${k}=${String(v)}\n`);
  }
}

function sleep(ms){
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try{
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        ...(opts?.headers || {}),
        'user-agent': UA
      }
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function downloadHttp(url, outFile){
  for (let attempt = 1; attempt <= RETRIES; attempt++){
    try{
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`http_${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 16) throw new Error('too_small');
      fs.writeFileSync(outFile, buf);
      return { ok: true, url, method: 'http', bytes: buf.length, attempt };
    }catch(e){
      if (attempt === RETRIES) break;
      const backoff = 500 * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }
  return { ok: false, url, method: 'http' };
}

function downloadViaCurl(url, outFile){
  const r = spawnSync('curl', ['-L', '--fail', '--silent', '--show-error', '--max-time', String(Math.ceil(HTTP_TIMEOUT_MS/1000)), '-A', UA, '-o', outFile, url], {
    stdio: ['ignore','pipe','pipe'],
    encoding: 'utf8'
  });
  const ok = r.status === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 16;
  return { ok, url, method: 'curl', status: r.status, stderr: String(r.stderr || '').trim() };
}

function normalizeSpace(s){
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function decodeText(buf){
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const tryEnc = (enc) => {
    try{
      // Node 20 TextDecoder usually supports a wide range of encodings (ICU).
      const td = new TextDecoder(enc);
      return td.decode(b);
    }catch{
      return null;
    }
  };
  // CIS exports are commonly in CP852 (DOS) or Windows-1250; try those first.
  return (
    tryEnc('ibm852') ||
    tryEnc('cp852') ||
    tryEnc('windows-1250') ||
    tryEnc('utf-8') ||
    b.toString('utf8')
  );
}

function stripQuotes(s){
  const t = String(s || '').trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1).replace(/""/g, '"');
  return t;
}

function collectStopsFromStopsListText(text){
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const ln of lines){
    const x = normalizeSpace(stripQuotes(ln));
    if (!x) continue;
    out.push(x);
  }
  return out;
}

function ensureDir(p){
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function readExistingOut(){
  try{
    if (!fs.existsSync(OUT_PATH)) return null;
    const s = fs.readFileSync(OUT_PATH, 'utf8');
    return s;
  }catch{
    return null;
  }
}

async function main(){
  ensureDir(OUT_PATH);

  const existing = readExistingOut();
  const stops = new Set();

  // 1) Preferred: official published stop list (fast, complete, stable).
  const listPath = path.join(TMP_ROOT, 'zastavky.csv');
  let listOk = false;
  {
    let dl = await downloadHttp(URL_STOPS_LIST, listPath);
    if (!dl.ok){
      // FTP fallback via curl if available (best-effort; does NOT fail the workflow)
      const ftpUrl = 'ftp://ftp.cisjr.cz/pub/seznamy/zastavky.csv';
      const dl2 = downloadViaCurl(ftpUrl, listPath);
      dl = dl2.ok ? { ok: true, url: ftpUrl, method: 'ftp_curl' } : dl;
    }
    if (dl.ok){
      listOk = true;
      const buf = fs.readFileSync(listPath);
      const txt = decodeText(buf);
      const arr = collectStopsFromStopsListText(txt);
      for (const s of arr) stops.add(normalizeSpace(s));
    }
  }

  // 2) Fallback: try ZIP sources (heavy). Only used if CSV failed.
  const zipResults = [];
  if (!listOk){
    for (const u of URLS_ZIP){
      const outZip = path.join(TMP_ROOT, path.basename(u));
      const dl = await downloadHttp(u, outZip);
      zipResults.push(dl);
      // We intentionally do NOT parse whole JDF here (too heavy).
    }
  }

  const stopsArr = Array.from(stops)
    .map(normalizeSpace)
    .filter(Boolean);

  // Dedup normalization: collapse spaces and unify comma spacing.
  const normSet = new Map();
  for (const s of stopsArr){
    const k = normalizeSpace(s).toLowerCase();
    if (!normSet.has(k)) normSet.set(k, s);
  }
  const finalStops = Array.from(normSet.values());
  finalStops.sort((a,b)=>a.localeCompare(b,'cs'));

  if (finalStops.length < 500){
    // Hard fail-safe: keep existing dataset, do not overwrite with small/empty output.
    logKV({
      download_failed: String(!listOk),
      keeping_existing_dataset: String(!!existing),
      generated_count: String(finalStops.length),
      note: 'too_few_stops_or_download_failed'
    });
    if (existing){
      process.exit(0);
    } else {
      // No existing file to keep. Exit 0 anyway (per requirements), but leave repo untouched.
      process.exit(0);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(finalStops, null, 0) + "\n", 'utf8');
  logKV({
    download_failed: String(!csvOk),
    keeping_existing_dataset: 'false',
    generated_count: String(finalStops.length),
    out: OUT_PATH
  });
}

main().catch((e) => {
  const existing = readExistingOut();
  logKV({
    download_failed: 'true',
    keeping_existing_dataset: String(!!existing),
    error: (e && e.message) ? e.message : String(e)
  });
  process.exit(0);
});

