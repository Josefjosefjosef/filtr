import { describe, expect, it } from "vitest";
import { ADMIN_UI_SCRIPT } from "../src/admin-ui-script";

describe("admin invoices registry UI contract", () => {
  it("opens PDF via signed URL helper instead of raw /access JSON", () => {
    expect(ADMIN_UI_SCRIPT).toContain("openAdminDocumentAccess");
    expect(ADMIN_UI_SCRIPT).toContain("triggerPdfDownload");
    expect(ADMIN_UI_SCRIPT).not.toMatch(/data-inv-preview.*window\.open\(b\.getAttribute\("data-inv-preview"\)/);
  });

  it("includes invoice registry search controls", () => {
    expect(ADMIN_UI_SCRIPT).toContain("inv-search-go");
    expect(ADMIN_UI_SCRIPT).toContain("inv-doc-kind");
    expect(ADMIN_UI_SCRIPT).toContain("inv-payment");
  });

  it("surfaces storno validation hint and inline field errors", () => {
    expect(ADMIN_UI_SCRIPT).toContain("acct-reason-hint");
    expect(ADMIN_UI_SCRIPT).toContain("acct-reason-err");
    expect(ADMIN_UI_SCRIPT).toContain("Důvod storna musí mít alespoň 12 znaků");
  });

  it("wires registry suggest panels for invoices and confirmations", () => {
    expect(ADMIN_UI_SCRIPT).toContain("wireRegistrySuggest");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/invoices/registry/suggest");
    expect(ADMIN_UI_SCRIPT).toContain("/v1/admin/order-confirmations/registry/suggest");
  });
});
