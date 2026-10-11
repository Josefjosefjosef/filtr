import { describe, expect, it, vi } from "vitest";
import { handleAdminPremiumOrderDocumentAccess } from "../src/premium-order-documents";
import type { Env } from "../src/types";

vi.mock("../src/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin-auth")>();
  return {
    ...actual,
    requireAdminPermission: vi.fn(async () => ({ ok: true as const, userId: "admin_1" })),
  };
});

vi.mock("../src/visibility", () => ({
  buildSignedDocumentAccess: vi.fn(async (_secret: string, key: string) => ({
    path: "https://signed.test/" + encodeURIComponent(key),
    expiresAt: "2099-01-01T00:00:00.000Z",
  })),
}));

describe("premium order confirmation revision access", () => {
  it("serves archived revision bytes by version query param", async () => {
    const db = {
      prepare: (sql: string) => {
        const state = { params: [] as unknown[] };
        const api = {
          bind: (...params: unknown[]) => {
            state.params = params;
            return api;
          },
          first: async () => {
            if (sql.includes("FROM documents WHERE order_id = ? AND doc_type = ?")) {
              return { document_id: "doc_1", r2_key: "orders/ord_1/confirmation-v3.pdf" };
            }
            if (sql.includes("FROM documents WHERE document_id = ? AND status = 'active'")) {
              return {
                document_id: "doc_1",
                version: 3,
                r2_key: "orders/ord_1/confirmation-v3.pdf",
                title: "Potvrzení objednávky",
                content_hash: "hash3",
              };
            }
            if (sql.includes("document_content_revisions") && sql.includes("version = ?")) {
              expect(state.params[1]).toBe(2);
              return { r2_key: "archive/ord_1/confirmation-v2.pdf" };
            }
            if (sql.includes("system_settings")) {
              return { value: "3600" };
            }
            return null;
          },
          run: async () => ({}),
        };
        return api;
      },
    } as unknown as D1Database;

    const env = {
      DB: db,
      ADS_R2_SIGNING_SECRET: "test-secret",
    } as Env;

    const res = await handleAdminPremiumOrderDocumentAccess(
      new Request(
        "https://ads.test/v1/admin/premium/orders/ord_1/documents/order_confirmation/access?disposition=inline&version=2"
      ),
      env,
      "ord_1",
      "order_confirmation"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; version: number; title: string };
    expect(body.version).toBe(2);
    expect(body.path).toContain("archive%2Ford_1%2Fconfirmation-v2.pdf");
    expect(body.title).toContain("verze 2");
  });
});
