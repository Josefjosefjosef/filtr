import { describe, expect, it } from "vitest";
import {
  extractCustomerRegistryFromAresBody,
  formatCommercialRegisterDisplayLine,
  parseOrSpisovaZnacka,
} from "../src/premium-ares-registry";
import { mapAresSubject } from "../src/ares-lookup";

describe("premium ares registry", () => {
  it("parses OR spisová značka", () => {
    expect(parseOrSpisovaZnacka("C 447292/MSPH")).toEqual({
      section: "C",
      insert: "447292",
      courtCode: "MSPH",
    });
  });

  it("formats commercial register display line", () => {
    const line = formatCommercialRegisterDisplayLine({
      courtNameCs: "Městským soudem v Praze",
      section: "C",
      insert: "447292",
    });
    expect(line).toContain("oddíl C");
    expect(line).toContain("vložka 447292");
  });

  it("extracts registry from ARES vr record", () => {
    const snap = extractCustomerRegistryFromAresBody(
      { dalsiUdaje: [{ datovyZdroj: "vr", spisovaZnacka: "C 447292/MSPH" }] },
      "2026-03-01T00:00:00.000Z"
    );
    expect(snap.registry_kind).toBe("commercial_register");
    expect(snap.display_line_cs).toContain("Městským soudem v Praze");
  });

  it("returns none for OSVČ without vr", () => {
    const mapped = mapAresSubject(
      {
        obchodniJmeno: "Jan Novák",
        sidlo: { nazevUlice: "Ulice", cisloDomovni: 1, nazevObce: "Praha", psc: 11000 },
      },
      "12345678"
    );
    expect(mapped!.customer_registry.registry_kind).toBe("none");
  });
});
