import { beforeEach, describe, expect, it } from "vitest";
import {
  handleBackupDrill,
  handleCreateBackup,
  handleGetBackup,
  handleListBackups,
  handlePruneBackups,
} from "../src/admin-backup";
import { runAlertsCron } from "../src/admin-alerts";
import { generateSessionId, hashOpaqueToken, nowSeconds, signSessionToken } from "../src/session";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class FakeStatement {
  private params: unknown[] = [];
  constructor(
    private db: FakeD1,
    private sql: string
  ) {}
  bind(...args: unknown[]): FakeStatement {
    this.params = args;
    return this;
  }
  async first<T>(): Promise<T | null> {
    return this.db.execute(this.sql, this.params, "first");
  }
  async all<T>(): Promise<{ results: T[] }> {
    return this.db.execute(this.sql, this.params, "all");
  }
  async run(): Promise<{ success: true }> {
    return this.db.execute(this.sql, this.params, "run");
  }
}

class FakeD1 {
  adminUsers = new Map<string, Row>();
  adminUserRoles = new Map<string, string[]>();
  adminSessions = new Map<string, Row>();
  settings = new Map<string, string>([
    ["SCHEMA_VERSION", "0010"],
    ["BACKUP_RETENTION_DAYS", "30"],
    ["ALERT_CAMPAIGN_ENDING_DAYS", "7"],
    ["ALERT_CRON_ENABLED", "true"],
    ["PERSONALIZED_ADS", "NO"],
    ["CONTEXTUAL_ADS_ONLY", "YES"],
  ]);
  backups = new Map<string, Row>();
  auditLogs: Row[] = [];
  campaigns: Row[] = [];
  alerts = new Map<string, Row>();
  rightsConfirmations: Row[] = [];
  tableCounts = new Map<string, number>([
    ["clients", 2],
    ["campaigns", 1],
    ["system_settings", 6],
    ["backup_manifests", 0],
  ]);

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.startsWith("UPDATE admin_sessions SET last_seen_at")) return { success: true };

    if (sql.includes("FROM admin_sessions WHERE session_id = ? AND token_hash = ?")) {
      const [sessionId, tokenHash] = params;
      const row = this.adminSessions.get(String(sessionId));
      const hit = row && row.token_hash === tokenHash ? row : null;
      return mode === "all" ? { results: hit ? [hit] : [] } : hit;
    }
    if (sql.includes("FROM admin_users WHERE user_id = ?")) {
      return this.adminUsers.get(String(params[0])) || null;
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ?")) {
      const roles = this.adminUserRoles.get(String(params[0])) || [];
      return { results: roles.map((r) => ({ role_code: r })) };
    }
    if (sql.includes("FROM system_settings WHERE key = ?") || sql.includes("system_settings WHERE key = '")) {
      let key = "";
      if (sql.includes("WHERE key = ?")) key = String(params[0] || "");
      else {
        const m = sql.match(/key = '([^']+)'/);
        key = m ? m[1] : "";
      }
      const v = this.settings.get(key);
      return v === undefined ? null : { value: v };
    }
    if (sql.includes("SELECT key, value FROM system_settings")) {
      const results = [...this.settings.entries()].map(([key, value]) => ({ key, value }));
      return mode === "all" ? { results } : results[0] || null;
    }
    if (sql.includes("SELECT COUNT(*) AS cnt FROM ")) {
      const m = sql.match(/FROM\s+(\w+)/i);
      const name = m ? m[1] : "";
      const cnt = this.tableCounts.get(name) ?? 0;
      return { cnt };
    }
    if (sql.startsWith("DELETE FROM backup_manifests WHERE backup_id = ?")) {
      this.backups.delete(String(params[0]));
      this.tableCounts.set("backup_manifests", this.backups.size);
      return { success: true };
    }
    if (sql.includes("INSERT INTO backup_manifests")) {
      const [backup_id, created_at, r2_key, content_hash, encryption, status, notes] = params;
      this.backups.set(String(backup_id), {
        backup_id,
        created_at,
        r2_key,
        content_hash,
        encryption,
        status,
        notes,
      });
      this.tableCounts.set("backup_manifests", this.backups.size);
      return { success: true };
    }
    if (sql.includes("FROM backup_manifests WHERE backup_id = ?")) {
      const row = this.backups.get(String(params[0])) || null;
      return mode === "all" ? { results: row ? [row] : [] } : row;
    }
    if (sql.includes("FROM backup_manifests ORDER BY created_at")) {
      const results = [...this.backups.values()].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      );
      return { results };
    }
    if (sql.includes("SELECT backup_id, created_at FROM backup_manifests")) {
      return { results: [...this.backups.values()].map((b) => ({ backup_id: b.backup_id, created_at: b.created_at })) };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({ params: [...params] });
      return { success: true };
    }
    if (sql.includes("FROM campaigns WHERE status IN ('active','scheduled')")) {
      return { results: this.campaigns.filter((c) => c.status === "active" || c.status === "scheduled") };
    }
    if (sql.includes("FROM campaigns c") && sql.includes("rights_confirmations")) {
      const missing = this.campaigns.filter(
        (c) =>
          ["active", "scheduled", "approved"].includes(String(c.status)) &&
          !this.rightsConfirmations.some((r) => r.campaign_id === c.campaign_id)
      );
      return { results: missing };
    }
    if (sql.includes("FROM alerts WHERE alert_type = ") && sql.includes("object_id = ?")) {
      const objectId = String(params[0]);
      const typeMatch = sql.match(/alert_type = '([^']+)'/);
      const alertType = typeMatch ? typeMatch[1] : "";
      const hit = [...this.alerts.values()].find(
        (a) => a.alert_type === alertType && a.object_id === objectId && (a.status === "new" || a.status === "read")
      );
      return hit || null;
    }
    if (sql.startsWith("INSERT INTO alerts")) {
      const [alert_id, alert_type, status, object_type, object_id, assignee_user_id, message, created_at] = params;
      this.alerts.set(String(alert_id), {
        alert_id,
        alert_type,
        status,
        object_type,
        object_id,
        assignee_user_id,
        message,
        created_at,
        resolved_at: null,
      });
      return { success: true };
    }

    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SECRET = "test-session-secret-etapa9";

async function authedEnv(db: FakeD1, roles: string[]): Promise<{ env: Env; cookie: string }> {
  const userId = "user_admin";
  db.adminUsers.set(userId, {
    user_id: userId,
    email: "admin@test.cz",
    password_hash: "x",
    display_name: "Admin",
    is_active: 1,
    force_password_change: 0,
    last_login_at: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    deactivated_at: null,
  });
  db.adminUserRoles.set(userId, roles);
  const sessionId = generateSessionId();
  const exp = nowSeconds() + 3600;
  const token = await signSessionToken(SECRET, { sessionId, exp });
  const tokenHash = await hashOpaqueToken(sessionId);
  db.adminSessions.set(sessionId, {
    session_id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    created_at: new Date().toISOString(),
    expires_at: new Date(exp * 1000).toISOString(),
    revoked_at: null,
    last_seen_at: null,
  });
  const env: Env = {
    DB: db as unknown as D1Database,
    ADS_SESSION_SECRET: SECRET,
    ADS_PASSWORD_PEPPER: "pepper",
    ADS_ADMIN_API_ENABLED: "true",
  };
  return { env, cookie: "iu_ads_admin_session=" + token };
}

describe("admin backup endpoints", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it("main_admin can create + drill backup; ads_manager denied", async () => {
    const denied = await authedEnv(db, ["ads_manager"]);
    const deniedRes = await handleCreateBackup(
      new Request("https://ads.test/v1/admin/backups", {
        method: "POST",
        headers: { Cookie: denied.cookie },
      }),
      denied.env
    );
    expect(deniedRes.status).toBe(403);

    const { env, cookie } = await authedEnv(db, ["main_admin"]);
    const createRes = await handleCreateBackup(
      new Request("https://ads.test/v1/admin/backups", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      env
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { backup: { backup_id: string; status: string; encryption: string } };
    expect(created.backup.status).toBe("manifest_only");
    expect(created.backup.encryption).toBe("none");

    const drillRes = await handleBackupDrill(
      new Request("https://ads.test/v1/admin/backups/" + created.backup.backup_id + "/drill", {
        method: "POST",
        headers: { Cookie: cookie },
      }),
      env,
      created.backup.backup_id
    );
    expect(drillRes.status).toBe(200);
    const drill = (await drillRes.json()) as { ok: boolean };
    expect(drill.ok).toBe(true);

    const listRes = await handleListBackups(
      new Request("https://ads.test/v1/admin/backups", { headers: { Cookie: cookie } }),
      env,
      new URL("https://ads.test/v1/admin/backups")
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { backups: unknown[] };
    expect(list.backups.length).toBe(1);

    const getRes = await handleGetBackup(
      new Request("https://ads.test/v1/admin/backups/" + created.backup.backup_id, { headers: { Cookie: cookie } }),
      env,
      created.backup.backup_id
    );
    expect(getRes.status).toBe(200);
  });

  it("prune deletes expired manifests only", async () => {
    const { env, cookie } = await authedEnv(db, ["main_admin"]);
    db.backups.set("bak_old", {
      backup_id: "bak_old",
      created_at: "2020-01-01T00:00:00.000Z",
      r2_key: "backups/bak_old.json.enc",
      content_hash: "abc",
      encryption: "none",
      status: "manifest_only",
      notes: null,
    });
    db.backups.set("bak_new", {
      backup_id: "bak_new",
      created_at: new Date().toISOString(),
      r2_key: "backups/bak_new.json.enc",
      content_hash: "def",
      encryption: "none",
      status: "manifest_only",
      notes: null,
    });
    const res = await handlePruneBackups(
      new Request("https://ads.test/v1/admin/backups/prune", { method: "POST", headers: { Cookie: cookie } }),
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);
    expect(db.backups.has("bak_old")).toBe(false);
    expect(db.backups.has("bak_new")).toBe(true);
  });
});

describe("alerts cron (Etapa 9)", () => {
  it("runAlertsCron seeds rights_missing alerts as system:cron", async () => {
    const db = new FakeD1();
    db.campaigns.push({ campaign_id: "camp_1", title: "T", status: "approved", end_at: null });
    const result = await runAlertsCron({ DB: db as unknown as D1Database });
    expect("skipped" in result).toBe(false);
    if (!("skipped" in result)) {
      expect(result.created).toBeGreaterThanOrEqual(1);
    }
    expect([...db.alerts.values()].some((a) => a.alert_type === "rights_missing")).toBe(true);
    expect(db.auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("skips when ALERT_CRON_ENABLED=false", async () => {
    const db = new FakeD1();
    db.settings.set("ALERT_CRON_ENABLED", "false");
    const result = await runAlertsCron({ DB: db as unknown as D1Database });
    expect(result).toEqual({ skipped: true, reason: "ALERT_CRON_ENABLED=false" });
  });
});
