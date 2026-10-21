import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractGeneratedAtFromPrefix,
  productionCountsFromMonitoring,
  readGeneratedAtFromResponse,
} from "./freshness.ts";

describe("freshness lightweight parse", () => {
  it("extracts generatedAt from JSON prefix", () => {
    const prefix = '{"version":"2","generatedAt":"2026-10-16T14:26:06.271Z","items":[';
    assert.equal(extractGeneratedAtFromPrefix(prefix), "2026-10-16T14:26:06.271Z");
  });

  it("reads generatedAt from streaming response and stops early", async () => {
    const payload =
      '{"generatedAt":"2020-01-01T00:00:00.000Z","items":[' + "x".repeat(200_000) + "]}";
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 4096)));
        controller.enqueue(new TextEncoder().encode(payload.slice(4096)));
        controller.close();
      },
    });
    const res = new Response(stream, { status: 200 });
    const at = await readGeneratedAtFromResponse(res, 8192);
    assert.equal(at, "2020-01-01T00:00:00.000Z");
  });

  it("maps monitoring.chmiCapV2 counts", () => {
    const counts = productionCountsFromMonitoring({
      chmiCapV2: { totalItems: 3, activeCount: 2, scheduledCount: 1 },
    });
    assert.deepEqual(counts, { chmiCount: 3, activeCount: 2, futureCount: 1 });
  });
});
