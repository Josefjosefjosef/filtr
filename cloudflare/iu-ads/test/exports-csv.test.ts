import { describe, expect, it } from "vitest";
import { csvEscape } from "../src/admin-exports";

describe("export CSV safety", () => {
  it("escapes formula-like cells and quotes", () => {
    expect(csvEscape("ok")).toBe("ok");
    expect(csvEscape("=CMD()")).toBe('"=CMD()"');
    expect(csvEscape("+1+1")).toBe('"+1+1"');
    expect(csvEscape("-1+1")).toBe('"-1+1"');
    expect(csvEscape("@sum")).toBe('"@sum"');
    expect(csvEscape("\tCMD()")).toBe('"\tCMD()"');
    expect(csvEscape("\rCMD()")).toBe('"\rCMD()"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a,b")).toBe('"a,b"');
  });
});
