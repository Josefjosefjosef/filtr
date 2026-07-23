import { describe, expect, it } from "vitest";
import { verifyObjectAccess } from "../src/signed-access";
import {
  DOCUMENT_VISIBILITY_VALUES,
  buildSignedDocumentAccess,
  filterDocumentForVisibility,
  isDocumentVisibility,
  MAX_SIGNED_URL_TTL_SECONDS,
} from "../src/visibility";

describe("document visibility values", () => {
  it("accepts only the three documented visibility levels", () => {
    expect(DOCUMENT_VISIBILITY_VALUES).toEqual(["internal_only", "client_visible", "public"]);
    expect(isDocumentVisibility("internal_only")).toBe(true);
    expect(isDocumentVisibility("client_visible")).toBe(true);
    expect(isDocumentVisibility("public")).toBe(true);
    expect(isDocumentVisibility("secret")).toBe(false);
    expect(isDocumentVisibility(123)).toBe(false);
  });
});

describe("filterDocumentForVisibility (kap. 39 field visibility)", () => {
  const row = {
    document_id: "doc_1",
    doc_type: "contract",
    title: "Smlouva",
    version: 1,
    visibility: "internal_only",
    created_at: "2026-01-01T00:00:00Z",
  };

  it("hides internal_only documents from client/public scope", () => {
    expect(filterDocumentForVisibility(row, "client_visible")).toBeNull();
    expect(filterDocumentForVisibility(row, "public")).toBeNull();
  });

  it("shows internal_only documents to admin scope (rank 0 minimum)", () => {
    expect(filterDocumentForVisibility(row, "internal_only")).not.toBeNull();
  });

  it("client_visible documents are visible to client scope but not required to be public", () => {
    const clientRow = { ...row, visibility: "client_visible" };
    expect(filterDocumentForVisibility(clientRow, "client_visible")).not.toBeNull();
    expect(filterDocumentForVisibility(clientRow, "public")).toBeNull();
  });

  it("public documents are visible everywhere", () => {
    const publicRow = { ...row, visibility: "public" };
    expect(filterDocumentForVisibility(publicRow, "internal_only")).not.toBeNull();
    expect(filterDocumentForVisibility(publicRow, "client_visible")).not.toBeNull();
    expect(filterDocumentForVisibility(publicRow, "public")).not.toBeNull();
  });

  it("treats an invalid stored visibility as internal_only (fail closed)", () => {
    const badRow = { ...row, visibility: "not_a_real_value" };
    const result = filterDocumentForVisibility(badRow, "internal_only");
    expect(result).not.toBeNull();
    expect(result?.visibility).toBe("internal_only");
    expect(filterDocumentForVisibility(badRow, "client_visible")).toBeNull();
  });
});

describe("buildSignedDocumentAccess never issues a permanent public R2 URL", () => {
  const secret = "test-signing-secret-not-for-prod";

  it("returns a short-lived signed Worker path, not a raw R2/public URL", async () => {
    const access = await buildSignedDocumentAccess(secret, "document/doc_1/v1.pdf", 300);
    expect(access.path.startsWith("/v1/objects/get?")).toBe(true);
    expect(access.path).toContain("bucket=DOCUMENTS");
    expect(access.path).not.toContain("r2.cloudflarestorage.com");
    expect(new Date(access.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("produced signature verifies via verifyObjectAccess", async () => {
    const objectKey = "document/doc_2/v1.pdf";
    const access = await buildSignedDocumentAccess(secret, objectKey, 120);
    const url = new URL("https://worker.test" + access.path);
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") || "";
    const verified = await verifyObjectAccess(secret, { objectKey, bucket: "DOCUMENTS", exp, sig });
    expect(verified.ok).toBe(true);
  });

  it("clamps TTL to MAX_SIGNED_URL_TTL_SECONDS even if a much larger value is requested", async () => {
    const objectKey = "document/doc_3/v1.pdf";
    const access = await buildSignedDocumentAccess(secret, objectKey, 999_999);
    const url = new URL("https://worker.test" + access.path);
    const exp = Number(url.searchParams.get("exp"));
    const nowSec = Math.floor(Date.now() / 1000);
    expect(exp - nowSec).toBeLessThanOrEqual(MAX_SIGNED_URL_TTL_SECONDS + 2);
  });
});
