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
        size: v.length,
        async text() {
          return v;
        },
      };
    },
    async put(key: string, value: unknown) {
      let s: string;
      if (typeof value === "string") {
        s = value;
      } else if (value instanceof ReadableStream) {
        s = await new Response(value).text();
      } else if (value instanceof ArrayBuffer) {
        s = new TextDecoder().decode(value);
      } else if (value instanceof Uint8Array) {
        s = new TextDecoder().decode(value);
      } else {
        s = String(value);
      }
      store.set(key, s);
      return { size: s.length, key };
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

  it("promotes meta CSP to HTTP header on / HTML documents", async () => {
    const orig = globalThis.fetch;
    const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https:; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; trusted-types iu-default iu-escape; require-trusted-types-for 'script';">
<script>early()</script>
</head><body>ok</body></html>`;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    try {
      const res = await worker.fetch(req("/"), {});
      expect(res.status).toBe(200);
      const csp = res.headers.get("Content-Security-Policy") || "";
      expect(csp).toContain("default-src 'self' https:");
      expect(csp).toContain("require-trusted-types-for 'script'");
      expect(csp).toContain("frame-ancestors 'self'");
      expect(res.headers.get("x-iu-csp-edge")).toBe("meta-promoted-v1");
      expect(res.headers.get("Permissions-Policy") || "").toContain("geolocation=(self)");
      expect(res.headers.get("Permissions-Policy") || "").toContain("camera=()");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("applies secondary CSP on /offline.html", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<!doctype html><html><body>offline</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    try {
      const res = await worker.fetch(req("/offline.html"), {});
      expect(res.status).toBe(200);
      expect(res.headers.get("x-iu-csp-edge")).toBe("secondary-v1");
      expect(res.headers.get("Content-Security-Policy") || "").toContain("script-src 'sha256-");
      expect(res.headers.get("Content-Security-Policy") || "").toContain("frame-ancestors 'none'");
      expect(res.headers.get("Permissions-Policy") || "").toContain("geolocation=(self)");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("applies secondary CSP on /bot/", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<!doctype html><html><body>bot</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    try {
      const res = await worker.fetch(req("/bot/"), {});
      expect(res.status).toBe(200);
      expect(res.headers.get("x-iu-csp-edge")).toBe("secondary-v1");
      expect(res.headers.get("Content-Security-Policy") || "").toContain("script-src 'self'");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("HEAD / also returns promoted CSP (scanner-compatible)", async () => {
    const orig = globalThis.fetch;
    const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'; trusted-types iu-default; require-trusted-types-for 'script';">`;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    try {
      const res = await worker.fetch(req("/", { method: "HEAD" }), {});
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Security-Policy") || "").toContain("frame-ancestors 'self'");
      expect(res.headers.get("Permissions-Policy") || "").toContain("geolocation=(self)");
      expect(await res.text()).toBe("");
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

  it("publish accepts snapshot-raw-v1 wire without envelope parse", async () => {
    const r2 = mockR2();
    const env = {
      LIVE_TRAFFIC_ENABLED: "true",
      LIVE_PUBLISH_TOKEN: "secret",
      TRAFFIC_LIVE: r2,
    };
    const snap = {
      schema: "iu-traffic-offline-snapshot-v1",
      cardCount: 0,
      cards: [],
    };
    const meta = {
      generationId: "gen_raw",
      sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
      checksum: "abc",
      semanticChecksum: "sem_raw",
      publishedAt: "2026-08-11T12:00:01.000Z",
    };
    const ok = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json; charset=utf-8",
          "x-iu-ndic-publish-wire": "snapshot-raw-v1",
          "x-iu-ndic-meta": JSON.stringify(meta),
          "x-iu-ndic-checksum": "abc",
          "x-iu-ndic-semantic-checksum": "sem_raw",
          "x-iu-ndic-snapshot-schema": "iu-traffic-offline-snapshot-v1",
        },
        body: JSON.stringify(snap),
      }),
      env
    );
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.ok).toBe(true);
    expect(j.publishWire).toBe("snapshot-raw-v1");
    expect(r2._store.get("current/traffic_offline_snapshot.json")).toContain("iu-traffic-offline-snapshot-v1");
  });

  it("publish accepts gzip snapshot-raw-v1 body", async () => {
    const r2 = mockR2();
    const env = {
      LIVE_TRAFFIC_ENABLED: "true",
      LIVE_PUBLISH_TOKEN: "secret",
      TRAFFIC_LIVE: r2,
    };
    const snap = {
      schema: "iu-traffic-offline-snapshot-v1",
      cardCount: 1,
      cards: [{ id: "c1" }],
    };
    const meta = {
      generationId: "gen_gz",
      sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
      checksum: "gz",
      semanticChecksum: "sem_gz",
      publishedAt: "2026-08-11T12:00:01.000Z",
    };
    const raw = new TextEncoder().encode(JSON.stringify(snap));
    const gz = await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))
    ).arrayBuffer();
    const ok = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json; charset=utf-8",
          "content-encoding": "gzip",
          "x-iu-ndic-publish-wire": "snapshot-raw-v1",
          "x-iu-ndic-meta": JSON.stringify(meta),
          "x-iu-ndic-snapshot-schema": "iu-traffic-offline-snapshot-v1",
        },
        body: gz,
      }),
      env
    );
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.ok).toBe(true);
    expect(j.contentEncoding).toBe("gzip");
    expect(r2._store.get("current/traffic_offline_snapshot.json")).toContain('"id":"c1"');
  });

  it("skips publish when semantic checksum matches current", async () => {
    const r2 = mockR2({
      "current/meta.json": JSON.stringify({
        generationId: "gen_cur",
        sourceLastModified: "Tue, 11 Aug 2026 12:00:00 GMT",
        checksum: "body1",
        semanticChecksum: "sem_same",
      }),
      "current/traffic_offline_snapshot.json": JSON.stringify({
        schema: "iu-traffic-offline-snapshot-v1",
        cards: [],
      }),
    });
    const env = { LIVE_TRAFFIC_ENABLED: "true", LIVE_PUBLISH_TOKEN: "secret", TRAFFIC_LIVE: r2 };
    const res = await worker.fetch(
      req(PUB, {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
          "x-iu-ndic-semantic-checksum": "sem_same",
        },
        body: JSON.stringify({
          meta: {
            generationId: "gen_new",
            sourceLastModified: "Tue, 11 Aug 2026 12:05:00 GMT",
            checksum: "body2",
            semanticChecksum: "sem_same",
          },
          snapshot: { schema: "iu-traffic-offline-snapshot-v1", cards: [{ id: "x" }] },
        }),
      }),
      env
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.UNCHANGED_CONTENT_PUBLICATION_SKIPPED).toBe("YES");
    expect(j.generationId).toBe("gen_cur");
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
