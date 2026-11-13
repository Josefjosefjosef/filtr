/**
 * Behavioral security regression: anonymous /probe must not dispatch.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import worker, { CATCHUP_DISPATCH_INPUTS, type Env } from "./index.ts";

const SECRET = "test-manual-trigger-secret";
const FRESHNESS_URL = "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";
const STALE_GENERATED_AT = "2020-01-01T00:00:00.000Z";

const env: Env = {
  GITHUB_TOKEN: "ghp_test_token",
  GITHUB_REPOSITORY: "Josefjosefjosef/filtr",
  WORKFLOW_FILE: "cj-affiliate-catalog-sync.yml",
  FRESHNESS_URL,
  STALE_AFTER_MINUTES: "240",
  MAX_CATCHUPS_PER_UTC_DAY: "6",
  CATCHUP_COOLDOWN_MINUTES: "60",
  MANUAL_TRIGGER_SECRET: SECRET,
};

type Call = { method: string; url: string; body?: string };

function isDispatchUrl(url: string): boolean {
  return /\/actions\/workflows\/[^/]+\/dispatches$/.test(url);
}

function makeMockFetch(tracker: { calls: Call[] }) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = String(
      init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET",
    ).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    tracker.calls.push({ method, url, body });

    if (url === FRESHNESS_URL || url.startsWith(FRESHNESS_URL)) {
      return new Response(JSON.stringify({ generatedAt: STALE_GENERATED_AT, liveEnabled: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (/\/actions\/workflows\/[^/]+\/runs/.test(url)) {
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              status: "completed",
              conclusion: "success",
              created_at: STALE_GENERATED_AT,
              event: "schedule",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (isDispatchUrl(url) && method === "POST") {
      return new Response(null, { status: 204 });
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

describe("cj catalog watchdog probe security", () => {
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

  it("GET /health ok", async () => {
    const res = await worker.fetch(new Request("https://example/health"), env);
    assert.equal(res.status, 200);
    const j = (await res.json()) as {
      ok: boolean;
      anonymousProbeObserveOnly?: boolean;
      scheduledMutationsEnabled?: boolean;
    };
    assert.equal(j.ok, true);
    assert.equal(j.anonymousProbeObserveOnly, true);
    assert.equal(j.scheduledMutationsEnabled, true);
  });

  it("anonymous /probe is observe-only (no dispatch)", async () => {
    const res = await worker.fetch(new Request("https://example/probe"), env);
    assert.equal(res.status, 200);
    assert.equal(dispatchCount(), 0);
    const j = (await res.json()) as { observeOnly: boolean; decision: { action: string } };
    assert.equal(j.observeOnly, true);
    assert.equal(j.decision.action, "dispatch");
  });

  it("authorized /probe?dispatch=1 dispatches catch-up inputs", async () => {
    const res = await worker.fetch(
      new Request("https://example/probe?dispatch=1", {
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(dispatchCount(), 1);
    const body = tracker.calls.find((c) => isDispatchUrl(c.url))?.body || "";
    const parsed = JSON.parse(body) as { inputs: Record<string, string> };
    assert.equal(parsed.inputs.catchup_dispatch, CATCHUP_DISPATCH_INPUTS.catchup_dispatch);
    assert.equal(parsed.inputs.promote_offers_public, "1");
    assert.equal(parsed.inputs.execute_live_fetch, "1");
  });

  it("unauthorized /probe?dispatch=1 is 401", async () => {
    const res = await worker.fetch(new Request("https://example/probe?dispatch=1"), env);
    assert.equal(res.status, 401);
    assert.equal(dispatchCount(), 0);
  });

  it("authorized /probe?act=1 dispatches when decide says stale", async () => {
    const res = await worker.fetch(
      new Request("https://example/probe?act=1", {
        headers: { Authorization: `Bearer ${SECRET}` },
      }),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(dispatchCount(), 1);
  });
});
