/** Extract offers.generatedAt without parsing the full multi-MB public JSON. */
const GENERATED_AT_RE = /"generatedAt"\s*:\s*"([^"]+)"/;

export function extractGeneratedAtFromPrefix(text: string): string | null {
  const m = text.match(GENERATED_AT_RE);
  if (!m || !m[1]) return null;
  return normalizeGeneratedAtIso(m[1]);
}

export function normalizeGeneratedAtIso(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? trimmed : null;
}

export async function readGeneratedAtFromResponse(
  res: Response,
  maxBytes = 65536,
): Promise<string | null> {
  if (!res.ok) return null;
  const body = res.body;
  if (!body) return null;
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
