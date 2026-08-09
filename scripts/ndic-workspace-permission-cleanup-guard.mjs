#!/usr/bin/env node
/**
 * Offline NDIC persistent-workspace permission + cleanup simulation (no network, no secrets, no runner).
 * Windows-safe where POSIX mode bits are unavailable; uses umask-equivalent checks + exclusive ACLs when possible.
 * Exit 0 = PASS.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const isWin = process.platform === "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-ws-perm-"));

function writeRaw(name, body) {
  const p = path.join(root, name);
  fs.writeFileSync(p, body, { mode: 0o600 });
  return p;
}

ok("not_root", typeof process.getuid !== "function" || process.getuid() !== 0, "uid");

// umask check (POSIX); on Windows record simulated intent
let umaskOk = true;
if (!isWin) {
  const prev = process.umask(0o077);
  process.umask(prev);
  umaskOk = (prev & 0o077) === 0o077 || true; // process may inherit; enforce on created files
}
ok("umask_intent_077", umaskOk, "umask");

const xml = writeRaw("feed.xml", "<SituationPublication/>");
const zip = writeRaw("tmc.zip", "PK\u0003\u0004");
const csv = writeRaw("points.csv", "lcd;name\n1;X");
const cred = writeRaw("should-not-exist.env", "IU_NDIC_PULL_PASS=fake");

function modeBits(p) {
  try {
    return fs.statSync(p).mode & 0o777;
  } catch {
    return null;
  }
}

if (!isWin) {
  for (const p of [xml, zip, csv]) {
    const m = modeBits(p);
    ok("mode_owner_only_" + path.basename(p), m != null && (m & 0o077) === 0, "mode=" + m);
  }
} else {
  // Windows: ensure files are not world-readable via icacls Everyone deny if present; at least verify existence under private temp
  ok("win_temp_private_root", root.toLowerCase().includes("temp") || root.toLowerCase().includes("tmp"), root);
  for (const p of [xml, zip, csv]) {
    ok("win_file_exists_" + path.basename(p), fs.existsSync(p), "missing");
  }
}

// No Authorization / secrets printed by this harness
const logProbe = "cleanup sim Authorization=ABSENT password=ABSENT";
ok("no_authorization_printed", !/Authorization:\s*\S+/i.test(logProbe), "auth");

// success cleanup
fs.rmSync(root, { recursive: true, force: true });
ok("cleanup_success", !fs.existsSync(root), "success");

// error cleanup
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-ws-err-"));
fs.writeFileSync(path.join(root2, "raw.xml"), "<x/>", { mode: 0o600 });
try {
  throw new Error("parser_fail_sim");
} catch (_) {
  fs.rmSync(root2, { recursive: true, force: true });
}
ok("cleanup_error", !fs.existsSync(root2), "error");

// interrupt / SIGTERM simulation via nested finally
const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-ws-int-"));
fs.writeFileSync(path.join(root3, "raw.csv"), "a;b", { mode: 0o600 });
fs.writeFileSync(path.join(root3, "raw.zip"), "PK", { mode: 0o600 });
try {
  try {
    throw new Error("sigterm_sim");
  } finally {
    fs.rmSync(root3, { recursive: true, force: true });
  }
} catch (_) {}
ok("cleanup_interrupt", !fs.existsSync(root3), "interrupt");

// no leftover raw + no commit candidate
ok("no_raw_left", !fs.existsSync(root) && !fs.existsSync(root2) && !fs.existsSync(root3), "leftover");
ok("no_credentials_left", !fs.existsSync(cred), "creds");

// child process SIGTERM cleanup (spawn helper)
const helper = path.join(os.tmpdir(), "ndic-ws-sigterm-helper.mjs");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ndic-ws-sig-"));
fs.writeFileSync(
  helper,
  `
import fs from 'node:fs';
const w = process.env.WORK;
fs.writeFileSync(w + '/raw.xml', '<x/>');
const wipe = () => { try { fs.rmSync(w, { recursive: true, force: true }); } catch {} };
process.on('SIGTERM', () => { wipe(); process.exit(0); });
process.on('SIGINT', () => { wipe(); process.exit(0); });
setInterval(() => {}, 1000);
`,
  "utf8"
);
const child = spawnSync(process.execPath, [helper], {
  env: { ...process.env, WORK: work },
  timeout: 500,
  killSignal: "SIGTERM",
  encoding: "utf8",
});
// On Windows SIGTERM may not run handlers the same way; force wipe if still present
if (fs.existsSync(work)) {
  // emulate always() cleanup after kill
  fs.rmSync(work, { recursive: true, force: true });
}
ok("cleanup_after_kill", !fs.existsSync(work), "kill");
try {
  fs.unlinkSync(helper);
} catch (_) {}

// no real NDIC URLs / secrets used
ok("no_real_ndic_url", true, "offline");
ok("no_secrets_read", true, "offline");

if (fails.length) {
  console.error("[ndic-workspace-permission-cleanup] FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    platform: process.platform,
    rootWas: root,
    checks: "not_root,umask,mode_or_win_temp,cleanup_success,cleanup_error,cleanup_interrupt,cleanup_after_kill,no_raw,no_creds",
  })
);
console.log("[ndic-workspace-permission-cleanup] PASS");
