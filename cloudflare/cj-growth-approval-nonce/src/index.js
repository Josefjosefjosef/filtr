/**
 * Durable atomic nonce reservation for CJ growth EXECUTE approvals.
 * Auth: Bearer IU_CJ_GROWTH_NONCE_STORE_TOKEN (never logged).
 */
const SCOPE = "EXECUTE_GROWTH_ACTIVATION";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function timingSafeEqualStr(a, b) {
  const ba = new TextEncoder().encode(String(a || ""));
  const bb = new TextEncoder().encode(String(b || ""));
  if (ba.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ba.length; i++) out |= ba[i] ^ bb[i];
  return out === 0;
}

function authOk(req, env) {
  const expected = String(env.IU_CJ_GROWTH_NONCE_STORE_TOKEN || "");
  if (!expected || expected.length < 16) return false;
  const h = String(req.headers.get("authorization") || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return timingSafeEqualStr(m[1].trim(), expected);
}

async function reserve(db, body) {
  const reservationKey = String(body.reservationKey || "").trim();
  const nonceHash = String(body.nonceHash || "").trim();
  const repository = String(body.repository || "").trim();
  const mainSha = String(body.mainSha || "").trim().toLowerCase();
  const generationId = String(body.generationId || "").trim();
  const scope = String(body.scope || SCOPE).trim();
  const actor = body.actor != null ? String(body.actor).trim() : null;
  const issuedAt = String(body.issuedAt || "").trim();
  const expiresAt = String(body.expiresAt || "").trim();
  const runId = body.runId != null ? String(body.runId).trim() : null;
  const now = String(body.nowIso || new Date().toISOString());

  if (!reservationKey || !nonceHash || !repository || !mainSha || !generationId || !issuedAt || !expiresAt) {
    return { ok: false, reason: "NONCE_RESERVE_INVALID_PAYLOAD", status: 400 };
  }
  if (scope !== SCOPE) return { ok: false, reason: "NONCE_RESERVE_SCOPE_MISMATCH", status: 400 };
  if (Date.parse(expiresAt) < Date.parse(now)) {
    return { ok: false, reason: "OWNER_APPROVAL_EXPIRED", status: 409 };
  }

  try {
    const ins = await db
      .prepare(
        `INSERT INTO cj_growth_approval_nonces (
          reservation_key, nonce_hash, repository, main_sha, generation_id, scope, actor,
          state, issued_at, expires_at, reserved_at, run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)`,
      )
      .bind(
        reservationKey,
        nonceHash,
        repository,
        mainSha,
        generationId,
        scope,
        actor,
        issuedAt,
        expiresAt,
        now,
        runId,
      )
      .run();
    if (ins?.success === false) {
      return { ok: false, reason: "NONCE_STORE_UNAVAILABLE", status: 503 };
    }
    return {
      ok: true,
      reason: "NONCE_RESERVED",
      state: "RESERVED",
      reservationKey,
      reservedAt: now,
    };
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/UNIQUE|constraint|already exists/i.test(msg)) {
      return { ok: false, reason: "OWNER_APPROVAL_REPLAY", status: 409 };
    }
    return { ok: false, reason: "NONCE_STORE_UNAVAILABLE", status: 503, detail: "insert_failed" };
  }
}

async function transition(db, body) {
  const reservationKey = String(body.reservationKey || "").trim();
  const next = String(body.state || "").trim().toUpperCase();
  const now = String(body.nowIso || new Date().toISOString());
  const failReason = body.failReason != null ? String(body.failReason).slice(0, 200) : null;
  if (!reservationKey) return { ok: false, reason: "NONCE_RESERVE_INVALID_PAYLOAD", status: 400 };
  const allowed = new Set(["ARMED", "COMPLETED", "FAILED", "STOPPED", "EXPIRED", "REVOKED"]);
  if (!allowed.has(next)) return { ok: false, reason: "NONCE_STATE_INVALID", status: 400 };

  const row = await db
    .prepare("SELECT state FROM cj_growth_approval_nonces WHERE reservation_key = ? LIMIT 1")
    .bind(reservationKey)
    .first();
  if (!row) return { ok: false, reason: "NONCE_NOT_FOUND", status: 404 };

  const cols =
    next === "ARMED"
      ? "state = ?, armed_at = ?"
      : next === "COMPLETED"
        ? "state = ?, completed_at = ?"
        : "state = ?, failed_at = ?, fail_reason = ?";

  if (next === "ARMED" || next === "COMPLETED") {
    await db
      .prepare(`UPDATE cj_growth_approval_nonces SET ${cols} WHERE reservation_key = ?`)
      .bind(next, now, reservationKey)
      .run();
  } else {
    await db
      .prepare(`UPDATE cj_growth_approval_nonces SET ${cols} WHERE reservation_key = ?`)
      .bind(next, now, failReason, reservationKey)
      .run();
  }
  return { ok: true, reason: "NONCE_STATE_UPDATED", state: next };
}

export default {
  async fetch(req, env) {
    try {
      if (req.method === "GET" && new URL(req.url).pathname === "/health") {
        return json(200, { ok: true, service: "cj-growth-approval-nonce" });
      }
      if (!authOk(req, env)) return json(401, { ok: false, reason: "UNAUTHORIZED" });
      if (!env.DB) return json(503, { ok: false, reason: "NONCE_STORE_UNAVAILABLE" });

      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/v1/reserve") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
          return json(400, { ok: false, reason: "NONCE_RESERVE_INVALID_PAYLOAD" });
        }
        const out = await reserve(env.DB, body);
        return json(out.status || (out.ok ? 200 : 409), out);
      }
      if (req.method === "POST" && url.pathname === "/v1/transition") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
          return json(400, { ok: false, reason: "NONCE_RESERVE_INVALID_PAYLOAD" });
        }
        const out = await transition(env.DB, body);
        return json(out.status || (out.ok ? 200 : 409), out);
      }
      return json(404, { ok: false, reason: "NOT_FOUND" });
    } catch {
      return json(503, { ok: false, reason: "NONCE_STORE_UNAVAILABLE" });
    }
  },
};
