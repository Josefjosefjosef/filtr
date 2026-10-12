import type { DatabaseSync } from "node:sqlite";

/** Minimal D1Database adapter over node:sqlite for migration-faithful integration tests. */
export function d1FromSqlite(db: DatabaseSync): D1Database {
  function runner(sql: string, params: unknown[]) {
    return {
      async first<T>() {
        const stmt = db.prepare(sql);
        const row = stmt.get(...params);
        return (row ?? null) as T | null;
      },
      async all<T>() {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params) as T[];
        return { results: rows };
      },
      async run() {
        const info = db.prepare(sql).run(...params);
        const changes = typeof info.changes === "number" ? info.changes : 0;
        return { success: true, meta: { changes } };
      },
    };
  }

  return {
    prepare(sql: string) {
      const bound = (...params: unknown[]) => runner(sql, params);
      return {
        bind: bound,
        first: <T>() => bound().first<T>(),
        all: <T>() => bound().all<T>(),
        run: () => bound().run(),
      };
    },
    batch: async () => {
      throw new Error("batch not implemented in test shim");
    },
    exec: async () => {
      throw new Error("exec not implemented in test shim");
    },
  } as D1Database;
}
