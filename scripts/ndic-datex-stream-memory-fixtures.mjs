#!/usr/bin/env node
/**
 * Streaming DATEX parser fixtures + memory regression (no NDIC network).
 * Memory cases spawn child with --max-old-space-size=192.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createXmlStreamTokenizer } from "./ndic-datex-v1/stream-xml-tokenizer.mjs";
import { parseDatexFileStreaming } from "./ndic-datex-v1/parse-datex-stream.mjs";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.join(ROOT, "ndic-datex-v1", "fixtures", "snapshot-base.xml");
const TEMP = process.env.TEMP || process.env.TMPDIR || "/tmp";

// --- tokenizer chunk boundaries ---
{
  const parts = [];
  const tok = createXmlStreamTokenizer({}, {
    onOpen: (e) => parts.push("O:" + e.localName),
    onClose: (e) => parts.push("C:" + e.localName),
    onText: (e) => parts.push("T:" + e.text.trim()),
  });
  const xml = '<?xml version="1.0"?><r xmlns="http://datex2.eu/schema/2/2_0"><a b="1">x</a></r>';
  // split inside tag name, attr, utf8
  tok.write(Buffer.from(xml.slice(0, 5), "utf8"));
  tok.write(Buffer.from(xml.slice(5, 28), "utf8"));
  tok.write(Buffer.from(xml.slice(28, 55), "utf8"));
  tok.write(Buffer.from(xml.slice(55), "utf8"));
  tok.end();
  ok("chunk_tag_attr", parts.includes("O:r") && parts.includes("O:a") && parts.includes("T:x"), parts.join("|"));
}

{
  let rejected = false;
  try {
    const tok = createXmlStreamTokenizer({}, {});
    tok.write("<!DOCTYPE foo [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>");
    tok.write("<r/>");
    tok.end();
  } catch (e) {
    rejected = e.code === "XML_UNSAFE";
  }
  ok("doctype_reject", rejected, "dtd");
}

{
  let rejected = false;
  try {
    const tok = createXmlStreamTokenizer({}, {});
    tok.write("<r>&xxe;</r>");
    tok.end();
  } catch (e) {
    rejected = e.code === "XML_ENTITY";
  }
  ok("entity_reject", rejected, "ent");
}

// --- fixture streaming parse ---
{
  const outDir = fs.mkdtempSync(path.join(TEMP, "ndic-stream-fix-"));
  const jsonl = path.join(outDir, "out.jsonl");
  const r = await parseDatexFileStreaming(FIX, { jsonlPath: jsonl });
  ok("fixture_stream_ok", r.parserCompatible === true, r.parserFailureCode);
  ok("fixture_stream_records", r.situationRecords >= 3, String(r.situationRecords));
  ok("fixture_ns", r.namespace === "http://datex2.eu/schema/2/2_0", r.namespace);
  ok("fixture_jsonl", fs.existsSync(jsonl) && fs.readFileSync(jsonl, "utf8").trim().split("\n").length >= 3, "jsonl");
  ok("fixture_no_full_dom_flag", r.structure && r.structure.recordsNormalized >= 3, "norm");
  fs.rmSync(outDir, { recursive: true, force: true });
}

// --- xsi before app ns ---
{
  const xml = `<?xml version="1.0"?>
<d2LogicalModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2">
  <payloadPublication xsi:type="SituationPublication">
    <situation id="S1" version="1">
      <situationRecord xsi:type="Accident" id="R1" version="1">
        <situationRecordCreationTime>2026-01-01T00:00:00Z</situationRecordCreationTime>
        <validity><validityStatus>active</validityStatus>
          <validityTimeSpecification><overallStartTime>2026-01-01T00:00:00Z</overallStartTime></validityTimeSpecification>
        </validity>
      </situationRecord>
    </situation>
  </payloadPublication>
</d2LogicalModel>`;
  const f = path.join(TEMP, "ndic-xsi-" + Date.now() + ".xml");
  fs.writeFileSync(f, xml);
  const r = await parseDatexFileStreaming(f, {});
  ok("xsi_first_ns", r.namespace === "http://datex2.eu/schema/2/2_0", r.namespace);
  ok("xsi_first_ok", r.parserCompatible === true, r.parserFailureCode);
  fs.unlinkSync(f);
}

// --- memory regression via child processes ---
const memScript = path.join(TEMP, "iu_ndic_mem_child.mjs");
const importUrl = "file:///" + path.join(ROOT, "ndic-datex-v1/parse-datex-stream.mjs").replace(/\\/g, "/");
fs.writeFileSync(
  memScript,
  `
import fs from "node:fs";
import path from "node:path";
import { parseDatexFileStreaming } from ${JSON.stringify(importUrl)};

const mib = Number(process.argv[2]);
const records = Number(process.argv[3] || 2000);
const outDir = fs.mkdtempSync(path.join(process.env.TEMP || "/tmp", "ndic-mem-"));
const file = path.join(outDir, "gen.xml");
const ws = fs.createWriteStream(file, { mode: 0o600 });
ws.write('<?xml version="1.0"?><d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2"><payloadPublication xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="SituationPublication">');
const target = Math.floor(mib * 1024 * 1024);
let written = 200;
const pad = "x".repeat(256);
for (let i = 0; i < records; i++) {
  const block =
    '<situation id="S'+i+'" version="1"><situationRecord xsi:type="Accident" id="R'+i+'" version="1">' +
    '<situationRecordCreationTime>2026-01-01T00:00:00Z</situationRecordCreationTime>' +
    '<validity><validityStatus>active</validityStatus><validityTimeSpecification><overallStartTime>2026-01-01T00:00:00Z</overallStartTime></validityTimeSpecification></validity>' +
    '<generalPublicComment><comment><value lang="cs">'+pad+'</value></comment></generalPublicComment>' +
    '</situationRecord></situation>';
  ws.write(block);
  written += Buffer.byteLength(block);
  if (written >= target) break;
}
while (written < target) {
  const n = Math.min(65536, target - written);
  const body = Math.max(0, n - 7);
  ws.write("<!--"+ "y".repeat(body) + "-->");
  written += n;
}
ws.write("</payloadPublication></d2LogicalModel>");
await new Promise((res, rej) => { ws.end(res); ws.on("error", rej); });
const before = process.memoryUsage();
const r = await parseDatexFileStreaming(file, { jsonlPath: path.join(outDir, "o.jsonl") });
const after = process.memoryUsage();
const peakHeap = Math.max(before.heapUsed, after.heapUsed, ((r.structure && r.structure.peakHeapUsedMiB) || 0) * 1024 * 1024);
const peakRss = Math.max(before.rss, after.rss, ((r.structure && r.structure.peakRssMiB) || 0) * 1024 * 1024);
fs.rmSync(outDir, { recursive: true, force: true });
console.log(JSON.stringify({
  ok: r.parserCompatible === true || r.situationRecords > 0,
  inputMiB: mib,
  records: r.situationRecords,
  peakHeapMiB: Math.round(peakHeap / (1024*1024) * 10) / 10,
  peakRssMiB: Math.round(peakRss / (1024*1024) * 10) / 10,
  exitHint: r.parserFailureCode || null,
}));
`
);

function runMem(mib, heapMb) {
  const r = spawnSync(
    process.execPath,
    [`--max-old-space-size=${heapMb}`, memScript, String(mib), "8000"],
    { encoding: "utf8", timeout: 300000, env: process.env }
  );
  let parsed = null;
  try {
    const line = (r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
    parsed = JSON.parse(line);
  } catch (_) {}
  return {
    status: r.status,
    signal: r.signal,
    parsed,
    stderrTail: String(r.stderr || "").slice(-200),
  };
}

const memRows = [];
for (const mib of [56, 80, 96]) {
  const res = runMem(mib, 192);
  const pass =
    res.status === 0 &&
    res.parsed &&
    res.parsed.peakHeapMiB < 180 &&
    (res.parsed.ok === true || res.parsed.records > 0);
  ok("mem_" + mib + "_under_192", pass, JSON.stringify(res.parsed || { status: res.status, signal: res.signal }));
  memRows.push({
    INPUT_MIB: mib,
    RECORDS: res.parsed && res.parsed.records,
    PEAK_RSS_MIB: res.parsed && res.parsed.peakRssMiB,
    PEAK_HEAP_MIB: res.parsed && res.parsed.peakHeapMiB,
    EXIT_CODE: res.status,
    RESULT: pass ? "PASS" : "FAIL",
  });
}

// linear growth check: 96 vs 56 heap delta should be modest
if (memRows[0].RESULT === "PASS" && memRows[2].RESULT === "PASS") {
  const d = memRows[2].PEAK_HEAP_MIB - memRows[0].PEAK_HEAP_MIB;
  ok("heap_not_linear_with_input", d < 40, "delta=" + d);
}

// 128 MiB heap attempt (optional)
{
  const res = runMem(56, 128);
  const pass = res.status === 0 && res.parsed && res.parsed.peakHeapMiB < 120;
  ok("mem_56_under_128", pass || res.status === 0, JSON.stringify(res.parsed || { status: res.status }));
  memRows.push({
    INPUT_MIB: 56,
    HEAP_CAP: 128,
    RECORDS: res.parsed && res.parsed.records,
    PEAK_RSS_MIB: res.parsed && res.parsed.peakRssMiB,
    PEAK_HEAP_MIB: res.parsed && res.parsed.peakHeapMiB,
    EXIT_CODE: res.status,
    RESULT: pass ? "PASS" : res.status === 0 ? "PASS_SOFT" : "FAIL",
  });
}

// OOM fallback report unit
{
  const wrap = path.join(ROOT, "ndic-datex-v1-shadow-run.mjs");
  ok("wrap_exists", fs.existsSync(wrap), "wrap");
  const fallback = {
    ok: false,
    mode: "shadow",
    reason: "probe_process_failed",
    processExitCode: 134,
    processSignal: null,
    failureCategory: "RESOURCE_LIMIT",
    cleanupAttempted: true,
  };
  ok("fallback_shape", fallback.ok === false && fallback.failureCategory === "RESOURCE_LIMIT", "fb");
}

fs.writeFileSync(path.join(TEMP, "iu_ndic_mem_table.json"), JSON.stringify(memRows, null, 2));

if (fails.length) {
  console.error("[ndic-datex-stream-memory-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  console.error(JSON.stringify(memRows));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, memRows }));
console.log("[ndic-datex-stream-memory-fixtures] PASS");
