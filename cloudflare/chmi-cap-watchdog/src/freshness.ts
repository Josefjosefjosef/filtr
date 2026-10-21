/** Extract feed.generatedAt without parsing the full multi-MB feed.json (Workers CPU budget). */
const GENERATED_AT_RE = /"generatedAt"\s*:\s*"([^"]+)"/;

export function extractGeneratedAtFromPrefix(text: string): string | null {
  const m = text.match(GENERATED_AT_RE);
  return m && m[1] ? m[1] : null;
}

/** Read until generatedAt is found or maxBytes consumed; cancels the body when possible. */
export async function readGeneratedAtFromResponse(
  res: Response,
  maxBytes = 65536,
): Promise<string | null> {
  if (!res.ok) return null;
  const body = res.body;
  if (!body) {
    const text = await res.text();
    return extractGeneratedAtFromPrefix(text.slice(0, maxBytes));
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      acc += decoder.decode(value, { stream: true });
      const hit = extractGeneratedAtFromPrefix(acc);
      if (hit) {
        await reader.cancel().catch(() => {});
        return hit;
      }
    }
    acc += decoder.decode();
    return extractGeneratedAtFromPrefix(acc);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released / cancelled */
    }
  }
}

export type ProductionCounts = {
  chmiCount: number | null;
  activeCount: number | null;
  futureCount: number | null;
};

export function productionCountsFromMonitoring(json: unknown): ProductionCounts {
  const root = json as { chmiCapV2?: Record<string, unknown> };
  const cap = root.chmiCapV2;
  if (!cap || typeof cap !== "object") {
    return { chmiCount: null, activeCount: null, futureCount: null };
  }
  const num = (k: string): number | null => {
    const v = cap[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const totalItems = num("totalItems");
  const activeCount = num("activeCount");
  const futureCount = num("scheduledCount");
  return {
    chmiCount: totalItems,
    activeCount,
    futureCount,
  };
}
