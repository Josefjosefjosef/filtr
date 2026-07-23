import { beforeEach, describe, expect, it } from "vitest";
import { runAutoScheduler, shouldAutoActivate, shouldAutoEnd } from "../src/scheduler";

type Row = Record<string, unknown>;

class FakeStatement {
  private params: unknown[] = [];
  constructor(private db: FakeD1, private sql: string) {}
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
  campaigns = new Map<string, Row>();
  rightsConfirmations = new Set<string>();
  campaignStatusEvents: Row[] = [];
  auditLogs: Row[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.startsWith("SELECT campaign_id, status, start_at, end_at FROM campaigns WHERE status = 'scheduled' OR status = 'active'")) {
      return { results: [...this.campaigns.values()].filter((c) => c.status === "scheduled" || c.status === "active") };
    }
    if (sql.startsWith("UPDATE campaigns SET status = ?")) {
      const [status, actualStartAt, actualEndAt, updatedAt, campaignId] = params;
      const row = this.campaigns.get(String(campaignId));
      if (row) {
        row.status = status;
        row.actual_start_at = row.actual_start_at ?? actualStartAt;
        row.actual_end_at = row.actual_end_at ?? actualEndAt;
        row.updated_at = updatedAt;
      }
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO campaign_status_events")) {
      const [eventId, campaignId, fromStatus, toStatus, actorUserId, reason, createdAt] = params;
      this.campaignStatusEvents.push({
        event_id: eventId,
        campaign_id: campaignId,
        from_status: fromStatus,
        to_status: toStatus,
        actor_user_id: actorUserId,
        reason,
        created_at: createdAt,
      });
      return { success: true };
    }
    if (sql.includes("FROM rights_confirmations WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.rightsConfirmations.has(String(campaignId)) ? { confirmation_id: "rgt_1" } : null;
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({ params });
      return { success: true };
    }
    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

describe("scheduler pure predicates (kap. 14)", () => {
  it("shouldAutoActivate is true only for scheduled campaigns whose start_at has passed", () => {
    expect(shouldAutoActivate({ campaign_id: "c1", status: "scheduled", start_at: "2020-01-01T00:00:00Z", end_at: null }, "2026-01-01T00:00:00Z")).toBe(true);
    expect(shouldAutoActivate({ campaign_id: "c1", status: "scheduled", start_at: "2030-01-01T00:00:00Z", end_at: null }, "2026-01-01T00:00:00Z")).toBe(false);
    expect(shouldAutoActivate({ campaign_id: "c1", status: "scheduled", start_at: null, end_at: null }, "2026-01-01T00:00:00Z")).toBe(false);
    expect(shouldAutoActivate({ campaign_id: "c1", status: "active", start_at: "2020-01-01T00:00:00Z", end_at: null }, "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("shouldAutoEnd is true only for active campaigns whose end_at has passed", () => {
    expect(shouldAutoEnd({ campaign_id: "c1", status: "active", start_at: null, end_at: "2020-01-01T00:00:00Z" }, "2026-01-01T00:00:00Z")).toBe(true);
    expect(shouldAutoEnd({ campaign_id: "c1", status: "active", start_at: null, end_at: "2030-01-01T00:00:00Z" }, "2026-01-01T00:00:00Z")).toBe(false);
    expect(shouldAutoEnd({ campaign_id: "c1", status: "active", start_at: null, end_at: null }, "2026-01-01T00:00:00Z")).toBe(false);
    expect(shouldAutoEnd({ campaign_id: "c1", status: "scheduled", start_at: null, end_at: "2020-01-01T00:00:00Z" }, "2026-01-01T00:00:00Z")).toBe(false);
  });
});

describe("runAutoScheduler integration (fake D1, kap. 14)", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it("auto-activates a scheduled campaign whose start_at has passed and has a rights confirmation", async () => {
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", status: "scheduled", start_at: "2020-01-01T00:00:00Z", end_at: null });
    db.rightsConfirmations.add("cmp_1");

    const result = await runAutoScheduler(db as unknown as D1Database, "2026-01-01T00:00:00Z");

    expect(result.activated).toEqual(["cmp_1"]);
    expect(db.campaigns.get("cmp_1")?.status).toBe("active");
    expect(db.campaignStatusEvents.at(-1)).toMatchObject({ campaign_id: "cmp_1", from_status: "scheduled", to_status: "active", reason: "auto_start", actor_user_id: null });
    expect(db.auditLogs.length).toBe(1);
  });

  it("never auto-activates a scheduled campaign missing a rights confirmation (fail-closed, kap. 30)", async () => {
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", status: "scheduled", start_at: "2020-01-01T00:00:00Z", end_at: null });

    const result = await runAutoScheduler(db as unknown as D1Database, "2026-01-01T00:00:00Z");

    expect(result.activated).toEqual([]);
    expect(result.skipped).toEqual(["cmp_1"]);
    expect(db.campaigns.get("cmp_1")?.status).toBe("scheduled");
    expect(db.campaignStatusEvents).toEqual([]);
  });

  it("leaves a scheduled campaign untouched while start_at is still in the future", async () => {
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", status: "scheduled", start_at: "2030-01-01T00:00:00Z", end_at: null });
    db.rightsConfirmations.add("cmp_1");

    const result = await runAutoScheduler(db as unknown as D1Database, "2026-01-01T00:00:00Z");

    expect(result.activated).toEqual([]);
    expect(db.campaigns.get("cmp_1")?.status).toBe("scheduled");
  });

  it("auto-ends an active campaign whose end_at has passed", async () => {
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", status: "active", start_at: null, end_at: "2020-01-01T00:00:00Z" });

    const result = await runAutoScheduler(db as unknown as D1Database, "2026-01-01T00:00:00Z");

    expect(result.ended).toEqual(["cmp_1"]);
    expect(db.campaigns.get("cmp_1")?.status).toBe("ended");
    expect(db.campaignStatusEvents.at(-1)).toMatchObject({ from_status: "active", to_status: "ended", reason: "auto_end" });
  });

  it("ignores campaigns in every other status (draft/paused/cancelled/archived etc.)", async () => {
    db.campaigns.set("cmp_1", { campaign_id: "cmp_1", status: "draft", start_at: "2020-01-01T00:00:00Z", end_at: null });
    db.campaigns.set("cmp_2", { campaign_id: "cmp_2", status: "paused", start_at: null, end_at: "2020-01-01T00:00:00Z" });

    const result = await runAutoScheduler(db as unknown as D1Database, "2026-01-01T00:00:00Z");

    expect(result.activated).toEqual([]);
    expect(result.ended).toEqual([]);
    expect(db.campaigns.get("cmp_1")?.status).toBe("draft");
    expect(db.campaigns.get("cmp_2")?.status).toBe("paused");
  });
});
