/**
 * Behavioral security regression for CHMI watchdog HTTP vs scheduled paths.
 * Mocks global fetch — counts mutating GitHub Actions calls.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import worker, { type Env } from "./index.ts";

const SECRET = "test-manual-trigger-secret";
const FRESHNESS_URL = "https://infouzel.cz/projects/data/info_events/feed.json";
const STALE_GENERATED_AT = "2020-01-01T00:00:00.000Z";

const env: Env = {
  GITHUB_TOKEN: "ghp_test_token",
  GITHUB_REPOSITORY: "Josefjosefjosef/filtr",
  WORKFLOW_FILE: "update-chmi-cap-v2.yml",
  FRESHNESS_URL,
  STALE_AFTER_MINUTES: "8",
  MANUAL_TRIGGER_SECRET: SECRET,
};

type Call = { method: string; url: string };

function isDispatchUrl(url: string): boolean {
  return /\/actions\/workflows\/[^/]+\/dispatches$/.test(url);
}

function isCancelUrl(url: string): boolean {
  return /\/actions\/runs\/\d+\/cancel$/.test(url);
}

function makeMockFetch(tracker: { calls: Call[] }) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = String(init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();
    tracker.calls.push({ method, url });

    if (url === FRESHNESS_URL || url.startsWith(FRESHNESS_URL)) {
      return new Response(
        JSON.stringify({
          generatedAt: STALE_GENERATED_AT,
          items: [{ sourceId: "chmi", status: "aktivni" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (/\/actions\/workflows\/[^/]+\/runs/.test(url)) {
      // Empty runs → busy=false (stale + non-busy).
      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (isDispatchUrl(url) && method === "POST") {
      return new Response(null, { status: 204 });
    }

    if (isCancelUrl(url) && method === "POST") {
      return new Response(null, { status: 202 });
    }

    if (/\/actions\/workflows\/[^/?]+$/.test(url)) {
      return new Response(JSON.stringify({ state: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("unexpected mock url: " + url, { status: 500 });
  };
}

describe("chmi watchdog probe security (stale + non-busy)", () => {
  const tracker = { calls: [] as Call[] };
  let originalFetch: typeof fetch;

  beforeEach(() => {
    tracker.calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = makeMockFetch(tracker) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function dispatchCount(): number {
    return tracker.calls.filter((c) => c.method === "POST" && isDispatchUrl(c.url)).length;
  }

  function cancelCount(): number {
    return tracker.calls.filter((c) => c.method === "POST" && isCancelUrl(c.url)).length;
  }

  it("GET /health is read-only", async () => {
    const res = await worker.fetch(new Request("https://worker.example/health"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(dispatchCount(), 0);
    assert.equal(cancelCount(), 0);
    assert.equal(tracker.calls.length, 0);
  });

  it("anonymous GET /probe is observe-only even when stale + non-busy", async () => {
    const res = await worker.fetch(new Request("https://worker.example/probe"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.observeOnly, true);
    assert.equal(body.decision.action, "dispatch");
    assert.equal(body.decision.reason, "stale");
    assert.equal(body.dispatch, null);
    assert.equal(dispatchCount(), 0, "anonymous /probe must not workflow_dispatch");
    assert.equal(cancelCount(), 0, "anonymous /probe must not cancel runs");
  });

  it("GET /probe?dispatch=1 without Authorization returns 401 and NO DISPATCH", async () => {
    const res = await worker.fetch(new Request("https://worker.example/probe?dispatch=1"), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "unauthorized");
    assert.equal(dispatchCount(), 0);
    assert.equal(cancelCount(), 0);
  });

  it("GET /probe?dispatch=1 with valid Bearer performs force dispatch", async () => {
    const res = await worker.fetch(
      new Request("https://worker.example/probe?dispatch=1", {
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
      env,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.observeOnly, false);
    assert.equal(body.decision.action, "dispatch");
    assert.equal(body.dispatch && body.dispatch.ok, true);
    assert.equal(dispatchCount(), 1);
  });

  it("scheduled() stale recovery still dispatches", async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil(p: Promise<unknown>) {
        pending.push(p);
      },
      passThroughOnException() {},
    } as ExecutionContext;

    await worker.scheduled({ cron: "*/5 * * * *", scheduledTime: Date.now(), type: "scheduled" } as ScheduledEvent, env, ctx);
    await Promise.all(pending);
    assert.equal(dispatchCount(), 1, "scheduled stale + idle must dispatch");
  });
});
