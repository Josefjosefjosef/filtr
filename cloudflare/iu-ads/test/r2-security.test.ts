import { describe, expect, it } from "vitest";
import { buildObjectKey, detectMagicMime, validateUploadObject } from "../src/r2-security";
import { signObjectAccess, verifyObjectAccess } from "../src/signed-access";

describe("r2 upload validation", () => {
  it("accepts png creative magic", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectMagicMime(png)).toBe("image/png");
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/png",
      filename: "banner.png",
      byteLength: png.length,
      content: png,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects javascript and html", () => {
    const js = new Uint8Array([0x61, 0x6c, 0x65, 0x72, 0x74]);
    expect(
      validateUploadObject({
        purpose: "creative",
        declaredMime: "application/javascript",
        filename: "x.js",
        byteLength: js.length,
        content: js,
      }).ok
    ).toBe(false);
    expect(
      validateUploadObject({
        purpose: "document",
        declaredMime: "text/html",
        filename: "x.html",
        byteLength: 10,
        content: new Uint8Array(10),
      }).ok
    ).toBe(false);
  });

  it("rejects oversized creatives", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = validateUploadObject({
      purpose: "creative",
      declaredMime: "image/png",
      filename: "big.png",
      byteLength: 6 * 1024 * 1024,
      content: png,
    });
    expect(r).toEqual({ ok: false, reason: "size_limit" });
  });

  it("builds opaque object keys", () => {
    expect(buildObjectKey({ kind: "document", id: "doc_1", version: 2, ext: "pdf" })).toBe(
      "document/doc_1/v2.pdf"
    );
  });
});

describe("signed private object access", () => {
  it("accepts valid short-lived signature and rejects expired", async () => {
    const secret = "test-signing-secret-not-for-prod";
    const exp = Math.floor(Date.now() / 1000) + 120;
    const sig = await signObjectAccess(secret, {
      objectKey: "document/doc_1/v1.pdf",
      bucket: "DOCUMENTS",
      exp,
    });
    const ok = await verifyObjectAccess(secret, {
      objectKey: "document/doc_1/v1.pdf",
      bucket: "DOCUMENTS",
      exp,
      sig,
    });
    expect(ok).toEqual({ ok: true });

    const expired = await verifyObjectAccess(
      secret,
      {
        objectKey: "document/doc_1/v1.pdf",
        bucket: "DOCUMENTS",
        exp: Math.floor(Date.now() / 1000) - 10,
        sig,
      },
      Math.floor(Date.now() / 1000)
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe("expired");
  });

  it("rejects tampered signature", async () => {
    const secret = "test-signing-secret-not-for-prod";
    const exp = Math.floor(Date.now() / 1000) + 120;
    const sig = await signObjectAccess(secret, {
      objectKey: "document/doc_1/v1.pdf",
      bucket: "DOCUMENTS",
      exp,
    });
    const bad = await verifyObjectAccess(secret, {
      objectKey: "document/doc_OTHER/v1.pdf",
      bucket: "DOCUMENTS",
      exp,
      sig,
    });
    expect(bad.ok).toBe(false);
  });

  it("rejects path traversal and absolute keys (bad_key)", async () => {
    const secret = "test-signing-secret-not-for-prod";
    const exp = Math.floor(Date.now() / 1000) + 120;
    for (const objectKey of ["../etc/passwd", "/document/doc_1/v1.pdf", "document/../../secret.pdf"]) {
      const sig = await signObjectAccess(secret, { objectKey, bucket: "DOCUMENTS", exp });
      const res = await verifyObjectAccess(secret, { objectKey, bucket: "DOCUMENTS", exp, sig });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("bad_key");
    }
  });
});
