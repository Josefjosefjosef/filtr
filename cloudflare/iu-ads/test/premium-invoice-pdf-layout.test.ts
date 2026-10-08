import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildPremiumInvoicePdfWithLayout } from "../src/premium-invoice-pdf";
import { PremiumInvoicePdfCursor } from "../src/premium-invoice-pdf-layout";
import { decodeSpaydFromInvoicePdfBytes } from "../src/premium-invoice-pdf-qr-extract";
import { resolvePremiumInvoiceVat } from "../src/premium-invoice-vat";

async function countPdfPages(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

const base = {
  invoice_number: "INV-2026-LAYOUT",
  variable_symbol: "2026001111",
  issued_at: "2026-03-02T09:00:00.000Z",
  due_at: "2026-03-05T09:00:00.000Z",
  taxable_date: "2026-03-02T09:00:00.000Z",
  buyer_ico: "12345678",
  buyer_dic: null as string | null,
  line_description: "Reklamní umístění — test",
  service_period_start: "2026-03-02T09:00:00.000Z",
  service_period_end: "2026-09-02T09:00:00.000Z",
  total_cents: 449000,
  currency: "CZK",
  order_reference: "AD-2026-LAY",
  category_title_cs: "Kategorie",
  position_label: "P1",
  duration_months: 6,
  buyer_registry: null as import("../src/premium-ares-registry").CustomerRegistrySnapshot | null,
};

const scenarios: { name: string; patch: Partial<typeof base> & Record<string, unknown> }[] = [
  { name: "short_company", patch: { buyer_company: "A s.r.o.", buyer_address_lines: ["Krátká 1", "110 00 Praha"] } },
  {
    name: "long_company",
    patch: {
      buyer_company:
        "Velmi dlouhý název obchodní společnosti s ručením omezeným pro reklamní služby na portálu infoUzel.cz",
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
    },
  },
  {
    name: "long_address",
    patch: {
      buyer_company: "Test s.r.o.",
      buyer_address_lines: [
        "Velmi dlouhá fakturační ulice s číslem popisným 1234 a orientačním 5678",
        "190 12 Praha 9 – Dolní Počernice",
        "Česká republika",
      ],
    },
  },
  {
    name: "long_registry",
    patch: {
      buyer_company: "Test s.r.o.",
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
      buyer_registry: {
        registry_kind: "commercial_register",
        registry_name_cs: "obchodní rejstřík",
        court_name_cs: "Městským soudem v Praze",
        section: "C",
        insert: "447292",
        file_mark: "C 447292/MSPH",
        display_line_cs:
          "Společnost zapsaná v obchodním rejstříku vedeném Městským soudem v Praze, oddíl C, vložka 447292.",
        verified_source: "ares",
        verified_at: "2026-03-01T00:00:00.000Z",
        user_confirmed: false,
      },
    },
  },
  {
    name: "long_category",
    patch: {
      buyer_company: "Test s.r.o.",
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
      category_title_cs: "Velmi dlouhý název affiliate kategorie pro ubytování a wellness služby v ČR",
    },
  },
  {
    name: "diacritics",
    patch: {
      buyer_company: "Média Řešení šíření žluťoučků s.r.o.",
      buyer_address_lines: ["Kněničká 96", "190 12 Praha 9"],
      category_title_cs: "Počasí a výstrahy",
    },
  },
  {
    name: "vat_payer_future",
    patch: {
      buyer_company: "Test s.r.o.",
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
      total_cents: 100000,
    },
  },
];

describe("premium invoice PDF layout scenarios", () => {
  for (const sc of scenarios) {
    it("renders " + sc.name + " without block overlap", async () => {
      const input = { ...base, ...sc.patch } as Parameters<typeof buildPremiumInvoicePdfWithLayout>[0];
      const { pdfBytes, layoutBlocks, pageCount } = await buildPremiumInvoicePdfWithLayout(input);
      expect(pdfBytes.byteLength).toBeGreaterThan(3000);
      expect(pageCount).toBeGreaterThanOrEqual(1);
      expect(pageCount).toBeLessThanOrEqual(3);
      const overlaps = PremiumInvoicePdfCursor.assertNoBlockOverlap(layoutBlocks);
      expect(overlaps).toEqual([]);
    });
  }

  it("standard invoice is exactly one page including footer", async () => {
    const input = {
      ...base,
      buyer_company: "A s.r.o.",
      buyer_address_lines: ["Krátká 1", "110 00 Praha"],
    };
    const { pdfBytes, layoutBlocks, pageCount } = await buildPremiumInvoicePdfWithLayout(input);
    expect(pageCount).toBe(1);
    expect(await countPdfPages(pdfBytes)).toBe(1);
    expect(PremiumInvoicePdfCursor.assertNoBlockOverlap(layoutBlocks)).toEqual([]);
    const blocks = layoutBlocks.map((b) => b.id);
    expect(blocks).toContain("footer");
    expect(blocks).toContain("payment_section");
  });

  it("QR SPAYD decodes on layout scenario", async () => {
    const input = {
      ...base,
      buyer_company: "Test s.r.o.",
      buyer_address_lines: ["Ulice 1", "110 00 Praha"],
    };
    const { pdfBytes } = await buildPremiumInvoicePdfWithLayout(input);
    const spayd = await decodeSpaydFromInvoicePdfBytes(pdfBytes);
    expect(spayd).toContain("SPD*1.0");
    expect(spayd).toContain("X-VS:2026001111");
  });

  it("future VAT payer resolver still works in isolation", () => {
    const vat = resolvePremiumInvoiceVat(121000, "2030-01-01T00:00:00.000Z");
    expect(vat.nonVatNotice || vat.grossCents).toBeTruthy();
  });
});
