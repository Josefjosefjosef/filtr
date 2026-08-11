import { describe, expect, it } from "vitest";
import worker from "./index";

function req(path: string, init?: RequestInit) {
  return new Request("https://infouzel.cz" + path, init);
}

const SNAP =
  "/projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json";
const PUB =
  "/projects/data/info_events/ndic_datex_v1/__iu_live_publish";

function mockR2(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async get(key: string) {
      const v = store.get(key);
      if (v == null) return null;
      return {
        body: v,
        async text() {
          return v;
        },
      };
    },
    async put(key: string, value: string) {
      store.set(key, typeof value === "string" ? value : String(value));
    },
    _store: store,
  } as unknown as R2Bucket;
}

describe("iu-site-redirects", () => {
  it("301 /projects/ → / preserving query", async () => {
    const res = await worker.fetch(req("/projects/?view=saved"), {});
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://infouzel.cz/?view=saved");
  });

  it("301 /projects/statistiky/ → /statistiky/", async () => {
    const res = await worker.fetch(req("/projects/statistiky/"), {});
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://infouzel.cz/statistiky/");
  });

  it("301 icons and manifest to root", async () => {
    const icon = await worker.fetch(req("/projects/icons/icon-192.png"), {});
    expect(icon.status).toBe(301);
    expect(icon.headers.get("Location")).toBe("https://infouzel.cz/icons/icon-192.png");
    const man = await worker.fetch(req("/projects/manifest.json"), {});
    expect(man.status).toBe(301);
    expect(man.headers.get("Location")).toBe("https://infouzel.cz/manifest.json");
  });

  it("passthrough data and version (no redirect)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      return new Response("ok", { status: 200, headers: { "x-passthrough": u } });
    };
    try {
      const data = await worker.fetch(req("/projects/data/publishable_pool.json"), {});
      expect(data.status).toBe(200);
      expect(data.headers.get("Location")).toBeNull();
      const ver = await worker.fetch(req("/projects/version.json"), {});
      expect(ver.status).toBe(200);
      expect(ver.headers.get("Location")).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("serves live snapshot from R2 when enabled", async () => {
    const body = JSON.stringify({
      schema: "iu-traffic-offline-snapshot-v1",
      cardCount: 1,
      cards: [],
    });
    const env = {
      LIVE_TRAFFIC_ENABLED: "true",
      LIVE_PUBLISH_TOKEN: "tok",
      TRAFFIC_LIVE: mockR2({
        "current/traffic_offline_snapshot.json": body,
        "current/meta.json": JSON.stringify({ generationId: "gen_test" }),
      }),
    };
    const res = await worker.fetch(req(SNAP), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-iu-ndic-live-source")).toBe("r2");
    expect(res.headers.get("x-iu-ndic-generation-id")).toBe("gen_test");
    expect(await res.text()).toContain("iu-traffic-offline-snapshot-v1");
  });

  it("publish is atomic and rejects unauthorized", async () => {
    const r2 = mockR2();
    const env = {
      LIVE_TRAFFIC_ENABLED: "true",
      LIVE_PUBLISH_TOKEN: "secret",
      TRAFFIC_LIVE: r2,
    };
    const bad = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: "{}",
      }),
      env
    );
    expect(bad.status).toBe(401);

    const snap = {
      schema: "iu-traffic-offline-snapshot-v1",
      cardCount: 0,
      cards: [],
    };
    const meta = {
      generationId: "gen_1",
      sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
      checksum: "abc",
      publishedAt: "2026-08-11T12:00:01.000Z",
    };
    const ok = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({ meta, snapshot: snap }),
      }),
      env
    );
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.ok).toBe(true);
    expect(j.ATOMIC_PUBLICATION_PASS).toBe("YES");
  });

  it("rejects stale writer publish", async () => {
    const r2 = mockR2({
      "current/meta.json": JSON.stringify({
        generationId: "gen_old",
        sourceLastModified: "Tue, 11 Aug 2026 13:00:00 GMT",
        checksum: "x",
      }),
    });
    const env = { LIVE_TRAFFIC_ENABLED: "true", LIVE_PUBLISH_TOKEN: "secret", TRAFFIC_LIVE: r2 };
    const res = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: JSON.stringify({
          meta: {
            generationId: "gen_stale",
            sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
            checksum: "y",
          },
          snapshot: { schema: "iu-traffic-offline-snapshot-v1", cards: [] },
        }),
      }),
      env
    );
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.reason).toBe("STALE_WRITER_REJECTED");
  });
});
