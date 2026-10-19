/**
 * Node.js SQLite shim implementing Cloudflare D1 prepare/bind/run/first/all (offline SQL tests only).
 */
import fs from "node:fs";
import path from "node:path";

export async function createNodeSqliteD1Shim(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch (e) {
    return { ok: false, reason: "node_sqlite_unavailable", error: String(e?.message || e) };
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const native = new DatabaseSync(dbPath);

  function wrapStmt(sql) {
    return {
      bind(...params) {
        return {
          async run() {
            const stmt = native.prepare(sql);
            const info = stmt.run(...params);
            return { meta: { changes: info.changes ?? 0, last_row_id: info.lastInsertRowid ?? 0 } };
          },
          async first() {
            const stmt = native.prepare(sql);
            return stmt.get(...params) ?? null;
          },
          async all() {
            const stmt = native.prepare(sql);
            return { results: stmt.all(...params) };
          },
        };
      },
      async run() {
        const stmt = native.prepare(sql);
        const info = stmt.run();
        return { meta: { changes: info.changes ?? 0 } };
      },
    };
  }

  const db = {
    prepare(sql) {
      return wrapStmt(sql);
    },
    async batch(stmts) {
      native.exec("BEGIN IMMEDIATE");
      const results = [];
      try {
        for (const s of stmts) {
          results.push(await s.run());
        }
        native.exec("COMMIT");
        return results;
      } catch (e) {
        try {
          native.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
    close() {
      native.close();
    },
    async execTransaction(fn) {
      native.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn();
        native.exec("COMMIT");
        return out;
      } catch (e) {
        try {
          native.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    },
    dbPath,
  };

  return { ok: true, db };
}
