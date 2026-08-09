#!/usr/bin/env node
/**
 * Offline regressions for streaming ZIP peek, opaque tableCode, reject contract.
 * Synthetic only — no NDIC network, no licensed TMC data, no basenames in reports.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  inspectTmcZipFormatFromFile,
  collectInspectionPeekTargets,
  serializeInspectionReport,
  INSPECTION_REJECT,
  INSPECTION_OUTCOME,
  REJECT_PHASE,
  REPORT_SCHEMA_VERSION,
  INSPECTION_VERSION,
  INSPECTION_TEXT_PEEK_BYTES,
  INSPECTION_PEEK_CONCURRENCY,
  INSPECTION_MAX_TOTAL_PEEK_BYTES,
  INSPECTION_HEADER_MAX_BYTES,
  INSPECTION_HEADER_FIELD_LIMIT,
  PEEK_STATUS,
  PEEK_COMPRESSED_READ_CHUNK,
  extractFirstLogicalHeaderLine,
  inspectFormatFromEntryPeeks,
  INSPECTION_MODE,
} from "./ndic-datex-v1/tmc-format-inspection.mjs";
import {
  peekZipEntryBytesStreaming,
} from "./ndic-datex-v1/tmc-zip-entry-peek.mjs";
import { buildStoredZip, buildDeflatedZip } from "./ndic-datex-v1/tmc-zip.mjs";
import {
  buildSyntheticSp08001Dat,
  syntheticPointsRow,
} from "./ndic-datex-v1/tmc-sp08001-header.mjs";
import { resolveSp08001TableCodeFromBasename } from "./ndic-datex-v1/tmc-sp08001-contract.mjs";

const fails = [];
function ok(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else {
    fails.push(name + (detail != null ? " " + detail : ""));
    console.log("FAIL " + name + (detail != null ? " " + detail : ""));
  }
}

const peak = { heap: 0, rss: 0 };
function sampleMem() {
  const m = process.memoryUsage();
  if (m.heapUsed > peak.heap) peak.heap = m.heapUsed;
  if (m.rss > peak.rss) peak.rss = m.rss;
}

async function main() {
  ok("peek_concurrency_1", INSPECTION_PEEK_CONCURRENCY === 1, String(INSPECTION_PEEK_CONCURRENCY));
  ok("max_peek_per_entry", INSPECTION_TEXT_PEEK_BYTES === 4096, String(INSPECTION_TEXT_PEEK_BYTES));
  ok("max_total_peek", INSPECTION_MAX_TOTAL_PEEK_BYTES === 2 * 1024 * 1024, "tot");
  ok("comp_chunk_bounded", PEEK_COMPRESSED_READ_CHUNK === 64 * 1024, "cc");
  ok("header_max", INSPECTION_HEADER_MAX_BYTES === 1024, "hm");
  ok("header_fields", INSPECTION_HEADER_FIELD_LIMIT === 64, "hf");
  ok("schema_ver", REPORT_SCHEMA_VERSION === "tmc-format-inspection-report-v3", REPORT_SCHEMA_VERSION);
  ok("insp_ver", INSPECTION_VERSION === "sp08001-v2.6-table4-2-complete-schema-2", INSPECTION_VERSION);

  // A + F: LARGE_DEFLATED_ENTRY_STREAM_PEEK + intentional truncation
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-peek-large-"));
    const zipPath = path.join(dir, "large.zip");
    const header = "CID;TABCD;LCD;XCOORD;YCOORD;POSOFF;NEGOFF\r\n11;25;900001;+09999999;+9999999;0;0\r\n";
    // Low-compressibility pad so ZIP bomb ratio gate stays green; still >> peek budget.
    const pad = Buffer.alloc(20_000);
    for (let i = 0; i < pad.length; i++) pad[i] = (i * 17 + 31) & 0xff;
    const raw = Buffer.concat([Buffer.from(header, "utf8"), pad]);
    const zipBuf = buildDeflatedZip([{ name: "POINTS.DAT", data: raw }]);
    fs.writeFileSync(zipPath, zipBuf);
    sampleMem();
    const before = process.memoryUsage().heapUsed;
    const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
    sampleMem();
    const after = process.memoryUsage().heapUsed;
    const blob = JSON.stringify(report);
    ok("large_deflate_no_entry_too_large", report.rejectCode !== INSPECTION_REJECT.ENTRY_TOO_LARGE, report.rejectCode);
    ok("large_deflate_no_buffer_too_large", report.rejectCode !== INSPECTION_REJECT.READ_LIMIT, report.rejectCode);
    ok("large_deflate_peek_bytes_bounded", (report.peekTotalBytes || 0) <= INSPECTION_TEXT_PEEK_BYTES + 64, String(report.peekTotalBytes));
    ok("large_deflate_truncated_or_ok", (report.truncatedPeekCount || 0) >= 1 || (report.peekTotalBytes || 0) > 0, "tr");
    ok("large_deflate_tablecode_mapped", (report.tableCodeMappedCount || 0) >= 1, String(report.tableCodeMappedCount));
    ok("large_deflate_no_basename", !/POINTS\.DAT/.test(blob), "bn");
    ok("large_deflate_heap_delta_lt_2mib", after - before < 2_000_000, String(after - before));
    ok("large_deflate_not_proportional_to_entry", (after - before) < raw.length * 50 || (report.peekTotalBytes || 0) <= INSPECTION_TEXT_PEEK_BYTES + 64, "prop");
    const targets = collectInspectionPeekTargets(zipPath).targets;
    const t0 = targets[0];
    const peeked = await peekZipEntryBytesStreaming(zipPath, t0, INSPECTION_TEXT_PEEK_BYTES);
    ok(
      "large_direct_peek_status",
      peeked.status === PEEK_STATUS.TRUNCATED_AT_LIMIT || peeked.status === PEEK_STATUS.OK,
      peeked.status
    );
    ok("large_direct_peek_len", peeked.buf.length <= INSPECTION_TEXT_PEEK_BYTES, String(peeked.buf.length));
    ok("large_direct_no_full_uncomp", peeked.buf.length < raw.length, "nu");
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }

  // B: incompressible-ish large STORE entry (bounded read)
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-peek-store-"));
    const zipPath = path.join(dir, "store.zip");
    const big = Buffer.alloc(80_000, 0x42);
    big.write("CID;TABCD\r\n11;25\r\n", 0);
    fs.writeFileSync(zipPath, buildStoredZip([{ name: "CLASSES.DAT", data: big }]));
    const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
    ok("store_stream_bounded", (report.peekTotalBytes || 0) <= INSPECTION_TEXT_PEEK_BYTES + 16, String(report.peekTotalBytes));
    ok("store_mapped", (report.tableCodeMappedCount || 0) >= 1, "m");
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }

  // C: CRLF chunk boundary via extractFirstLogicalHeaderLine
  {
    const part1 = Buffer.from("CID;TABCD\r");
    const part2 = Buffer.from("\n11;25\r\n");
    const joined = Buffer.concat([part1, part2]);
    const hdr = extractFirstLogicalHeaderLine(joined);
    ok("crlf_chunk_boundary", hdr.complete === true && hdr.lineEnding === "crlf", hdr.status);
  }

  // D: HEADER_TOO_LONG
  {
    const long = Buffer.from("A".repeat(2000) + "\r\n");
    const hdr = extractFirstLogicalHeaderLine(long, { maxHeaderBytes: 1024 });
    ok("header_too_long", hdr.status === "header_too_long" || hdr.complete === false, hdr.status);
  }

  // LF-only policy
  {
    const lf = Buffer.from("CID;TABCD\n11;25\n");
    const hdr = extractFirstLogicalHeaderLine(lf);
    ok("lf_only_rejected", hdr.status === "lf_only", hdr.status);
  }

  // Binary / NUL
  {
    const bin = Buffer.from([0x43, 0x49, 0x44, 0x00, 0x3b]);
    const hdr = extractFirstLogicalHeaderLine(bin);
    ok("binary_header_rejected", hdr.status === "binary_rejected" && hdr.hasNul === true, hdr.status);
  }

  // E: DEFLATE_CORRUPTION — corrupt only compressed payload, keep local/central headers valid
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-peek-bad-"));
    const zipPath = path.join(dir, "bad.zip");
    const name = Buffer.from("TYPES.DAT", "utf8");
    const raw = Buffer.from("CID;TABCD\r\n11;25\r\n", "utf8");
    const compressed = zlib.deflateRawSync(raw);
    // Flip middle of compressed payload
    const badComp = Buffer.from(compressed);
    const mid = Math.floor(badComp.length / 2);
    if (badComp.length > 2) badComp[mid] ^= 0xff;
    if (badComp.length > 3) badComp[mid + 1] ^= 0xaa;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(8, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(badComp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(badComp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(0, 42);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + badComp.length, 16);
    end.writeUInt16LE(0, 20);
    fs.writeFileSync(zipPath, Buffer.concat([local, name, badComp, central, name, end]));
    const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
    const counts = report.peekStatusCounts || {};
    ok(
      "corrupt_deflate_distinguished",
      (report.decompressionErrorCount || 0) >= 1 ||
        (counts[PEEK_STATUS.DECOMPRESSION_ERROR] || 0) >= 1 ||
        (counts[PEEK_STATUS.STRUCTURAL_ERROR] || 0) >= 1,
      JSON.stringify(counts) + " reject=" + report.rejectCode
    );
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }

  // G + H: basename → opaque tableCode; tableCode survives; basename does not
  {
    ok("long_name_points", resolveSp08001TableCodeFromBasename("POINTS.DAT") === "POINTS", "ln");
    ok("short_name_points", resolveSp08001TableCodeFromBasename("20.DAT") === "POINTS", "sn");
    ok("subdir_mapping", resolveSp08001TableCodeFromBasename("loc/POINTS.DAT") === null, "basename only");
    // path.basename applied by collect — verify via zip
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-peek-map-"));
    const zipPath = path.join(dir, "map.zip");
    fs.writeFileSync(
      zipPath,
      buildStoredZip([
        {
          name: "tables/POINTS.DAT",
          data: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]),
        },
        { name: "mystery.DAT", data: "CID;TABCD\r\n11;25\r\n" },
      ])
    );
    const collected = collectInspectionPeekTargets(zipPath);
    const mapped = collected.targets.filter((t) => t.tableCode === "POINTS");
    ok("tablecode_before_redaction", mapped.length === 1, String(mapped.length));
    ok("unknown_fail_closed_count", (collected.tableCodeUnknownCount || 0) >= 1, String(collected.tableCodeUnknownCount));
    ok("target_has_no_name", collected.targets.every((t) => t.name == null && t.path == null && t.basename == null), "nn");
    const report = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
    const blob = JSON.stringify(report);
    ok("report_no_basename", !/POINTS\.DAT|mystery\.DAT|tables\//i.test(blob), "rb");
    ok("report_tablecode_mapped_count", (report.tableCodeMappedCount || 0) >= 1, String(report.tableCodeMappedCount));
    ok("content_verified_with_opaque", (report.contentVerifiedTableCount || 0) >= 1, String(report.contentVerifiedTableCount));
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }

  // I: encoding layer separation
  {
    const report = inspectFormatFromEntryPeeks([
      {
        role: "metadata",
        tableCode: "README",
        ext: "dat",
        buf: Buffer.from("1\r\n01/01/2020\r\n01/01/2021\r\nPub\r\nUTF-8\r\n"),
      },
      { role: "encoding_cpg", ext: "cpg", buf: Buffer.from("Windows-1250") },
      {
        role: "points",
        tableCode: "POINTS",
        ext: "dat",
        buf: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]),
      },
    ]);
    ok("encoding_cpg_windows", report.encodingCpgLayer === "WINDOWS-1250", report.encodingCpgLayer);
    ok("encoding_false_conflict_avoided_or_dat_ok", report.encodingFalseConflictAvoided === true || report.encodingDatLayer !== "CONFLICT", String(report.encodingDatLayer));
    ok("readme_encoding_state", report.readmeEncodingState === "ASCII", report.readmeEncodingState);
  }

  // K: reject code on insufficient_evidence
  {
    const report = inspectFormatFromEntryPeeks([{ role: "points", ext: "dat", buf: Buffer.from("x") }]);
    ok("reject_code_insufficient", report.rejectCode === INSPECTION_REJECT.FORMAT_EVIDENCE_INSUFFICIENT, report.rejectCode);
    ok("reject_phase", report.rejectPhase === REJECT_PHASE.FORMAT_CONTRACT_VERIFICATION, report.rejectPhase);
    ok("outcome_insufficient", report.inspectionOutcome === INSPECTION_OUTCOME.INSUFFICIENT_EVIDENCE, report.inspectionOutcome);
    ok("schema_version_set", report.reportSchemaVersion === REPORT_SCHEMA_VERSION, report.reportSchemaVersion);
    ok("inspection_version_set", report.inspectionVersion === INSPECTION_VERSION, report.inspectionVersion);
  }

  // L: report redaction after serialize
  {
    const report = await (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-peek-red-"));
      const zipPath = path.join(dir, "r.zip");
      fs.writeFileSync(
        zipPath,
        buildStoredZip([
          { name: "POINTS.DAT", data: buildSyntheticSp08001Dat("POINTS", [syntheticPointsRow()]) },
        ])
      );
      const r = await inspectTmcZipFormatFromFile(zipPath, { workDir: dir });
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
      return r;
    })();
    const ser = serializeInspectionReport(report);
    ok("redact_no_filename", !/POINTS\.DAT/i.test(ser.json), "fn");
    ok("redact_no_path", !/[A-Za-z]:\\\\|\/home\/|\\\\users\\\\/i.test(ser.json), "path");
    ok("redact_no_raw_header_blob", !/CID;TABCD;LCD;CLASS;TCD/i.test(ser.json), "hdr");
    ok("redact_under_cap", ser.bytes <= 65536, String(ser.bytes));
  }

  // sync inflate path must refuse
  {
    let refused = false;
    try {
      const { peekZipEntryBytes } = await import("./ndic-datex-v1/tmc-format-inspection.mjs");
      peekZipEntryBytes();
    } catch (e) {
      refused = e && e.code === INSPECTION_REJECT.INTERNAL_ERROR;
    }
    ok("sync_inflate_peek_removed", refused, "ref");
  }

  sampleMem();
  if (fails.length) {
    console.error("[ndic-tmc-stream-peek-fixtures] FAIL " + fails.length);
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      mode: INSPECTION_MODE,
      peakHeapBytes: peak.heap,
      peakRssBytes: peak.rss,
      maxPeekBytesPerEntry: INSPECTION_TEXT_PEEK_BYTES,
      peekConcurrency: INSPECTION_PEEK_CONCURRENCY,
      maxTotalPeekMemoryBytes: INSPECTION_MAX_TOTAL_PEEK_BYTES,
      node: process.version,
    })
  );
  console.log("[ndic-tmc-stream-peek-fixtures] PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
