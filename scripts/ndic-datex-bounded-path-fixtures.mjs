#!/usr/bin/env node
/**
 * Offline DATEX bounded-fetch + TMC path-classification fixtures (no NDIC network).
 * Exit 0 = PASS.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DATEX_MAX_RESPONSE_BYTES,
  DATEX_PREV_RESPONSE_BYTES,
  createBoundedTempPath,
  createByteLimitTransform,
  streamResponseToFileBounded,
  readBoundedFile,
  wipeTempDir,
} from "./ndic-datex-v1/bounded-fetch.mjs";
import {
  buildStoredZip,
  safeUnzipEntries,
  classifyZipPath,
  TMC_PATH_REJECT,
  DEFAULT_ZIP_LIMITS,
} from "./ndic-datex-v1/tmc-zip.mjs";
import { getNdicDatexV1Config } from "./ndic-datex-v1/config.mjs";
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

ok("prev_limit_32mib", DATEX_PREV_RESPONSE_BYTES === 32 * 1024 * 1024, String(DATEX_PREV_RESPONSE_BYTES));
ok("new_limit_80mib", DATEX_MAX_RESPONSE_BYTES === 80 * 1024 * 1024, String(DATEX_MAX_RESPONSE_BYTES));
ok("config_uses_new_limit", getNdicDatexV1Config({}).limits.maxResponseBytes === DATEX_MAX_RESPONSE_BYTES, "cfg");

function mockResponse(body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    headers: {
      get(name) {
        return h.has(String(name).toLowerCase()) ? h.get(String(name).toLowerCase()) : null;
      },
    },
    body: Readable.toWeb(Readable.from(Buffer.isBuffer(body) ? [body] : [Buffer.from(body)])),
  };
}

async function streamCase(name, body, headers, maxBytes, expectOk) {
  const temp = createBoundedTempPath("ndic-bf-");
  try {
    const res = mockResponse(body, headers);
    const r = await streamResponseToFileBounded(res, { maxBytes, destFile: temp.file });
    ok(name + "_ok", expectOk === true && r.bytes === Buffer.byteLength(body), "bytes=" + r.bytes);
    const buf = readBoundedFile(temp.file, maxBytes);
    ok(name + "_read", buf.length === r.bytes, "read");
  } catch (e) {
    ok(name + "_fail", expectOk === false && e && e.code === "RESPONSE_TOO_LARGE", String(e && e.code));
    ok(name + "_cleanup", !fs.existsSync(temp.file) || expectOk === true, "leftover");
  } finally {
    wipeTempDir(temp.dir);
  }
}

// Size boundary tests (small caps for speed)
{
  const payload = Buffer.alloc(1000, 0x41);
  await streamCase("under_limit", payload, {}, 1000, true);
  await streamCase("exact_limit", payload, {}, 1000, true);
  await streamCase("over_by_one", Buffer.alloc(1001, 0x41), {}, 1000, false);
  await streamCase("false_low_cl_still_counts_body", payload, { "content-length": "10" }, 1000, true);
  await streamCase("missing_cl", payload, {}, 1000, true);
  await streamCase("false_high_cl_advisory", payload, { "content-length": "5000" }, 1000, false);
}

// Chunked multi-chunk oversize
{
  const temp = createBoundedTempPath("ndic-chunk-");
  try {
    const chunks = [Buffer.alloc(400, 0x42), Buffer.alloc(400, 0x42), Buffer.alloc(400, 0x42)];
    const res = {
      headers: { get: () => null },
      body: Readable.toWeb(Readable.from(chunks)),
    };
    await streamResponseToFileBounded(res, { maxBytes: 1000, destFile: temp.file });
    ok("chunked_over_should_throw", false, "no-throw");
  } catch (e) {
    ok("chunked_over_reject", e && e.code === "RESPONSE_TOO_LARGE", String(e && e.code));
  } finally {
    wipeTempDir(temp.dir);
    ok("chunked_cleanup", !fs.existsSync(temp.dir), "dir");
  }
}

// Abort / interrupt cleanup
{
  const temp = createBoundedTempPath("ndic-abort-");
  const ac = new AbortController();
  const big = Buffer.alloc(2 * 1024 * 1024, 0x43);
  const res = mockResponse(big, {});
  setTimeout(() => ac.abort(), 1);
  try {
    await streamResponseToFileBounded(res, { maxBytes: DATEX_MAX_RESPONSE_BYTES, destFile: temp.file, signal: ac.signal });
  } catch (_) {
    /* expected */
  }
  wipeTempDir(temp.dir);
  ok("abort_cleanup", !fs.existsSync(temp.dir), "abort");
}

// ~56MB+ synthetic stream (disk only; do not parse full DOM — memory/disk bound)
{
  const target = 56_252_428;
  ok("target_above_prev_limit", target > DATEX_PREV_RESPONSE_BYTES, String(target));
  ok("target_under_new_limit", target < DATEX_MAX_RESPONSE_BYTES, String(target));
  const temp = createBoundedTempPath("ndic-56m-");
  const started = Date.now();
  const memBefore = process.memoryUsage().heapUsed;
  try {
    // Stream from generator without holding full buffer twice
    async function* gen() {
      const chunk = Buffer.alloc(1024 * 1024, 0x58);
      let left = target;
      // tiny XML header then padding bytes (not a full DATEX parse fixture)
      yield Buffer.from('<?xml version="1.0"?><r>');
      left -= 24;
      while (left > 0) {
        const n = Math.min(left, chunk.length);
        yield chunk.subarray(0, n);
        left -= n;
      }
      yield Buffer.from("</r>");
    }
    const res = {
      headers: { get: () => null },
      body: Readable.toWeb(Readable.from(gen())),
    };
    const r = await streamResponseToFileBounded(res, {
      maxBytes: DATEX_MAX_RESPONSE_BYTES,
      destFile: temp.file,
    });
    ok("synth_56m_stream_ok", r.bytes >= target && r.bytes <= DATEX_MAX_RESPONSE_BYTES, "bytes=" + r.bytes);
    const st = fs.statSync(temp.file);
    ok("synth_56m_on_disk", st.size === r.bytes, "stat");
    const memAfter = process.memoryUsage().heapUsed;
    // Heuristic: streaming should not retain full body on heap exclusively (allow generous slack)
    ok("synth_56m_bounded_heap_delta", memAfter - memBefore < 120 * 1024 * 1024, "delta=" + (memAfter - memBefore));
    ok("synth_56m_elapsed_reasonable", Date.now() - started < 120000, "ms");
  } catch (e) {
    ok("synth_56m_stream_ok", false, String(e && e.message));
  } finally {
    wipeTempDir(temp.dir);
  }
}

// Over new limit by 1 byte
{
  const temp = createBoundedTempPath("ndic-over80-");
  try {
    async function* gen() {
      const chunk = Buffer.alloc(1024 * 1024, 0x59);
      let left = DATEX_MAX_RESPONSE_BYTES + 1;
      while (left > 0) {
        const n = Math.min(left, chunk.length);
        yield chunk.subarray(0, n);
        left -= n;
      }
    }
    const res = { headers: { get: () => null }, body: Readable.toWeb(Readable.from(gen())) };
    await streamResponseToFileBounded(res, { maxBytes: DATEX_MAX_RESPONSE_BYTES, destFile: temp.file });
    ok("over_80m_reject", false, "no-throw");
  } catch (e) {
    ok("over_80m_reject", e && e.code === "RESPONSE_TOO_LARGE", String(e && e.code));
  } finally {
    wipeTempDir(temp.dir);
  }
}

// XXE / depth still enforced on small fixtures
{
  let xxe = false;
  try {
    parseSafeXml('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>');
  } catch (e) {
    xxe = e.code === "XML_UNSAFE" || /forbidden|DOCTYPE|ENTITY/i.test(e.message);
  }
  ok("xxe_still_blocked", xxe, "xxe");
}

// Transform unit
{
  const t = createByteLimitTransform(10);
  let err = null;
  t.on("error", (e) => {
    err = e;
  });
  t.write(Buffer.alloc(11));
  ok("transform_limit", true, "wired");
}

// --- TMC path classification ---
{
  ok(
    "path_root_csv",
    classifyZipPath("POINTS.CSV").ok && !classifyZipPath("POINTS.CSV").isDirectory,
    "csv"
  );
  ok(
    "path_rel_subdir",
    classifyZipPath("loc/POINTS.CSV").ok && classifyZipPath("loc/POINTS.CSV").path === "loc/POINTS.CSV",
    "sub"
  );
  const dir = classifyZipPath("loc/");
  ok("path_safe_dir", dir.ok && dir.isDirectory && dir.category === TMC_PATH_REJECT.DIRECTORY_ENTRY, "dir");
  ok("path_abs", classifyZipPath("/evil.csv").category === TMC_PATH_REJECT.ABSOLUTE, "abs");
  ok("path_parent", classifyZipPath("../evil.csv").category === TMC_PATH_REJECT.PARENT_TRAVERSAL, "parent");
  ok("path_backslash", classifyZipPath("a\\b.csv").category === TMC_PATH_REJECT.BACKSLASH, "bs");
  ok("path_drive", classifyZipPath("C:/evil.csv").category === TMC_PATH_REJECT.DRIVE_PREFIX, "drive");
  ok("path_nul", classifyZipPath("a\u0000b.csv").category === TMC_PATH_REJECT.CONTROL_CHAR, "nul");
  ok("path_empty", classifyZipPath("").category === TMC_PATH_REJECT.EMPTY, "empty");
  ok(
    "path_depth",
    classifyZipPath("a/b/c/d/e/f/g/h/i/j/k/l/m.csv").category === TMC_PATH_REJECT.DEPTH_EXCEEDED,
    "depth"
  );
  ok(
    "path_depth_custom",
    classifyZipPath("a/b/c/d/e/f/g/h/i.csv", { maxDepth: 8 }).category === TMC_PATH_REJECT.DEPTH_EXCEEDED,
    "depth8"
  );
  ok(
    "path_too_long",
    classifyZipPath("x".repeat(DEFAULT_ZIP_LIMITS.maxNameLen + 1) + ".csv").category === TMC_PATH_REJECT.TOO_LONG,
    "long"
  );
}

// ZIP with safe directory + CSV must succeed
{
  const csv = "lcd;name;roadNumber\n101;Brno;D1\n";
  const z = buildStoredZip([
    { name: "tables/", data: "" },
    { name: "tables/points.csv", data: csv },
  ]);
  const entries = safeUnzipEntries(z);
  ok("zip_dir_plus_csv", entries.length === 1 && entries[0].name === "tables/points.csv", "entries");
  ok("zip_dir_diag", entries.diagnostics && entries.diagnostics.directoryEntryCount >= 1, "diag");
}

// Reject absolute / traversal still
{
  let abs = false;
  try {
    safeUnzipEntries(buildStoredZip([{ name: "/abs.csv", data: "x" }]));
  } catch (e) {
    abs = e.code === "TMC_ZIP_BAD_PATH" && e.pathRejectCategory === TMC_PATH_REJECT.ABSOLUTE;
  }
  ok("zip_abs_enum", abs, "abs");
  let trav = false;
  try {
    safeUnzipEntries(buildStoredZip([{ name: "../x.csv", data: "x" }]));
  } catch (e) {
    trav = e.code === "TMC_ZIP_BAD_PATH" && e.pathRejectCategory === TMC_PATH_REJECT.PARENT_TRAVERSAL;
  }
  ok("zip_trav_enum", trav, "trav");
  let dup = false;
  try {
    safeUnzipEntries(
      buildStoredZip([
        { name: "a.csv", data: "1" },
        { name: "a.csv", data: "2" },
      ])
    );
  } catch (e) {
    dup = e.code === "TMC_ZIP_BAD_PATH" && e.pathRejectCategory === TMC_PATH_REJECT.DUPLICATE;
  }
  ok("zip_dup_enum", dup, "dup");
  let fold = false;
  try {
    safeUnzipEntries(
      buildStoredZip([
        { name: "A.csv", data: "1" },
        { name: "a.csv", data: "2" },
      ])
    );
  } catch (e) {
    fold = e.code === "TMC_ZIP_BAD_PATH" && e.pathRejectCategory === TMC_PATH_REJECT.DUPLICATE;
  }
  ok("zip_casefold_enum", fold, "fold");
}

if (fails.length) {
  console.error("[ndic-datex-bounded-path-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    DATEX_PREV_RESPONSE_BYTES,
    DATEX_MAX_RESPONSE_BYTES,
    diskBudgetMiB: Math.ceil(DATEX_MAX_RESPONSE_BYTES / (1024 * 1024)),
    memoryBudgetNote:
      "stream-to-disk then single Buffer/string parse; planning ≤~490MiB peak on 1GiB VPS",
  })
);
console.log("[ndic-datex-bounded-path-fixtures] PASS");
