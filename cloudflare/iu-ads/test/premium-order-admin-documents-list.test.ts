import { describe, expect, it } from "vitest";
import {
  PREMIUM_DOC_TYPE_INVOICE,
  PREMIUM_DOC_TYPE_ORDER,
  ensurePremiumOrderDocumentJobReflectsActiveDocument,
  listPremiumOrderDocumentsForAdmin,
} from "../src/premium-order-documents";
import type { Env } from "../src/types";

function mockDbForAdminList(input: {
  jobs: Array<{
    job_id: string;
    doc_kind: string;
    status: string;
    document_id: string | null;
    last_error: string | null;
    updated_at: string;
  }>;
  documents: Array<{ order_id: string; doc_type: string; document_id: string }>;
}) {
  const jobRows = [...input.jobs];
  const docRows = [...input.documents];
  const inserts: string[] = [];
  const updates: string[] = [];

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes("FROM premium_order_document_jobs") && sql.includes("job_id")) {
            return { results: jobRows.filter((j) => j.order_id === args[0] || args[0] === "ord_list") };
          }
          if (sql.includes("FROM premium_order_document_jobs") && sql.includes("doc_kind, status")) {
            return {
              results: jobRows
                .filter((j) => j.order_id === args[0] || args[0] === "ord_list")
                .map((j) => ({
                  doc_kind: j.doc_kind,
                  status: j.status,
                  document_id: j.document_id,
                  last_error: j.last_error,
                })),
            };
          }
          return { results: [] };
        },
        first: async () => {
          if (sql.includes("FROM documents")) {
            const orderId = String(args[0]);
            const docType = String(args[1]);
            const hit = docRows.find((d) => d.order_id === orderId && d.doc_type === docType);
            return hit ? { document_id: hit.document_id, r2_key: "document/" + hit.document_id + ".pdf" } : null;
          }
          if (sql.includes("FROM premium_order_document_jobs") && sql.includes("job_id")) {
            const orderId = String(args[0]);
            const kind = String(args[1]);
            const hit = jobRows.find((j) => j.order_id === orderId && j.doc_kind === kind);
            return hit ? { job_id: hit.job_id } : null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes("UPDATE premium_order_document_jobs")) {
            updates.push(sql);
            const jobId = String(args[3]);
            const row = jobRows.find((j) => j.job_id === jobId);
            if (row) {
              row.status = String(args[0]);
              row.document_id = String(args[1]);
              row.last_error = null;
            }
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO premium_order_document_jobs")) {
            inserts.push(sql);
            jobRows.push({
              job_id: String(args[0]),
              order_id: String(args[1]),
              doc_kind: String(args[2]),
              status: String(args[3]),
              document_id: String(args[4]),
              last_error: null,
              updated_at: String(args[8]),
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      }),
    }),
  } as unknown as D1Database;

  for (const j of jobRows) {
    if (!("order_id" in j)) (j as { order_id: string }).order_id = "ord_list";
  }

  return { db, inserts, updates };
}

describe("listPremiumOrderDocumentsForAdmin", () => {
  it("shows ready + paths when D1 has PDF but job row is missing", async () => {
    const { db } = mockDbForAdminList({
      jobs: [],
      documents: [
        { order_id: "ord_list", doc_type: PREMIUM_DOC_TYPE_ORDER, document_id: "doc_conf" },
        { order_id: "ord_list", doc_type: PREMIUM_DOC_TYPE_INVOICE, document_id: "doc_inv" },
      ],
    });
    const env = { DB: db, ADS_R2_SIGNING_SECRET: "test-signing" } as Env;
    const cards = await listPremiumOrderDocumentsForAdmin(env, new Request("https://x"), "ord_list");
    expect(cards).toHaveLength(4);
    const core = cards.filter((c) => c.kind === "order_confirmation" || c.kind === "invoice_pdf");
    expect(core.every((c) => c.status === "ready")).toBe(true);
    expect(core[0]?.preview_path).toContain("/access?disposition=inline");
    expect(core[1]?.download_path).toContain("/access?disposition=attachment");
  });

  it("shows ready when campaign PDF is linked to a different order_id (repair without regenerate)", async () => {
    let campaignLookup = false;
    const wrapped = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => {
            if (sql.includes("FROM documents") && sql.includes("order_id = ?") && !sql.includes("premium_selected_orders")) {
              return null;
            }
            if (sql.includes("premium_selected_orders") && sql.includes("published_campaign_id")) {
              campaignLookup = true;
              return { document_id: "doc_wrong_link", r2_key: "document/x.pdf", linked_order_id: "ord_other" };
            }
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;

    const env = { DB: wrapped, ADS_R2_SIGNING_SECRET: "secret" } as Env;
    const cards = await listPremiumOrderDocumentsForAdmin(env, new Request("https://x"), "ord_camp");
    expect(campaignLookup).toBe(true);
    expect(cards.find((c) => c.kind === "order_confirmation")?.status).toBe("ready");
  });

  it("shows ready when PDF is linked only via published campaign_id (missing order_id on document row)", async () => {
    let campaignLookup = false;
    const { db } = mockDbForAdminList({
      jobs: [],
      documents: [],
    });
    const wrapped = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => {
            if (sql.includes("FROM documents") && sql.includes("order_id = ?") && !sql.includes("premium_selected_orders")) {
              return null;
            }
            if (sql.includes("premium_selected_orders") && sql.includes("published_campaign_id")) {
              campaignLookup = true;
              return { document_id: "doc_camp", r2_key: "document/x.pdf", linked_order_id: null };
            }
            if (sql.includes("UPDATE documents SET order_id")) return null;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;

    const env = { DB: wrapped, ADS_R2_SIGNING_SECRET: "secret" } as Env;
    const cards = await listPremiumOrderDocumentsForAdmin(env, new Request("https://x"), "ord_camp");
    expect(campaignLookup).toBe(true);
    const conf = cards.find((c) => c.kind === "order_confirmation");
    expect(conf?.status).toBe("ready");
  });

  it("shows ready when job is stale but D1 document exists", async () => {
    const { db, updates } = mockDbForAdminList({
      jobs: [
        {
          job_id: "pdj_1",
          order_id: "ord_list",
          doc_kind: "invoice_pdf",
          status: "generating",
          document_id: null,
          last_error: null,
          updated_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      documents: [{ order_id: "ord_list", doc_type: PREMIUM_DOC_TYPE_INVOICE, document_id: "doc_inv" }],
    });
    const env = { DB: db, ADS_R2_SIGNING_SECRET: "secret" } as Env;
    const cards = await listPremiumOrderDocumentsForAdmin(env, new Request("https://x"), "ord_list");
    const inv = cards.find((c) => c.kind === "invoice_pdf");
    expect(inv?.status).toBe("ready");
    expect(inv?.document_id).toBe("doc_inv");
    expect(updates.length).toBeGreaterThan(0);
  });
});

describe("ensurePremiumOrderDocumentJobReflectsActiveDocument", () => {
  it("inserts ready job when none exists", async () => {
    const { db, inserts } = mockDbForAdminList({ jobs: [], documents: [] });
    await ensurePremiumOrderDocumentJobReflectsActiveDocument(db, "ord_x", "order_confirmation", "doc_x", null);
    expect(inserts.some((s) => s.includes("INSERT INTO premium_order_document_jobs"))).toBe(true);
  });
});
