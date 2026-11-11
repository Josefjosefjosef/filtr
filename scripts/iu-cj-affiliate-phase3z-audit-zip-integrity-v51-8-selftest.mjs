#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  crc32Hex,
  normalizeCrc32Hex,
  buildEvidenceManifest,
  validateEvidenceManifest,
  assertIntegrityOk,
} from "./iu-cj-affiliate-phase3z-audit-zip-integrity-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-audit-integrity-"));
const a = path.join(tmp, "a.txt");
const b = path.join(tmp, "b.json");
fs.writeFileSync(a, "hello-audit\n", "utf8");
fs.writeFileSync(b, JSON.stringify({ ok: true }) + "\n", "utf8");

const goodCrc = crc32Hex(fs.readFileSync(a));
assert(/^[0-9a-f]{8}$/.test(goodCrc), "crc32 hex width 8");
assert(normalizeCrc32Hex("ffffffff" + goodCrc) === null, "reject sign-extended crc32");
assert(normalizeCrc32Hex(goodCrc) === goodCrc, "accept valid crc32");

const manifest = buildEvidenceManifest([
  { path: "a.txt", abs: a },
  { path: "b.json", abs: b },
]);
fs.writeFileSync(path.join(tmp, "MANIFEST.json"), JSON.stringify(manifest, null, 2));

const ok = validateEvidenceManifest(manifest, tmp);
assert(ok.ok === true, "clean pack validates");
assertIntegrityOk(ok);

// 1) CRC32 tamper (sign-extended + wrong)
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files[0].crc32 = "ffffffff" + goodCrc;
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false, "sign-extended crc must FAIL");
  assert(r.failures.some((f) => f.code === "CRC32_FORMAT_INVALID"), "CRC32_FORMAT_INVALID");
}
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files[0].crc32 = "deadbeef";
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false, "wrong crc must FAIL");
  assert(r.failures.some((f) => f.code === "CRC32_MISMATCH"), "CRC32_MISMATCH");
}

// 2) SHA-256 tamper
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files[0].sha256 = "0".repeat(64);
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false && r.failures.some((f) => f.code === "SHA256_MISMATCH"), "SHA256_MISMATCH");
}

// 3) Size tamper
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files[0].size = 1;
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false && r.failures.some((f) => f.code === "SIZE_MISMATCH"), "SIZE_MISMATCH");
}

// 4) Filename / path tamper (missing)
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files[0].path = "missing-renamed.txt";
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false && r.failures.some((f) => f.code === "MISSING_FILE"), "MISSING_FILE");
}

// 5) Content tamper on disk
{
  fs.writeFileSync(a, "TAMPERED\n", "utf8");
  const r = validateEvidenceManifest(manifest, tmp);
  assert(r.ok === false, "content tamper FAIL");
  assert(
    r.failures.some((f) => f.code === "SHA256_MISMATCH" || f.code === "CRC32_MISMATCH" || f.code === "SIZE_MISMATCH"),
    "content mismatch codes"
  );
  fs.writeFileSync(a, "hello-audit\n", "utf8");
}

// 6) Manifest count / duplicate / extra
{
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.files.push(JSON.parse(JSON.stringify(bad.files[0])));
  const r = validateEvidenceManifest(bad, tmp);
  assert(r.ok === false && r.failures.some((f) => f.code === "DUPLICATE_PATH"), "DUPLICATE_PATH");
}
{
  fs.writeFileSync(path.join(tmp, "extra.bin"), "x");
  const r = validateEvidenceManifest(manifest, tmp);
  assert(r.ok === false && r.failures.some((f) => f.code === "EXTRA_FILE"), "EXTRA_FILE");
  fs.unlinkSync(path.join(tmp, "extra.bin"));
}

console.log(
  JSON.stringify({
    IU_CJ_AUDIT_ZIP_INTEGRITY_V51_8_SELFTEST: "PASS",
    crc32Sample: goodCrc,
    rejectedSignExtended: true,
    scenarios: [
      "CRC32_FORMAT_INVALID",
      "CRC32_MISMATCH",
      "SHA256_MISMATCH",
      "SIZE_MISMATCH",
      "MISSING_FILE",
      "CONTENT_TAMPER",
      "DUPLICATE_PATH",
      "EXTRA_FILE",
    ],
  })
);
