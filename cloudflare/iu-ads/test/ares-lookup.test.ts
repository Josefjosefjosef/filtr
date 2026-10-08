import { describe, expect, it } from "vitest";
import { mapAresSubject } from "../src/ares-lookup";

describe("ares lookup mapping", () => {
  it("maps standard subject fields", () => {
    const mapped = mapAresSubject(
      {
        obchodniJmeno: "Test s.r.o.",
        dic: "CZ27074358",
        sidlo: {
          nazevUlice: "Ulice",
          cisloDomovni: 1,
          cisloOrientacni: 2,
          nazevObce: "Praha",
          psc: 11000,
        },
      },
      "27074358"
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.company_name).toBe("Test s.r.o.");
    expect(mapped!.billing_street).toContain("Ulice");
    expect(mapped!.billing_city).toBe("Praha");
    expect(mapped!.billing_zip).toBe("110 00");
    expect(mapped!.dic).toBe("CZ27074358");
    expect(mapped!.customer_registry.registry_kind).toBe("none");
  });

  it("returns null without address parts", () => {
    expect(mapAresSubject({ obchodniJmeno: "X" }, "27074358")).toBeNull();
  });
});
