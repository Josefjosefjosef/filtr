import { beforeEach, describe, expect, it } from "vitest";
import { assertNoForbiddenPublicKeys, sanitizePublicAds } from "../src/isolation";
import { isDeviceCategory, selectPublicAds } from "../src/delivery-engine";
import type { Env } from "../src/types";

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
  settings = new Map<string, string>();
  campaigns = new Map<string, Row>();
  campaignPlacements: Row[] = [];
  placementTypes = new Map<string, Row>();
  creatives: Row[] = [];
  rightsConfirmations = new Set<string>();
  campaignStatusEvents: Row[] = [];
  auditLogs: Row[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("key = 'EMERGENCY_PAUSE_ALL'")) {
      const v = this.settings.get("EMERGENCY_PAUSE_ALL");
      return v === undefined ? null : { value: v };
    }
    if (sql.includes("key = 'PUBLIC_DELIVERY_CACHE_TTL_SECONDS'")) {
      const v = this.settings.get("PUBLIC_DELIVERY_CACHE_TTL_SECONDS");
      return v === undefined ? null : { value: v };
    }
    if (sql.includes("key = 'ADS_LABEL_DEFAULT'")) {
      const v = this.settings.get("ADS_LABEL_DEFAULT");
      return v === undefined ? null : { value: v };
    }

    // Auto-scheduler queries (see test/scheduler.test.ts for a focused unit-test FakeD1).
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
      this.campaignStatusEvents.push({ event_id: eventId, campaign_id: campaignId, from_status: fromStatus, to_status: toStatus, actor_user_id: actorUserId, reason, created_at: createdAt });
      return { success: true };
    }
    if (sql.startsWith("INSERT INTO audit_logs")) {
      this.auditLogs.push({ params });
      return { success: true };
    }
    if (sql.includes("FROM rights_confirmations WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.rightsConfirmations.has(String(campaignId)) ? { confirmation_id: "rgt_1" } : null;
    }

    // Delivery engine queries.
    if (sql.includes("FROM campaign_placements WHERE status = 'active' AND device_category = ?")) {
      const [device] = params;
      return { results: this.campaignPlacements.filter((p) => p.status === "active" && p.device_category === device) };
    }
    if (sql.includes("FROM campaigns WHERE campaign_id = ?")) {
      const [campaignId] = params;
      return this.campaigns.get(String(campaignId)) || null;
    }
    if (sql.includes("FROM placement_types WHERE placement_type_id = ?")) {
      const [placementTypeId] = params;
      return this.placementTypes.get(String(placementTypeId)) || null;
    }
    if (sql.includes("FROM creatives WHERE campaign_id = ? AND review_status = 'approved'")) {
      const [campaignId, device] = params;
      const matches = this.creatives.filter(
        (c) => c.campaign_id === campaignId && c.review_status === "approved" && (c.device_category === device || c.device_category === "universal")
      );
      return matches[0] || null;
    }

    if (mode === "all") return { results: [] };
    if (mode === "run") return { success: true };
    return null;
  }
}

const SIGNING_SECRET = "test-signing-secret-not-for-prod";

function baseEnv(db: FakeD1): Env {
  return { DB: db as unknown as D1Database, ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
}

function seedActiveAd(
  db: FakeD1,
  overrides: {
    campaignId?: string;
    placementId?: string;
    placementTypeId?: string;
    sectionId?: string | null;
    device?: string;
    priority?: number;
    collisionMode?: string;
    reviewStatus?: string;
  } = {}
) {
  const campaignId = overrides.campaignId || "cmp_1";
  const placementTypeId = overrides.placementTypeId || "pt_header";
  db.campaigns.set(campaignId, {
    campaign_id: campaignId,
    status: "active",
    label_type: "Reklama",
    target_url: "https://example.test/nabidka",
    start_at: null,
    end_at: null,
  });
  db.campaignPlacements.push({
    campaign_placement_id: "cpl_" + campaignId + "_" + placementTypeId,
    campaign_id: campaignId,
    placement_id: overrides.placementId || "plc_header_1",
    placement_type_id: placementTypeId,
    section_id: overrides.sectionId === undefined ? null : overrides.sectionId,
    device_category: overrides.device || "pc",
    priority: overrides.priority ?? 100,
    start_at: null,
    end_at: null,
    status: "active",
  });
  db.placementTypes.set(placementTypeId, {
    placement_type_id: placementTypeId,
    technical_type: "banner",
    anchor: "header",
    collision_mode: overrides.collisionMode || "exclusive",
  });
  db.creatives.push({
    creative_id: "crv_" + campaignId,
    campaign_id: campaignId,
    format: "image",
    width: 728,
    height: 90,
    r2_key: "creative/crv_" + campaignId + "/v1.png",
    device_category: overrides.device || "pc",
    review_status: overrides.reviewStatus || "approved",
  });
}

describe("isDeviceCategory", () => {
  it("accepts only pc/mobile/tablet", () => {
    expect(isDeviceCategory("pc")).toBe(true);
    expect(isDeviceCategory("mobile")).toBe(true);
    expect(isDeviceCategory("tablet")).toBe(true);
    expect(isDeviceCategory("desktop")).toBe(false);
    expect(isDeviceCategory(null)).toBe(false);
    expect(isDeviceCategory(undefined)).toBe(false);
  });
});

describe("selectPublicAds fail-closed conditions (kap. 1,14,33,43)", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
    seedActiveAd(db);
  });

  it("returns [] when DB is unbound", async () => {
    const env = { ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
    expect(await selectPublicAds(env, "https://worker.test", { device: "pc", section: null })).toEqual([]);
  });

  it("returns [] when the R2 signing secret is not configured (cannot mint a safe URL)", async () => {
    const env = { DB: db as unknown as D1Database } as Env;
    expect(await selectPublicAds(env, "https://worker.test", { device: "pc", section: null })).toEqual([]);
  });

  it("returns [] when EMERGENCY_PAUSE_ALL is true, even with an otherwise-eligible ad", async () => {
    db.settings.set("EMERGENCY_PAUSE_ALL", "true");
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("fails closed (treats as paused) if the EMERGENCY_PAUSE_ALL setting cannot be read", async () => {
    const brokenDb: any = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            throw new Error("db unavailable");
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          },
        };
      },
    };
    const env = { DB: brokenDb as D1Database, ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
    expect(await selectPublicAds(env, "https://worker.test", { device: "pc", section: null })).toEqual([]);
  });
});

describe("selectPublicAds allowlist shape + filters (kap. 1,9,43)", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
  });

  it("delivers one allowlist-shaped ad for an active campaign/placement/approved creative", async () => {
    seedActiveAd(db);
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toHaveLength(1);
    const sanitized = sanitizePublicAds(ads);
    expect(assertNoForbiddenPublicKeys({ ads: sanitized })).toEqual([]);
    expect(sanitized[0]).toMatchObject({
      campaign_id: "cmp_1",
      placement_id: "plc_header_1",
      section_id: "",
      slot_type: "banner",
      device_category: "pc",
      label: "Reklama",
      target_url: "https://example.test/nabidka",
      anchor: "header",
    });
    expect(sanitized[0].creative.cdn_url.startsWith("https://worker.test/v1/objects/get?bucket=CREATIVES&key=")).toBe(true);
    expect(sanitized[0].creative.cdn_url).not.toContain("r2.cloudflarestorage.com");
  });

  it("never delivers an unapproved (pending) creative", async () => {
    seedActiveAd(db, { reviewStatus: "pending" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("never delivers a rejected creative", async () => {
    seedActiveAd(db, { reviewStatus: "rejected" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("filters out placements for a different device category", async () => {
    seedActiveAd(db, { device: "mobile" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("matches a global (section_id null) placement regardless of requested section", async () => {
    seedActiveAd(db, { sectionId: null });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: "article_feed" });
    expect(ads).toHaveLength(1);
  });

  it("filters out a section-scoped placement when the requested section does not match", async () => {
    seedActiveAd(db, { sectionId: "global_header" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: "article_feed" });
    expect(ads).toEqual([]);
  });

  it("matches a section-scoped placement when the requested section matches", async () => {
    seedActiveAd(db, { sectionId: "article_feed" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: "article_feed" });
    expect(ads).toHaveLength(1);
  });

  it("does not deliver a campaign that is not status=active", async () => {
    seedActiveAd(db);
    (db.campaigns.get("cmp_1") as Row).status = "paused";
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("does not deliver a campaign_placement that is not status=active", async () => {
    seedActiveAd(db);
    (db.campaignPlacements[0] as Row).status = "planned";
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("respects the campaign start_at window as defense-in-depth (status=active but start_at not yet reached)", async () => {
    seedActiveAd(db);
    // Scheduler only acts on `scheduled`/`active` transitions driven by start_at/end_at crossing
    // `now`; an inconsistent already-`active` row with a future start_at is caught here instead.
    (db.campaigns.get("cmp_1") as Row).start_at = "2099-01-01T00:00:00Z";
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("respects the campaign_placement start_at window as defense-in-depth", async () => {
    seedActiveAd(db);
    (db.campaignPlacements[0] as Row).start_at = "2099-01-01T00:00:00Z";
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toEqual([]);
  });

  it("exclusive collision_mode keeps only the lowest-priority candidate per placement/device/section", async () => {
    seedActiveAd(db, { campaignId: "cmp_1", placementId: "plc_shared", priority: 100, collisionMode: "exclusive" });
    seedActiveAd(db, { campaignId: "cmp_2", placementId: "plc_shared", placementTypeId: "pt_header", priority: 50, collisionMode: "exclusive" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toHaveLength(1);
    expect(ads[0].campaign_id).toBe("cmp_2");
  });

  it("shared collision_mode allows every eligible candidate for the same placement", async () => {
    seedActiveAd(db, { campaignId: "cmp_1", placementId: "plc_tile", placementTypeId: "pt_tile", priority: 100, collisionMode: "shared" });
    seedActiveAd(db, { campaignId: "cmp_2", placementId: "plc_tile", placementTypeId: "pt_tile", priority: 50, collisionMode: "shared" });
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads).toHaveLength(2);
  });

  it("uses ADS_LABEL_DEFAULT when a campaign's label_type is missing", async () => {
    seedActiveAd(db);
    (db.campaigns.get("cmp_1") as Row).label_type = "";
    db.settings.set("ADS_LABEL_DEFAULT", "Sponzorováno");
    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });
    expect(ads[0].label).toBe("Sponzorováno");
  });
});

describe("selectPublicAds auto start/stop integration (kap. 14)", () => {
  it("delivers an ad for a campaign the auto-scheduler just promoted from scheduled to active", async () => {
    const db = new FakeD1();
    seedActiveAd(db);
    const campaign = db.campaigns.get("cmp_1") as Row;
    campaign.status = "scheduled";
    campaign.start_at = "2020-01-01T00:00:00Z";
    db.rightsConfirmations.add("cmp_1");

    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });

    expect(db.campaigns.get("cmp_1")?.status).toBe("active");
    expect(db.campaignStatusEvents.at(-1)).toMatchObject({ campaign_id: "cmp_1", to_status: "active", reason: "auto_start" });
    expect(ads).toHaveLength(1);
  });

  it("never serves a scheduled campaign the auto-scheduler correctly skipped (missing rights confirmation)", async () => {
    const db = new FakeD1();
    seedActiveAd(db);
    const campaign = db.campaigns.get("cmp_1") as Row;
    campaign.status = "scheduled";
    campaign.start_at = "2020-01-01T00:00:00Z";
    // No rights confirmation recorded.

    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });

    expect(db.campaigns.get("cmp_1")?.status).toBe("scheduled");
    expect(ads).toEqual([]);
  });

  it("stops serving an active campaign the auto-scheduler just ended", async () => {
    const db = new FakeD1();
    seedActiveAd(db);
    (db.campaigns.get("cmp_1") as Row).end_at = "2020-01-01T00:00:00Z";

    const ads = await selectPublicAds(baseEnv(db), "https://worker.test", { device: "pc", section: null });

    expect(db.campaigns.get("cmp_1")?.status).toBe("ended");
    expect(ads).toEqual([]);
  });
});
