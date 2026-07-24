import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePrecheck } from "../src/bootstrap-precheck";
// @ts-expect-error plain ESM lib used by GitHub Actions CLI (no types)
import { evaluatePrecheck as evaluatePrecheckMjs } from "../scripts/iu-ads-bootstrap-precheck-lib.mjs";

function wranglerCountJson(cnt: number): string {
  return JSON.stringify([{ results: [{ cnt }], success: true }]);
}

describe("iu-ads-bootstrap-precheck evaluate", () => {
  it("D1 command exit non-zero => D1_QUERY_FAILED fail-closed", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 1,
      stdout: "",
      stderr: "Error: A request to the Cloudflare API failed.",
    });
    expect(r.status).toBe("D1_QUERY_FAILED");
    expect(r.processExit).toBe(1);
    expect(r.detail).not.toMatch(/[A-Za-z0-9_\-]{40}/);
  });

  it("missing table stderr => TABLE_MISSING", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 1,
      stdout: "",
      stderr: "no such table: admin_user_roles",
    });
    expect(r.status).toBe("TABLE_MISSING");
    expect(r.processExit).toBe(1);
  });

  it("invalid JSON => JSON_INVALID", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 0,
      stdout: "not-json <<<",
      stderr: "",
    });
    expect(r.status).toBe("JSON_INVALID");
    expect(r.processExit).toBe(1);
  });

  it("count 0 => OK", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 0,
      stdout: wranglerCountJson(0),
      stderr: "",
    });
    expect(r.status).toBe("OK");
    expect(r.count).toBe(0);
    expect(r.processExit).toBe(0);
  });

  it("count 1 => MAIN_ADMIN_EXISTS", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 0,
      stdout: wranglerCountJson(1),
      stderr: "",
    });
    expect(r.status).toBe("MAIN_ADMIN_EXISTS");
    expect(r.count).toBe(1);
    expect(r.processExit).toBe(1);
  });

  it("count >1 => MAIN_ADMIN_EXISTS", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 0,
      stdout: wranglerCountJson(3),
      stderr: "",
    });
    expect(r.status).toBe("MAIN_ADMIN_EXISTS");
    expect(r.count).toBe(3);
    expect(r.processExit).toBe(1);
  });

  it("mjs lib stays in parity with TS module for count 0/1", () => {
    const a = evaluatePrecheck({ kind: "main_admin_count", exitCode: 0, stdout: wranglerCountJson(0), stderr: "" });
    const b = evaluatePrecheckMjs({ kind: "main_admin_count", exitCode: 0, stdout: wranglerCountJson(0), stderr: "" });
    expect(b).toEqual(a);
    const c = evaluatePrecheck({ kind: "main_admin_count", exitCode: 0, stdout: wranglerCountJson(1), stderr: "" });
    const d = evaluatePrecheckMjs({ kind: "main_admin_count", exitCode: 0, stdout: wranglerCountJson(1), stderr: "" });
    expect(d).toEqual(c);
  });

  it("BOOTSTRAP_COMPLETED=1 => BOOTSTRAP_COMPLETED", () => {
    const r = evaluatePrecheck({
      kind: "bootstrap_lock",
      exitCode: 0,
      stdout: JSON.stringify([{ results: [{ value: "1" }], success: true }]),
      stderr: "",
    });
    expect(r.status).toBe("BOOTSTRAP_COMPLETED");
    expect(r.processExit).toBe(1);
  });

  it("bootstrap lock unset (empty results) => OK", () => {
    const r = evaluatePrecheck({
      kind: "bootstrap_lock",
      exitCode: 0,
      stdout: JSON.stringify([{ results: [], success: true }]),
      stderr: "",
    });
    expect(r.status).toBe("OK");
    expect(r.processExit).toBe(0);
  });

  it("ambiguous count missing => AMBIGUOUS fail-closed", () => {
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 0,
      stdout: JSON.stringify([{ results: [{}], success: true }]),
      stderr: "",
    });
    expect(r.status).toBe("AMBIGUOUS");
    expect(r.processExit).toBe(1);
  });

  it("redacts long tokens from stderr detail", () => {
    const secretish = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_secret";
    const r = evaluatePrecheck({
      kind: "main_admin_count",
      exitCode: 1,
      stdout: "",
      stderr: "auth failed token=" + secretish,
    });
    expect(r.detail).not.toContain(secretish);
    expect(r.detail).toContain("[REDACTED]");
  });

  it("schema probe count 0 => TABLE_MISSING", () => {
    const r = evaluatePrecheck({
      kind: "schema_probe",
      exitCode: 0,
      stdout: wranglerCountJson(0),
      stderr: "",
    });
    expect(r.status).toBe("TABLE_MISSING");
  });
});

describe("bootstrap workflow D1 resolve + fail-closed markers", () => {
  it("resolves database_id and does not skip main_admin guard with || true", () => {
    const wf = readFileSync(
      join(process.cwd(), "..", "..", ".github", "workflows", "bootstrap-iu-ads-main-admin.yml"),
      "utf8"
    );
    expect(wf).toContain("Resolve real D1 database_id for iu-ads");
    expect(wf).toContain("D1_ID_PATCHED=yes");
    expect(wf).toContain("iu-ads-bootstrap-precheck.mjs");
    expect(wf).toContain("run_mode");
    expect(wf).toContain("precheck_only");
    expect(wf).toContain("MAIN_ADMIN_EXISTS");
    expect(wf).toContain("fail-closed");
    expect(wf).toContain("ADS_PUBLIC_DELIVERY_ENABLED:false");
    // Security guard must not be bypassed with || true on the main_admin query path.
    const refuseBlock = wf.split("Refuse if main_admin already exists")[1] || "";
    expect(refuseBlock).not.toMatch(/main_admin[\s\S]{0,200}\|\|\s*true/);
    expect(wf).not.toContain('database_id = "00000000');
  });
});

describe("precheck CLI smoke", () => {
  it("prints STATUS lines only for a fixture", async () => {
    const { spawnSync } = await import("node:child_process");
    const dir = mkdtempSync(join(tmpdir(), "iu-precheck-"));
    try {
      const out = join(dir, "out.json");
      const err = join(dir, "err.txt");
      writeFileSync(out, wranglerCountJson(0));
      writeFileSync(err, "");
      const r = spawnSync(
        process.execPath,
        [
          join(process.cwd(), "scripts", "iu-ads-bootstrap-precheck.mjs"),
          "evaluate",
          "--kind",
          "main_admin_count",
          "--exit-code",
          "0",
          "--stdout-file",
          out,
          "--stderr-file",
          err,
        ],
        { encoding: "utf8", windowsHide: true }
      );
      expect(r.status).toBe(0);
      expect(String(r.stdout)).toContain("STATUS=OK");
      expect(String(r.stdout)).toContain("COUNT=0");
      expect(String(r.stdout)).not.toMatch(/activate=/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
