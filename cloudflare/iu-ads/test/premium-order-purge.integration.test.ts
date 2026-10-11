import { describe, expect, it } from "vitest";
import { premiumOrderEligibleForSystemPurge, purgePremiumOrderPhysically } from "../src/premium-order-purge";
import type { Env } from "../src/types";

type Row = Record<string, unknown>;

class PurgeIntegrationDb {
  documents: Row[] = [];
  revisions: Row[] = [];
  invoices: Row[] = [];
  orders = new Map<string, Row>();
  premiumOrders = new Map<string, Row>();
  clients = new Map<string, Row>();
  contacts: Row[] = [];

  r2 = new Map<string, Uint8Array>();

  prepare(sql: string) {
    const self = this;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>() {
            return self.query(sql, params, "first") as T | null;
          },
          async all<T>() {
            return { results: (self.query(sql, params, "all") as T[]) || [] };
          },
          async run() {
            self.query(sql, params, "run");
            return { success: true };
          },
        };
      },
    };
  }

  query(sqlRaw: string, params: unknown[], mode: "first" | "all" | "run"): unknown {
    const sql = sqlRaw.replace(/\s+/g, " ").trim();
    const orderId = String(params[0] ?? "");

    if (sql.includes("JOIN clients c ON") && sql.includes("WHERE po.order_id = ?")) {
      const po = this.premiumOrders.get(orderId);
      const ord = this.orders.get(orderId);
      if (!po || !ord) return null;
      const client = this.clients.get(String(ord.client_id));
      const contact = this.contacts.find((c) => c.client_id === ord.client_id && c.is_primary === 1);
      return {
        target_url: po.target_url,
        payload_json: ord.payload_json,
        company_name: client?.company_name,
        contact_email: contact?.email,
      };
    }

    if (sql.includes("FROM documents WHERE order_id = ?")) {
      const docs = this.documents.filter((d) => d.order_id === orderId);
      return mode === "all" ? docs : docs[0] || null;
    }

    if (sql.includes("DELETE FROM document_content_revisions WHERE document_id = ?")) {
      const docId = String(params[0]);
      this.revisions = this.revisions.filter((r) => r.document_id !== docId);
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("FROM document_content_revisions WHERE document_id = ?")) {
      const docId = String(params[0]);
      const revs = this.revisions.filter((r) => r.document_id === docId);
      return mode === "all" ? revs : revs[0] || null;
    }

    if (sql.includes("DELETE FROM documents WHERE document_id = ?")) {
      const docId = String(params[0]);
      this.documents = this.documents.filter((d) => d.document_id !== docId);
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("FROM invoices WHERE order_id = ?")) {
      const invs = this.invoices.filter((i) => i.order_id === orderId);
      return mode === "all" ? invs : invs[0] || null;
    }

    if (sql.includes("DELETE FROM premium_order_document_jobs") || sql.includes("DELETE FROM premium_credit_notes")) {
      return mode === "run" ? { success: true } : null;
    }

    if (sql.includes("DELETE FROM invoices WHERE invoice_id = ?")) {
      this.invoices = this.invoices.filter((i) => i.invoice_id !== params[0]);
      return mode === "run" ? { success: true } : null;
    }

    if (sql.startsWith("DELETE FROM")) {
      return mode === "run" ? { success: true } : null;
    }

    if (mode === "all") return [];
    if (mode === "run") return { success: true };
    return null;
  }
}

describe("premium system purge integration", () => {
  it("allows purge only for dev/test markers", async () => {
    const db = new PurgeIntegrationDb();
    const orderId = "ord_test";
    db.orders.set(orderId, { order_id: orderId, client_id: "cli_t", payload_json: JSON.stringify({ iu_dev_test: true }) });
    db.premiumOrders.set(orderId, { order_id: orderId, target_url: "https://example.invalid/x" });
    db.clients.set("cli_t", { company_name: "IU_TEST s.r.o." });
    db.contacts.push({ client_id: "cli_t", email: "x@example.invalid", is_primary: 1 });

    const ok = await premiumOrderEligibleForSystemPurge(db as unknown as D1Database, orderId);
    expect(ok.ok).toBe(true);

    db.orders.get(orderId)!.payload_json = JSON.stringify({});
    db.premiumOrders.get(orderId)!.target_url = "https://real-customer.cz/";
    db.clients.get("cli_t")!.company_name = "Real Customer s.r.o.";
    db.contacts[0].email = "real@firma.cz";
    const blocked = await premiumOrderEligibleForSystemPurge(db as unknown as D1Database, orderId);
    expect(blocked.ok).toBe(false);
  });

  it("removes D1 document rows and R2 keys for order", async () => {
    const db = new PurgeIntegrationDb();
    const orderId = "ord_purge";
    db.documents.push({ document_id: "doc_1", order_id: orderId, r2_key: "pdf/a.pdf" });
    db.revisions.push({ document_id: "doc_1", r2_key: "pdf/rev/a.pdf" });
    db.invoices.push({ invoice_id: "inv_1", order_id: orderId });
    db.r2.set("pdf/a.pdf", new Uint8Array([1]));
    db.r2.set("pdf/rev/a.pdf", new Uint8Array([2]));

    const bucket = {
      delete: async (key: string) => {
        db.r2.delete(key);
      },
    };

    const env = { DB: db as unknown as D1Database, DOCUMENTS: bucket as R2Bucket } as Env;
    const result = await purgePremiumOrderPhysically(env, orderId);
    expect(result.documents_removed).toBe(1);
    expect(db.documents.length).toBe(0);
    expect(db.revisions.length).toBe(0);
    expect(db.invoices.length).toBe(0);
    expect(db.r2.size).toBe(0);
  });
});
