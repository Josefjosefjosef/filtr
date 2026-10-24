import { describe, expect, it } from "vitest";
import {
  CJ_MANAGED_PUBLIC_PATH,
  CJ_MANAGED_PUBLIC_PUBLISH_PATH,
  CJ_PUBLIC_SCHEMA,
  R2_CJ_CURRENT_KEY,
  R2_CJ_LKG_KEY,
  handleCjManagedPublicPublish,
  serveCjManagedPublic,
  validateCjManagedPublicDoc,
  WEBSITE_PID,
  type CjManagedPublicEnv,
} from "./cj-managed-public";

class MemoryR2Object {
  constructor(public bodyText: string, public size: number) {}
  async text() {
    return this.bodyText;
  }
  get body() {
    return this.bodyText;
  }
}

class MemoryR2 implements R2Bucket {
  store = new Map<string, string>();
  async get(key: string) {
    const v = this.store.get(key);
    if (v == null) return null;
    return new MemoryR2Object(v, v.length) as unknown as R2ObjectBody;
  }
  async put(key: string, value: string | ArrayBuffer | ReadableStream | Blob | null) {
    const text = typeof value === "string" ? value : String(value);
    this.store.set(key, text);
    return { size: text.length } as R2Object;
  }
  async head() {
    return null;
  }
  async delete() {}
  async list() {
    return { objects: [], truncated: false, delimitedPrefixes: [] };
  }
  createMultipartUpload(): never {
    throw new Error("not implemented");
  }
  resumeMultipartUpload(): never {
    throw new Error("not implemented");
  }
}

function sampleDoc(partners: Array<Record<string, unknown>>) {
  return {
    schema: CJ_PUBLIC_SCHEMA,
    websitePid: WEBSITE_PID,
    generatedAt: "2026-10-23T00:00:00.000Z",
    partners,
  };
}

describe("validateCjManagedPublicDoc", () => {
  it("accepts valid active CJ partner", () => {
    const v = validateCjManagedPublicDoc(
      sampleDoc([
        {
          advertiserId: "111",
          title: "Test",
          sectionId: "aff-zdravi-doplnky",
          url: "https://www.dpbolvw.net/click-101883843-1",
          active: true,
        },
      ])
    );
    expect(v.ok).toBe(true);
    expect(v.activeCount).toBe(1);
  });

  it("accepts CJ .com tracking hosts used in production overlay (kqzyfj/jdoqocy/tkqlhce)", () => {
    const v = validateCjManagedPublicDoc(
      sampleDoc([
        {
          advertiserId: "6785595",
          title: "Tui.cz",
          sectionId: "aff-cestovni-kancelare",
          url: "https://www.kqzyfj.com/click-101883843-15704921",
          active: true,
        },
        {
          advertiserId: "6767085",
          title: "Ergo",
          sectionId: "aff-cestovni-kancelare",
          url: "https://www.jdoqocy.com/click-101883843-17269644",
          active: true,
        },
        {
          advertiserId: "5006846",
          title: "Daka",
          sectionId: "aff-cestovni-kancelare",
          url: "https://www.tkqlhce.com/click-101883843-13148950",
          active: true,
        },
      ])
    );
    expect(v.ok).toBe(true);
    expect(v.activeCount).toBe(3);
    expect(v.errors).toEqual([]);
  });

  it("rejects non-CJ active URL", () => {
    const v = validateCjManagedPublicDoc(
      sampleDoc([
        {
          advertiserId: "111",
          title: "Bad",
          sectionId: "aff-zdravi-doplnky",
          url: "https://example.com/x",
          active: true,
        },
      ])
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.startsWith("active_url_not_cj"))).toBe(true);
  });

  it("rejects duplicate advertiserId", () => {
    const v = validateCjManagedPublicDoc(
      sampleDoc([
        {
          advertiserId: "111",
          title: "A",
          sectionId: "aff-zdravi-doplnky",
          url: "https://www.dpbolvw.net/click-101883843-1",
          active: true,
        },
        {
          advertiserId: "111",
          title: "B",
          sectionId: "aff-zdravi-doplnky",
          url: "https://www.dpbolvw.net/click-101883843-2",
          active: true,
        },
      ])
    );
    expect(v.ok).toBe(false);
  });
});

describe("CJ managed-public R2 publish/serve", () => {
  it("publishes atomically and serves current without git", async () => {
    const bucket = new MemoryR2();
    const env: CjManagedPublicEnv = {
      CJ_MANAGED_PUBLIC: bucket as unknown as R2Bucket,
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "true",
      CJ_MANAGED_PUBLIC_PUBLISH_TOKEN: "test-token",
    };
    const doc = sampleDoc([
      {
        advertiserId: "5706839",
        title: "Amix",
        sectionId: "aff-zdravi-doplnky",
        url: "https://www.dpbolvw.net/click-101883843-15000001",
        active: true,
      },
    ]);
    const pubReq = new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PUBLISH_PATH, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        meta: { generationId: "g1", contentSha256: "sha-a", publishedAt: "2026-10-23T12:00:00.000Z" },
        document: doc,
      }),
    });
    const pubRes = await handleCjManagedPublicPublish(env, pubReq);
    expect(pubRes.status).toBe(200);
    const pubJson = (await pubRes.json()) as { ok: boolean; NO_GIT_MERGE_REQUIRED?: string };
    expect(pubJson.ok).toBe(true);
    expect(pubJson.NO_GIT_MERGE_REQUIRED).toBe("YES");
    expect(bucket.store.has(R2_CJ_CURRENT_KEY)).toBe(true);

    const getRes = await serveCjManagedPublic(
      env,
      new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PATH)
    );
    expect(getRes).not.toBeNull();
    const served = (await getRes!.json()) as { partners: Array<{ advertiserId: string }> };
    expect(served.partners[0].advertiserId).toBe("5706839");
  });

  it("rejects unauthorized publish", async () => {
    const bucket = new MemoryR2();
    const env: CjManagedPublicEnv = {
      CJ_MANAGED_PUBLIC: bucket as unknown as R2Bucket,
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "true",
      CJ_MANAGED_PUBLIC_PUBLISH_TOKEN: "test-token",
    };
    const res = await handleCjManagedPublicPublish(
      env,
      new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PUBLISH_PATH, {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ document: sampleDoc([]) }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("keeps LKG of previous current on overwrite", async () => {
    const bucket = new MemoryR2();
    const env: CjManagedPublicEnv = {
      CJ_MANAGED_PUBLIC: bucket as unknown as R2Bucket,
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "true",
      CJ_MANAGED_PUBLIC_PUBLISH_TOKEN: "test-token",
    };
    const doc1 = sampleDoc([
      {
        advertiserId: "1",
        title: "One",
        sectionId: "aff-zdravi-doplnky",
        url: "https://www.dpbolvw.net/click-101883843-1",
        active: true,
      },
    ]);
    const doc2 = sampleDoc([
      {
        advertiserId: "2",
        title: "Two",
        sectionId: "aff-zdravi-doplnky",
        url: "https://www.dpbolvw.net/click-101883843-2",
        active: true,
      },
    ]);
    await handleCjManagedPublicPublish(
      env,
      new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PUBLISH_PATH, {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ meta: { contentSha256: "1" }, document: doc1 }),
      })
    );
    await handleCjManagedPublicPublish(
      env,
      new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PUBLISH_PATH, {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ meta: { contentSha256: "2" }, document: doc2 }),
      })
    );
    const lkg = JSON.parse(bucket.store.get(R2_CJ_LKG_KEY) || "{}");
    expect(lkg.partners[0].advertiserId).toBe("1");
    const cur = JSON.parse(bucket.store.get(R2_CJ_CURRENT_KEY) || "{}");
    expect(cur.partners[0].advertiserId).toBe("2");
  });

  it("returns null serve when live disabled (Pages fallback)", async () => {
    const bucket = new MemoryR2();
    bucket.store.set(R2_CJ_CURRENT_KEY, JSON.stringify(sampleDoc([])));
    const env: CjManagedPublicEnv = {
      CJ_MANAGED_PUBLIC: bucket as unknown as R2Bucket,
      CJ_MANAGED_PUBLIC_LIVE_ENABLED: "false",
      CJ_MANAGED_PUBLIC_PUBLISH_TOKEN: "test-token",
    };
    const res = await serveCjManagedPublic(
      env,
      new Request("https://infouzel.cz" + CJ_MANAGED_PUBLIC_PATH)
    );
    expect(res).toBeNull();
  });
});
