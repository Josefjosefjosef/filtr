import { describe, expect, it } from "vitest";
import worker from "./index";

function req(path: string, init?: RequestInit) {
  return new Request("https://infouzel.cz" + path, init);
}

describe("iu-site-redirects", () => {
  it("301 /projects/ → / preserving query", async () => {
    const res = await worker.fetch(req("/projects/?view=saved"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://infouzel.cz/?view=saved");
  });

  it("301 /projects/statistiky/ → /statistiky/", async () => {
    const res = await worker.fetch(req("/projects/statistiky/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://infouzel.cz/statistiky/");
  });

  it("301 icons and manifest to root", async () => {
    const icon = await worker.fetch(req("/projects/icons/icon-192.png"));
    expect(icon.status).toBe(301);
    expect(icon.headers.get("Location")).toBe("https://infouzel.cz/icons/icon-192.png");
    const man = await worker.fetch(req("/projects/manifest.json"));
    expect(man.status).toBe(301);
    expect(man.headers.get("Location")).toBe("https://infouzel.cz/manifest.json");
  });

  it("passthrough data and version (no redirect)", async () => {
    // fetch() to origin is stubbed in vitest environment — we only assert no Location
    // by mocking global fetch for this case.
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      return new Response("ok", { status: 200, headers: { "x-passthrough": u } });
    };
    try {
      const data = await worker.fetch(req("/projects/data/publishable_pool.json"));
      expect(data.status).toBe(200);
      expect(data.headers.get("Location")).toBeNull();
      const ver = await worker.fetch(req("/projects/version.json"));
      expect(ver.status).toBe(200);
      expect(ver.headers.get("Location")).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
