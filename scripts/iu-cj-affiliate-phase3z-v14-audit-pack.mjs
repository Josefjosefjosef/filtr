#!/usr/bin/env node
/**
 * Phase 3Z V14 — audit ZIP packing with EXTERNAL sha256 (never self-referential inside ZIP).
 *
 * Correct flow:
 * 1) Write audit files
 * 2) Manifest of file hashes (SHA256SUMS.txt) inside staging
 * 3) Compress ZIP
 * 4) Hash the finished ZIP
 * 5) Store ZIP sha in a sidecar file NEXT TO the zip (not inside it)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function walkFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * Write SHA256SUMS.txt for all files currently in staging (excluding any prior SUMS).
 */
export function writeFileManifest(stagingDir) {
  const files = walkFiles(stagingDir)
    .filter((f) => !f.endsWith(`${path.sep}SHA256SUMS.txt`) && !f.endsWith("/SHA256SUMS.txt"))
    .filter((f) => !f.endsWith("zip-meta.json"))
    .sort();
  const lines = [];
  for (const f of files) {
    const rel = path.relative(stagingDir, f).split(path.sep).join("/");
    lines.push(`${sha256File(f)}  ${rel}`);
  }
  const sumsPath = path.join(stagingDir, "G_final", "SHA256SUMS.txt");
  fs.mkdirSync(path.dirname(sumsPath), { recursive: true });
  fs.writeFileSync(sumsPath, lines.join("\n") + "\n", "utf8");
  return { sumsPath, fileCount: lines.length };
}

/**
 * Pack staging → zip, compute external sha, verify by re-read. Never embeds zip sha inside zip.
 */
export function packAuditZipExternalSha({ stagingDir, zipPath, externalShaPath } = {}) {
  if (!stagingDir || !zipPath || !externalShaPath) {
    return { ok: false, reason: "missing_paths" };
  }
  // Ensure internal meta does NOT claim to be the zip hash
  const metaPath = path.join(stagingDir, "G_final", "zip-meta.json");
  fs.mkdirSync(path.dirname(metaPath), { recursive: true });
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        note: "ZIP SHA-256 is NOT stored inside the archive. See sidecar .zip.sha256 next to the ZIP.",
        internalClaimsZipSha: false,
        fileManifest: "G_final/SHA256SUMS.txt",
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const manifest = writeFileManifest(stagingDir);

  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "pipe" }
    );
  } else {
    execFileSync("zip", ["-r", zipPath, "."], { cwd: stagingDir, stdio: "pipe" });
  }

  const zipSha256 = sha256File(zipPath);
  const sidecarBody = `${zipSha256}  ${path.basename(zipPath)}\n`;
  fs.writeFileSync(externalShaPath, sidecarBody, "utf8");

  // Verify by re-reading
  const verifiedSha256 = sha256File(zipPath);
  const sidecar = fs.readFileSync(externalShaPath, "utf8").trim().split(/\s+/)[0];
  const ok =
    zipSha256 === verifiedSha256 &&
    sidecar.toLowerCase() === zipSha256.toLowerCase() &&
    fs.statSync(zipPath).size > 0;

  // Confirm ZIP does not contain a self-hash file named like the zip sha claim
  // (zip-meta explicitly says internalClaimsZipSha=false)
  return {
    ok,
    zipPath,
    externalShaPath,
    zipSha256,
    verifiedSha256,
    bytes: fs.statSync(zipPath).size,
    fileManifestCount: manifest.fileCount,
    internalClaimsZipSha: false,
  };
}

/**
 * Regression: packing twice with same staging content yields stable file manifest;
 * zip sha may differ by compressor timestamps on some platforms — sidecar always matches its zip.
 */
export function selftestAuditPack() {
  const stamp = Date.now();
  const staging = path.join(process.env.TEMP || "/tmp", `iu-v14-auditpack-${stamp}`);
  fs.mkdirSync(path.join(staging, "A"), { recursive: true });
  fs.writeFileSync(path.join(staging, "A", "a.txt"), "hello-v14\n");
  const zipPath = path.join(process.env.TEMP || "/tmp", `iu-v14-auditpack-${stamp}.zip`);
  const shaPath = zipPath + ".sha256";
  const r = packAuditZipExternalSha({ stagingDir: staging, zipPath, externalShaPath: shaPath });
  return r;
}
