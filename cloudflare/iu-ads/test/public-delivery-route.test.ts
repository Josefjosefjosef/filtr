import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
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

/** Minimal fake covering only the SQL patterns `delivery-engine.ts`/`scheduler.ts` issue. */
class FakeD1 {
  settings = new Map<string, string>();
  campaigns = new Map<string, Row>();
  campaignPlacements: Row[] = [];
  placementTypes = new Map<string, Row>();
  creatives: Row[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  execute(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): any {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();

    if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
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
    if (sql.startsWith("SELECT campaign_id, status, start_at, end_at FROM campaigns WHERE status = 'scheduled' OR status = 'active'")) {
      return { results: [...this.campaigns.values()].filter((c) => c.status === "scheduled" || c.status === "active") };
    }
    if (sql.startsWith("UPDATE campaigns SET status = ?")) return { success: true };
    if (sql.startsWith("INSERT INTO campaign_status_events")) return { success: true };
    if (sql.startsWith("INSERT INTO audit_logs")) return { success: true };
    if (sql.includes("FROM rights_confirmations WHERE campaign_id = ?")) return null;
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

function seedOneActiveAd(db: FakeD1) {
  db.campaigns.set("cmp_1", {
    campaign_id: "cmp_1",
    status: "active",
    label_type: "Reklama",
    target_url: "https://example.test/nabidka",
    start_at: null,
    end_at: null,
  });
  db.campaignPlacements.push({
    campaign_placement_id: "cpl_1",
    campaign_id: "cmp_1",
    placement_id: "plc_header_1",
    placement_type_id: "pt_header",
    section_id: null,
    device_category: "pc",
    priority: 100,
    start_at: null,
    end_at: null,
    status: "active",
  });
  db.placementTypes.set("pt_header", { placement_type_id: "pt_header", technical_type: "banner", anchor: "header", collision_mode: "exclusive" });
  db.creatives.push({
    creative_id: "crv_1",
    campaign_id: "cmp_1",
    format: "image",
    width: 728,
    height: 90,
    r2_key: "creative/crv_1/v1.png",
    device_category: "pc",
    review_status: "approved",
  });
}

describe("GET /v1/public/ads/delivery route wiring (kap. 1,9,14,43)", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
    seedOneActiveAd(db);
  });

  it("stays fail-closed with wrangler defaults (flags off) even with an eligible ad in the DB", async () => {
    const env = { DB: db as unknown as D1Database, ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
    const res = await worker.fetch(new Request("https://worker.test/v1/public/ads/delivery?device=pc"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ads: [], enabled: false, safeMode: true });
  });

  it("delivers a real ad once ADS_PUBLIC_DELIVERY_ENABLED=true and ADS_SAFE_MODE=false", async () => {
    const env = {
      DB: db as unknown as D1Database,
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
      ADS_SAFE_MODE: "false",
      ADS_PUBLIC_DELIVERY_ENABLED: "true",
    } as Env;
    const res = await worker.fetch(new Request("https://worker.test/v1/public/ads/delivery?device=pc"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.enabled).toBe(true);
    expect(body.safeMode).toBe(false);
    expect(body.ads).toHaveLength(1);
    expect(body.ads[0].creative.cdn_url.startsWith("https://worker.test/v1/objects/get?bucket=CREATIVES&")).toBe(true);
    expect(Object.keys(body)).toEqual(["ads", "enabled", "safeMode"]);
  });

  it("returns an empty (not error) ads array when active but the device query param is missing/invalid", async () => {
    const env = {
      DB: db as unknown as D1Database,
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
      ADS_SAFE_MODE: "false",
      ADS_PUBLIC_DELIVERY_ENABLED: "true",
    } as Env;
    const res = await worker.fetch(new Request("https://worker.test/v1/public/ads/delivery?device=drone"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ads).toEqual([]);
    expect(body.enabled).toBe(true);
  });

  it("EMERGENCY_PAUSE_ALL forces empty ads even when active and otherwise eligible", async () => {
    db.settings.set("EMERGENCY_PAUSE_ALL", "true");
    const env = {
      DB: db as unknown as D1Database,
      ADS_R2_SIGNING_SECRET: SIGNING_SECRET,
      ADS_SAFE_MODE: "false",
      ADS_PUBLIC_DELIVERY_ENABLED: "true",
    } as Env;
    const res = await worker.fetch(new Request("https://worker.test/v1/public/ads/delivery?device=pc"), env);
    const body = (await res.json()) as any;
    expect(body.ads).toEqual([]);
  });

  it("rejects non-GET methods", async () => {
    const env = { DB: db as unknown as D1Database, ADS_R2_SIGNING_SECRET: SIGNING_SECRET } as Env;
    const res = await worker.fetch(new Request("https://worker.test/v1/public/ads/delivery", { method: "POST" }), env);
    expect(res.status).toBe(405);
  });
});
