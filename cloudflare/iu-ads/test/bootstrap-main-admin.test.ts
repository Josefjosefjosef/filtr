import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "iu-ads-bootstrap-main-admin.mjs");

function runBootstrap(env: Record<string, string>, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "iu-ads-boot-"));
  const sqlOut = join(dir, "bootstrap.sql");
  const activationOut = join(dir, "activation-url.txt");
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--sql-out", sqlOut, "--activation-out", activationOut, ...extraArgs],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
      windowsHide: true,
    }
  );
  return { dir, sqlOut, activationOut, result };
}

describe("iu-ads-bootstrap-main-admin.mjs", () => {
  it("writes SQL hashes + activation file without leaking token to stdout", () => {
    const { dir, sqlOut, activationOut, result } = runBootstrap({
      ADS_PASSWORD_PEPPER: "test-pepper-not-for-prod-0123456789abcdef",
      BOOTSTRAP_ADMIN_EMAIL: "Main.Admin@Example.com",
      BOOTSTRAP_ACTIVATION_TTL_SECONDS: "3600",
    });
    try {
      expect(result.status).toBe(0);
      const stdout = String(result.stdout || "");
      expect(stdout).toContain("BOOTSTRAP_STATUS=READY_FOR_D1_APPLY");
      expect(stdout).not.toMatch(/activate=/i);
      expect(stdout).not.toContain("pbkdf2$");
      expect(stdout).not.toContain("test-pepper");

      const sql = readFileSync(sqlOut, "utf8");
      expect(sql).toContain("main_admin");
      expect(sql).toContain("main.admin@example.com");
      expect(sql).toMatch(/pbkdf2\$100000\$/);
      expect(sql).toContain("BOOTSTRAP_COMPLETED");
      expect(sql).toContain("main_admin_bootstrap_created");
      expect(sql).not.toMatch(/activate=/);

      const act = readFileSync(activationOut, "utf8");
      expect(act).toMatch(/activate=[0-9a-f]{64}/i);
      expect(act).toContain("email=main.admin%40example.com");
      expect(act).toContain("/admin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses missing pepper without printing values", () => {
    const { dir, result } = runBootstrap({
      ADS_PASSWORD_PEPPER: "",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    });
    try {
      expect(result.status).toBe(2);
      expect(String(result.stderr || "")).toMatch(/ADS_PASSWORD_PEPPER/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses invalid email", () => {
    const { dir, result } = runBootstrap({
      ADS_PASSWORD_PEPPER: "pepper-ok-0123456789abcdef0123456789",
      BOOTSTRAP_ADMIN_EMAIL: "not-an-email",
    });
    try {
      expect(result.status).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses out-of-range TTL", () => {
    const { dir, result } = runBootstrap({
      ADS_PASSWORD_PEPPER: "pepper-ok-0123456789abcdef0123456789",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
      BOOTSTRAP_ACTIVATION_TTL_SECONDS: "60",
    });
    try {
      expect(result.status).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("activation token in file is not present as plaintext in SQL (only hash)", () => {
    const { dir, sqlOut, activationOut, result } = runBootstrap({
      ADS_PASSWORD_PEPPER: "pepper-ok-0123456789abcdef0123456789",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
    });
    try {
      expect(result.status).toBe(0);
      const act = readFileSync(activationOut, "utf8");
      const m = act.match(/activate=([0-9a-f]+)/i);
      expect(m).toBeTruthy();
      const token = m![1];
      const sql = readFileSync(sqlOut, "utf8");
      expect(sql).not.toContain(token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("admin activation UI markers", () => {
  it("shell embeds activate form and password-reset confirm path", async () => {
    const { ADMIN_SHELL_HTML } = await import("../src/admin-ui");
    const { ADMIN_UI_SCRIPT } = await import("../src/admin-ui-script");
    expect(ADMIN_SHELL_HTML).toContain('id="activate-card"');
    expect(ADMIN_SHELL_HTML).toContain('id="activate-form"');
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/password-reset/confirm");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/auth/sessions/revoke-all");
    expect(ADMIN_UI_SCRIPT).toContain("activate");
  });
});

describe("bootstrap workflow safety markers", () => {
  it("workflow_dispatch has no password input and uploads private artifact", () => {
    const wf = readFileSync(
      join(process.cwd(), "..", "..", ".github", "workflows", "bootstrap-iu-ads-main-admin.yml"),
      "utf8"
    );
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("admin_email");
    const inputsBlock = wf.match(/workflow_dispatch:\s*\n\s*inputs:([\s\S]*?)\nconcurrency:/);
    expect(inputsBlock).toBeTruthy();
    expect(String(inputsBlock![1]).toLowerCase()).not.toContain("password");
    expect(wf).toContain("iu-ads-main-admin-activation");
    expect(wf).toContain("retention-days: 1");
    expect(wf).toContain("main_admin already exists");
    expect(wf).toContain("Resolve real D1 database_id");
    expect(wf).toContain("ADS_PUBLIC_DELIVERY_ENABLED:false");
    expect(wf).toContain("BOOTSTRAP_STATUS=SUCCESS");
    expect(wf).toContain("precheck_only");
  });
});
