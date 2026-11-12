import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractGeneratedAtFromPrefix, normalizeGeneratedAtIso } from "./freshness.ts";

describe("freshness", () => {
  it("extracts generatedAt from prefix", () => {
    const iso = extractGeneratedAtFromPrefix(
      '{"ok":true,"generatedAt":"2026-11-12T11:42:08.039Z","liveEnabled":true',
    );
    assert.equal(iso, "2026-11-12T11:42:08.039Z");
  });

  it("falls back to updatedAt when generatedAt missing", () => {
    const iso = extractGeneratedAtFromPrefix(
      '{"ok":true,"updatedAt":"2026-11-12T12:17:11.932Z","liveEnabled":true',
    );
    assert.equal(iso, "2026-11-12T12:17:11.932Z");
  });

  it("rejects invalid timestamps", () => {
    assert.equal(normalizeGeneratedAtIso("not-a-date"), null);
    assert.equal(normalizeGeneratedAtIso(""), null);
  });
});
