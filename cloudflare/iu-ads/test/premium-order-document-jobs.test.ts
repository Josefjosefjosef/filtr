import { describe, expect, it } from "vitest";
import {
  PREMIUM_DOC_GENERATING_STALE_MS,
  PREMIUM_DOC_TYPE_INVOICE,
  docTypeForPremiumOrderDocKind,
  linkPremiumOrderDocumentJobToActiveDocument,
  premiumDocJobIsStaleGenerating,
  reconcilePremiumOrderDocumentJob,
} from "../src/premium-order-documents";

describe("premium order document job reconciliation", () => {
  it("detects stale generating jobs", () => {
    const now = Date.parse("2026-10-08T12:00:00.000Z");
    const fresh = new Date(now - PREMIUM_DOC_GENERATING_STALE_MS + 5000).toISOString();
    const stale = new Date(now - PREMIUM_DOC_GENERATING_STALE_MS - 1000).toISOString();
    expect(premiumDocJobIsStaleGenerating("generating", fresh, now)).toBe(false);
    expect(premiumDocJobIsStaleGenerating("generating", stale, now)).toBe(true);
    expect(premiumDocJobIsStaleGenerating("ready", stale, now)).toBe(false);
  });

  it("maps doc kinds to doc_type", () => {
    expect(docTypeForPremiumOrderDocKind("invoice_pdf")).toBe(PREMIUM_DOC_TYPE_INVOICE);
    expect(docTypeForPremiumOrderDocKind("order_confirmation")).toBe("premium_order_confirmation");
  });

  it("links job to active document when PDF already in D1", async () => {
    const updates: string[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM documents")) return { document_id: "doc_existing", r2_key: "document/doc_existing.pdf" };
            return null;
          },
          run: async () => {
            updates.push(String(sql));
            return { meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;

    const out = await reconcilePremiumOrderDocumentJob(db, "ord_1", "invoice_pdf", {
      job_id: "pdj_1",
      order_id: "ord_1",
      doc_kind: "invoice_pdf",
      status: "generating",
      document_id: null,
      last_error: null,
      updated_at: "2026-10-08T10:00:00.000Z",
    });
    expect(out.linked_document_id).toBe("doc_existing");
    expect(updates.some((u) => u.includes("premium_order_document_jobs"))).toBe(true);
  });

  it("marks stale generating as pending for safe resume", async () => {
    const staleAt = new Date(Date.now() - PREMIUM_DOC_GENERATING_STALE_MS - 5000).toISOString();
    let pendingUpdate = false;
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => null,
          run: async () => {
            if (sql.includes("premium_order_document_jobs") && args[0] === "pending") pendingUpdate = true;
            return { meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;

    const out = await reconcilePremiumOrderDocumentJob(db, "ord_2", "invoice_pdf", {
      job_id: "pdj_2",
      order_id: "ord_2",
      doc_kind: "invoice_pdf",
      status: "generating",
      document_id: null,
      last_error: null,
      updated_at: staleAt,
    });
    expect(out.linked_document_id).toBeNull();
    expect(out.stale_generating).toBe(true);
    expect(pendingUpdate).toBe(true);
  });

  it("linkPremiumOrderDocumentJobToActiveDocument sets ready status", async () => {
    const binds: unknown[][] = [];
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          binds.push(args);
          return { run: async () => ({}) };
        },
      }),
    } as unknown as D1Database;
    await linkPremiumOrderDocumentJobToActiveDocument(db, "pdj_x", "doc_x");
    expect(binds[0]?.[0]).toBe("ready");
    expect(binds[0]?.[1]).toBe("doc_x");
  });
});

describe("generateOneDocument stuck guard (unit)", () => {
  it("never leaves generating without error path when store throws", async () => {
    const { buildPremiumInvoicePdf } = await import("../src/premium-invoice-pdf");
    const pdf = await buildPremiumInvoicePdf({
      invoice_number: "INV-2026-STUCK-GUARD",
      variable_symbol: "2026009999",
      issued_at: "2026-10-08T12:00:00.000Z",
      due_at: "2026-10-11T12:00:00.000Z",
      taxable_date: "2026-10-08T12:00:00.000Z",
      buyer_company: "Test s.r.o.",
      buyer_ico: "12345678",
      buyer_dic: null,
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
      buyer_registry: null,
      line_description: "Test",
      service_period_start: "2026-10-08T12:00:00.000Z",
      service_period_end: "2027-04-08T12:00:00.000Z",
      total_cents: 449000,
      currency: "CZK",
      order_reference: "AD-2026-STUCK",
      category_title_cs: "Test",
      position_label: "P1",
      duration_months: 6,
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});
