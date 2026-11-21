/**
 * Durable CJ growth approval nonce store.
 * Production: Cloudflare D1 Worker HTTP API (atomic INSERT UNIQUE).
 * Tests: node:sqlite file with same SQL semantics (not for GITHUB_ACTIONS production).
 * Never falls back to RUNNER_TEMP when production mode is required.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const GROWTH_NONCE_SCOPE = "EXECUTE_GROWTH_ACTIVATION";
export const NONCE_STORE_SCHEMA = "iu-cj-growth-approval-nonce-store-v51-8";

export function hashNonce(nonce) {
  return crypto.createHash("sha256").update(String(nonce || ""), "utf8").digest("hex");
}

export function buildReservationKey(parts = {}) {
  const material = [
    String(parts.nonce || "").trim(),
    String(parts.repository || "Josefjosefjosef/filtr").trim(),
    String(parts.mainSha || "").trim().toLowerCase(),
    String(parts.generationId || "").trim(),
    GROWTH_NONCE_SCOPE,
  ].join("|");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

function ensureSqliteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cj_growth_approval_nonces (
      reservation_key TEXT PRIMARY KEY,
      nonce_hash TEXT NOT NULL,
      repository TEXT NOT NULL,
      main_sha TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      actor TEXT,
      state TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      armed_at TEXT,
      completed_at TEXT,
      failed_at TEXT,
      fail_reason TEXT,
      run_id TEXT,
      meta_json TEXT
    );
  `);
}

export function createSqliteNonceStore(opts = {}) {
  const dbPath = String(opts.dbPath || "").trim();
  if (!dbPath) throw new Error("sqlite_nonce_store_requires_dbPath");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSqliteSchema(db);

  return {
    kind: "sqlite",
    durable: true,
    dbPath,
    async reserve(input) {
      const reservationKey = String(input.reservationKey || "").trim();
      const nonceHash = String(input.nonceHash || "").trim();
      const now = String(input.nowIso || new Date().toISOString());
      if (Date.parse(input.expiresAt) < Date.parse(now)) {
        return { ok: false, reason: "OWNER_APPROVAL_EXPIRED" };
      }
      try {
        const stmt = db.prepare(`
          INSERT INTO cj_growth_approval_nonces (
            reservation_key, nonce_hash, repository, main_sha, generation_id, scope, actor,
            state, issued_at, expires_at, reserved_at, run_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?, ?)
        `);
        stmt.run(
          reservationKey,
          nonceHash,
          String(input.repository || ""),
          String(input.mainSha || "").toLowerCase(),
          String(input.generationId || ""),
          GROWTH_NONCE_SCOPE,
          input.actor != null ? String(input.actor) : null,
          String(input.issuedAt || ""),
          String(input.expiresAt || ""),
          now,
          input.runId != null ? String(input.runId) : null,
        );
        return { ok: true, reason: "NONCE_RESERVED", state: "RESERVED", reservationKey, reservedAt: now };
      } catch (err) {
        const msg = String(err?.message || err || "");
        if (/UNIQUE|constraint/i.test(msg)) {
          return { ok: false, reason: "OWNER_APPROVAL_REPLAY" };
        }
        return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
      }
    },
    async transition(input) {
      const reservationKey = String(input.reservationKey || "").trim();
      const next = String(input.state || "").trim().toUpperCase();
      const now = String(input.nowIso || new Date().toISOString());
      const row = db.prepare("SELECT state FROM cj_growth_approval_nonces WHERE reservation_key = ?").get(reservationKey);
      if (!row) return { ok: false, reason: "NONCE_NOT_FOUND" };
      if (next === "ARMED" || next === "COMPLETED") {
        const col = next === "ARMED" ? "armed_at" : "completed_at";
        db.prepare(`UPDATE cj_growth_approval_nonces SET state = ?, ${col} = ? WHERE reservation_key = ?`).run(
          next,
          now,
          reservationKey,
        );
      } else {
        db.prepare(
          `UPDATE cj_growth_approval_nonces SET state = ?, failed_at = ?, fail_reason = ? WHERE reservation_key = ?`,
        ).run(next, now, input.failReason != null ? String(input.failReason).slice(0, 200) : null, reservationKey);
      }
      return { ok: true, reason: "NONCE_STATE_UPDATED", state: next };
    },
    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export function createHttpNonceStore(opts = {}) {
  const baseUrl = String(opts.baseUrl || "").replace(/\/+$/, "");
  const token = String(opts.token || "").trim();
  if (!baseUrl || !token || token.length < 16) {
    throw new Error("http_nonce_store_requires_baseUrl_and_token");
  }
  return {
    kind: "http",
    durable: true,
    baseUrl,
    async reserve(input) {
      try {
        const res = await fetch(`${baseUrl}/v1/reserve`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            ok: false,
            reason: body?.reason || (res.status >= 500 ? "NONCE_STORE_UNAVAILABLE" : "OWNER_APPROVAL_REPLAY"),
          };
        }
        return body;
      } catch {
        return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
      }
    },
    async transition(input) {
      try {
        const res = await fetch(`${baseUrl}/v1/transition`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, reason: body?.reason || "NONCE_STORE_UNAVAILABLE" };
        }
        return body;
      } catch {
        return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
      }
    },
  };
}

/**
 * Resolve production-safe nonce store.
 * - GITHUB_ACTIONS / requireDurable: HTTP durable required (no temp/file fallback).
 * - Explicit sqlite path: only when allowInsecureLocal=true (selftests).
 */
export function resolveGrowthApprovalNonceStore(opts = {}) {
  const env = opts.env || process.env;
  const requireDurable =
    opts.requireDurable === true ||
    String(env.IU_CJ_GROWTH_NONCE_REQUIRE_DURABLE || "").trim() === "1" ||
    String(env.GITHUB_ACTIONS || "").toLowerCase() === "true";
  const allowInsecureLocal =
    opts.allowInsecureLocal === true || String(env.IU_CJ_GROWTH_NONCE_ALLOW_INSECURE_LOCAL || "").trim() === "1";

  const httpUrl = String(opts.baseUrl || env.IU_CJ_GROWTH_NONCE_STORE_URL || "").trim();
  const httpToken = String(opts.token || env.IU_CJ_GROWTH_NONCE_STORE_TOKEN || "").trim();
  if (httpUrl && httpToken) {
    return createHttpNonceStore({ baseUrl: httpUrl, token: httpToken });
  }

  const rawPath = String(opts.sqlitePath || env.IU_CJ_GROWTH_NONCE_SQLITE_PATH || "").trim();
  const legacyJsonPath = String(opts.legacyJsonPath || "").trim();
  const looksJson = /\.json$/i.test(rawPath) || /\.json$/i.test(legacyJsonPath);

  // Shared sqlite file: atomic UNIQUE across local processes (selftests / offline proof).
  // Not a substitute for production Cloudflare D1 Worker.
  if (rawPath && !looksJson && (allowInsecureLocal || !requireDurable)) {
    return createSqliteNonceStore({ dbPath: rawPath });
  }

  if (requireDurable) {
    return {
      kind: "unavailable",
      durable: false,
      async reserve() {
        return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
      },
      async transition() {
        return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
      },
    };
  }

  // Legacy local JSON only when NOT requireDurable and explicitly allowed (migration/unit path).
  if (allowInsecureLocal && (legacyJsonPath || (rawPath && looksJson))) {
    return createLegacyJsonNonceStore(legacyJsonPath || rawPath);
  }

  return {
    kind: "unavailable",
    durable: false,
    async reserve() {
      return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
    },
    async transition() {
      return { ok: false, reason: "NONCE_STORE_UNAVAILABLE" };
    },
  };
}

/** Legacy JSON store — tests of migration only; never production. */
export function createLegacyJsonNonceStore(storePath) {
  function load() {
    try {
      if (!fs.existsSync(storePath)) return { consumed: {} };
      return JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      return { consumed: {} };
    }
  }
  function save(doc) {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(doc, null, 2) + "\n");
  }
  return {
    kind: "legacy_json",
    durable: false,
    async reserve(input) {
      const key = String(input.reservationKey || input.nonceHash || "").trim();
      const doc = load();
      if (doc.consumed?.[key]) return { ok: false, reason: "OWNER_APPROVAL_REPLAY" };
      doc.consumed = doc.consumed || {};
      doc.consumed[key] = input.nowIso || new Date().toISOString();
      save(doc);
      return { ok: true, reason: "NONCE_RESERVED", state: "RESERVED", reservationKey: key };
    },
    async transition() {
      return { ok: true, reason: "NONCE_STATE_UPDATED" };
    },
  };
}
