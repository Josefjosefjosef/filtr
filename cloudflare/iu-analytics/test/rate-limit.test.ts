import { describe, expect, it, beforeEach } from "vitest";
import {
  INGEST_MAX_BODY_BYTES,
  INGEST_RATE_MAX_REQUESTS,
  assertIngestBodyByteLength,
  checkIngestRateLimit,
  clientKeyFromRequest,
  resetIngestRateLimitForTests,
} from "../src/rate-limit";
import worker from "../src/index";
import type { Env } from "../src/types";

describe("ingest rate limit", () => {
  beforeEach(() => {
    resetIngestRateLimitForTests();
  });

  it("keys by CF-Connecting-IP without exposing it", () => {
    const req = new Request("https://infouzel-analytics.example/v1/ingest", {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.9", "User-Agent": "Mozilla/5.0" },
    });
    expect(clientKeyFromRequest(req)).toBe("ip:203.0.113.9");
  });

  it("allows burst under threshold then 429", () => {
    const key = "ip:198.51.100.7";
    const t0 = 1_000_000;
    for (let i = 0; i < INGEST_RATE_MAX_REQUESTS; i++) {
      expect(checkIngestRateLimit(key, t0 + i).ok).toBe(true);
    }
    const blocked = checkIngestRateLimit(key, t0 + INGEST_RATE_MAX_REQUESTS);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it("recovers after window and isolates distinct clients", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < INGEST_RATE_MAX_REQUESTS; i++) {
      expect(checkIngestRateLimit("ip:a", t0).ok).toBe(true);
    }
    expect(checkIngestRateLimit("ip:a", t0).ok).toBe(false);
    expect(checkIngestRateLimit("ip:b", t0).ok).toBe(true);
    expect(checkIngestRateLimit("ip:a", t0 + 60_000).ok).toBe(true);
  });

  it("rejects oversized bodies", () => {
    expect(assertIngestBodyByteLength(INGEST_MAX_BODY_BYTES).ok).toBe(true);
    expect(assertIngestBodyByteLength(INGEST_MAX_BODY_BYTES + 1).ok).toBe(false);
  });
});

describe("POST /v1/ingest rate limit wiring", () => {
  beforeEach(() => {
    resetIngestRateLimitForTests();
  });

  function mockEnv(): Env {
    const run = async () => ({ success: true });
    const first = async () => ({ ok: 1, total: 0, impressions: 0, clicks: 0 });
    const prepare = () => ({ bind: () => ({ run, first, all: async () => ({ results: [] }) }) });
    return {
      DB: { prepare, batch: async () => [], exec: async () => ({ count: 0 }) } as unknown as D1Database,
      CORS_ALLOW_ORIGIN: "https://www.infouzel.cz",
    };
  }

  it("returns 429 with Retry-After after excess POSTs from same IP", async () => {
    const env = mockEnv();
    const body = JSON.stringify({
      events: [{ type: "page_view", device_category: "pc", section_id: "home" }],
    });
    const mk = () =>
      new Request("https://infouzel-analytics.example/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "CF-Connecting-IP": "203.0.113.50",
          Origin: "https://www.infouzel.cz",
        },
        body,
      });

    for (let i = 0; i < INGEST_RATE_MAX_REQUESTS; i++) {
      const res = await worker.fetch(mk(), env);
      expect(res.status).toBe(200);
    }
    const limited = await worker.fetch(mk(), env);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    const j = (await limited.json()) as { ok: boolean; error?: string };
    expect(j.ok).toBe(false);
    expect(j.error).toBe("rate_limited");
    // CORS still applied for allowed origin
    expect(limited.headers.get("access-control-allow-origin")).toBe("https://www.infouzel.cz");
  });

  it("returns 413 for Content-Length over limit", async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request("https://infouzel-analytics.example/v1/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(INGEST_MAX_BODY_BYTES + 10),
          "user-agent": "Mozilla/5.0",
          "CF-Connecting-IP": "203.0.113.51",
        },
        body: "{}",
      }),
      env
    );
    expect(res.status).toBe(413);
  });
});
