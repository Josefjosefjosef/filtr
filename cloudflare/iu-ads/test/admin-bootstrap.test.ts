import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  assertBootstrapSqlHasNoExplicitTxn,
  BOOTSTRAP_COMPLETED_KEY,
  BOOTSTRAP_LOCK_KEY,
  handleBootstrapMainAdmin,
  readBootstrapConsistency,
  safeEqualString,
  seedMainAdminAtomic,
} from "../src/admin-bootstrap";
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
  async run(): Promise<{ success: true; meta?: { changes: number } }> {
    return this.db.execute(this.sql, this.params, "run");
  }
}

class FakeD1 {
  users = new Map<string, Row>();
  roles: Array<{ user_id: string; role_code: string }> = [];
  resets: Array<Row> = [];
  settings = new Map<string, { value: string; updated_at: string }>();
  audits: Row[] = [];
  batchFail = false;
  failAfterUserInsert = false;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(stmts: FakeStatement[]): Promise<unknown[]> {
    if (this.batchFail) throw new Error("batch_boom");
    // Simulate atomicity: clone, apply all, commit; on error restore.
    const snap = {
      users: new Map(this.users),
      roles: [...this.roles],
      resets: [...this.resets],
      settings: new Map(this.settings),
      audits: [...this.audits],
    };
    try {
      const out = [];
      for (const st of stmts) {
        if (this.failAfterUserInsert && this.users.size > 0 && String((st as any).sql || "").includes("admin_user_roles")) {
          throw new Error("fail_after_user");
        }
        out.push(await (st as FakeStatement).run());
      }
      return out;
    } catch (e) {
      this.users = snap.users;
      this.roles = snap.roles;
      this.resets = snap.resets;
      this.settings = snap.settings;
      this.audits = snap.audits;
      throw e;
    }
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("COUNT(*) AS cnt FROM admin_users") && !sql.includes("LEFT JOIN")) {
      const cnt = this.users.size;
      return mode === "all" ? { results: [{ cnt }] } : { cnt };
    }
    if (sql.includes("FROM admin_user_roles WHERE role_code = 'main_admin'")) {
      const cnt = this.roles.filter((r) => r.role_code === "main_admin").length;
      return mode === "all" ? { results: [{ cnt }] } : { cnt };
    }
    if (sql.includes("FROM admin_password_resets WHERE used_at IS NULL")) {
      const cnt = this.resets.filter((r) => !r.used_at).length;
      return mode === "all" ? { results: [{ cnt }] } : { cnt };
    }
    if (sql.includes("FROM admin_user_roles r LEFT JOIN admin_users")) {
      const cnt = this.roles.filter((r) => !this.users.has(r.user_id)).length;
      return mode === "all" ? { results: [{ cnt }] } : { cnt };
    }
    if (sql.includes("FROM admin_users u LEFT JOIN admin_user_roles")) {
      const cnt = [...this.users.keys()].filter((id) => !this.roles.some((r) => r.user_id === id)).length;
      return mode === "all" ? { results: [{ cnt }] } : { cnt };
    }
    if (sql.includes("SELECT") && sql.includes("FROM system_settings WHERE key = ?")) {
      const key = String(params[0]);
      const row = this.settings.get(key);
      if (!row) return null;
      return { value: row.value, updated_at: row.updated_at };
    }
    if (sql.includes("DELETE FROM system_settings WHERE key = ? AND value = ?")) {
      const key = String(params[0]);
      const val = String(params[1]);
      const cur = this.settings.get(key);
      if (cur && cur.value === val) this.settings.delete(key);
      return { success: true };
    }
    if (sql.includes("DELETE FROM system_settings WHERE key = ?")) {
      this.settings.delete(String(params[0]));
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)")) {
      const [key, value, updatedAt] = params.map(String);
      if (this.settings.has(key) && !sql.includes("ON CONFLICT")) {
        throw new Error("UNIQUE constraint failed: system_settings.key");
      }
      this.settings.set(key, { value, updated_at: updatedAt });
      return { success: true };
    }
    if (sql.includes("INSERT INTO system_settings") && sql.includes("ON CONFLICT")) {
      const key = String(params[0]);
      const updatedAt = String(params[1]);
      this.settings.set(key, { value: "1", updated_at: updatedAt });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO admin_users")) {
      const [userId, email, passwordHash, displayName, createdAt, updatedAt] = params.map(String);
      this.users.set(userId, {
        user_id: userId,
        email,
        password_hash: passwordHash,
        display_name: displayName,
        is_active: 1,
        force_password_change: 1,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO admin_user_roles")) {
      this.roles.push({ user_id: String(params[0]), role_code: String(params[1]) });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO admin_password_resets")) {
      this.resets.push({
        reset_id: params[0],
        user_id: params[1],
        token_hash: params[2],
        created_at: params[3],
        expires_at: params[4],
        used_at: null,
      });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.audits.push({ audit_id: params[0] });
      return { success: true };
    }
    if (sql.includes("FROM admin_user_roles WHERE user_id = ? AND role_code = 'main_admin'")) {
      const hit = this.roles.some((r) => r.user_id === String(params[0]) && r.role_code === "main_admin");
      return hit ? { ok: 1 } : null;
    }
    if (sql.includes("FROM admin_password_resets WHERE reset_id = ? AND user_id = ?")) {
      const hit = this.resets.find((r) => r.reset_id === params[0] && r.user_id === params[1] && !r.used_at);
      return hit ? { ok: 1 } : null;
    }
    return mode === "all" ? { results: [] } : null;
  }
}

describe("assertBootstrapSqlHasNoExplicitTxn", () => {
  it("rejects BEGIN TRANSACTION", () => {
    const r = assertBootstrapSqlHasNoExplicitTxn("BEGIN TRANSACTION;\nINSERT INTO x VALUES (1);\nCOMMIT;");
    expect(r.ok).toBe(false);
  });
  it("rejects SAVEPOINT", () => {
    expect(assertBootstrapSqlHasNoExplicitTxn("SAVEPOINT sp1;").ok).toBe(false);
  });
  it("accepts plain inserts", () => {
    expect(assertBootstrapSqlHasNoExplicitTxn("INSERT INTO admin_users VALUES (1);").ok).toBe(true);
  });
});

describe("safeEqualString", () => {
  it("matches equal strings", () => {
    expect(safeEqualString("abc", "abc")).toBe(true);
    expect(safeEqualString("abc", "abd")).toBe(false);
    expect(safeEqualString("ab", "abc")).toBe(false);
  });
});

describe("seedMainAdminAtomic", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it("seeds exactly one main_admin when empty", async () => {
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "Admin@Example.com",
      displayName: "Main",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("admin@example.com");
    expect(r.activationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(db.users.size).toBe(1);
    expect(db.roles.filter((x) => x.role_code === "main_admin")).toHaveLength(1);
    expect(db.settings.get(BOOTSTRAP_COMPLETED_KEY)?.value).toBe("1");
    // Lock must be cleared after success (map keys for debug if flaky):
    expect([...db.settings.keys()].sort()).toEqual([BOOTSTRAP_COMPLETED_KEY]);
    expect(db.settings.has(BOOTSTRAP_LOCK_KEY)).toBe(false);
    const c = await readBootstrapConsistency(db as unknown as D1Database);
    expect(c.consistent).toBe(true);
    expect(c.mainAdminRoles).toBe(1);
  });

  it("refuses when main_admin count = 1", async () => {
    db.users.set("usr_1", { user_id: "usr_1", email: "a@b.c" });
    db.roles.push({ user_id: "usr_1", role_code: "main_admin" });
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "other@example.com",
      displayName: "X",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("main_admin_exists");
  });

  it("refuses when main_admin count > 1", async () => {
    db.users.set("usr_1", { user_id: "usr_1", email: "a@b.c" });
    db.users.set("usr_2", { user_id: "usr_2", email: "c@d.e" });
    db.roles.push({ user_id: "usr_1", role_code: "main_admin" });
    db.roles.push({ user_id: "usr_2", role_code: "main_admin" });
    const c = await readBootstrapConsistency(db as unknown as D1Database);
    expect(c.consistent).toBe(false);
    expect(c.reason).toBe("multiple_main_admin");
  });

  it("refuses BOOTSTRAP_COMPLETED=1", async () => {
    db.settings.set(BOOTSTRAP_COMPLETED_KEY, { value: "1", updated_at: new Date().toISOString() });
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "a@b.c",
      displayName: "X",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("bootstrap_completed");
  });

  it("refuses active bootstrap lock", async () => {
    db.settings.set(BOOTSTRAP_LOCK_KEY, { value: "lock1", updated_at: new Date().toISOString() });
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "a@b.c",
      displayName: "X",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("bootstrap_lock_held");
  });

  it("second concurrent bootstrap loses lock race", async () => {
    // Pre-seed lock as if another runner just acquired it mid-flight after our empty check —
    // simulate by making INSERT lock fail via existing key set between reads: use lock held.
    db.settings.set(BOOTSTRAP_LOCK_KEY, { value: "other", updated_at: new Date().toISOString() });
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "a@b.c",
      displayName: "X",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(false);
  });

  it("rolls back on batch failure after user insert", async () => {
    db.failAfterUserInsert = true;
    // Override batch to fail mid-way while still using FakeStatement.run order
    const orig = db.batch.bind(db);
    db.batch = async (stmts: FakeStatement[]) => {
      const snapUsers = new Map(db.users);
      const snapRoles = [...db.roles];
      const snapResets = [...db.resets];
      const snapSettings = new Map(db.settings);
      try {
        await stmts[0].run();
        throw new Error("fail_after_user");
      } catch (e) {
        db.users = snapUsers;
        db.roles = snapRoles;
        db.resets = snapResets;
        db.settings = snapSettings;
        throw e;
      }
    };
    const r = await seedMainAdminAtomic(db as unknown as D1Database, "pepper-test-0123456789abcdef", {
      email: "a@b.c",
      displayName: "X",
      ttlSeconds: 3600,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("batch_failed");
    expect(db.users.size).toBe(0);
    expect(db.roles.length).toBe(0);
    void orig;
  });

  it("detects unused resets without users as inconsistent", async () => {
    db.resets.push({ reset_id: "rst_1", user_id: "missing", used_at: null });
    const c = await readBootstrapConsistency(db as unknown as D1Database);
    expect(c.consistent).toBe(false);
    expect(c.reason).toBe("unused_resets_without_users");
  });
});

describe("handleBootstrapMainAdmin HTTP", () => {
  it("requires bearer bootstrap token and does not leak activation on unauthorized", async () => {
    const db = new FakeD1();
    const env = {
      DB: db as unknown as D1Database,
      ADS_PASSWORD_PEPPER: "pepper-test-0123456789abcdef",
      ADS_BOOTSTRAP_TOKEN: "token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
    } as Env;
    const res = await handleBootstrapMainAdmin(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.c" }),
      }),
      env
    );
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toMatch(/activate=/);
  });

  it("worker route works with valid token", async () => {
    const db = new FakeD1();
    const token = "token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const env = {
      DB: db as unknown as D1Database,
      ADS_PASSWORD_PEPPER: "pepper-test-0123456789abcdef",
      ADS_BOOTSTRAP_TOKEN: token,
      ADS_SAFE_MODE: "true",
      ADS_PUBLIC_DELIVERY_ENABLED: "false",
      ADS_ADMIN_API_ENABLED: "false",
      ADS_CLIENT_API_ENABLED: "false",
    } as Env;
    const res = await worker.fetch(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "main@example.com", ttlSeconds: 3600 }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; activationUrl?: string };
    expect(j.ok).toBe(true);
    expect(j.activationUrl).toContain("activate=");
    // second call refused
    const res2 = await worker.fetch(
      new Request("https://ads.test/v1/internal/bootstrap/main-admin", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "other@example.com", ttlSeconds: 3600 }),
      }),
      env
    );
    expect(res2.status).toBe(409);
  });
});
