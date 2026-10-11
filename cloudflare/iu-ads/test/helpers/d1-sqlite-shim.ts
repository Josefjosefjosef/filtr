import type { DatabaseSync } from "node:sqlite";

/** Minimal D1Database adapter over node:sqlite for migration-faithful integration tests. */
export function d1FromSqlite(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      function bound(params: unknown[]) {
        return {
          async first<T>() {
            const stmt = db.prepare(sql);
            const row = params.length ? stmt.get(...params) : stmt.get();
            return (row ?? null) as T | null;
          },
          async all<T>() {
            const stmt = db.prepare(sql);
            const rows = (params.length ? stmt.all(...params) : stmt.all()) as T[];
            return { results: rows };
          },
          async run() {
            if (params.length) db.prepare(sql).run(...params);
            else db.prepare(sql).run();
            return { success: true, meta: {} };
          },
        };
      }
      return {
        bind(...params: unknown[]) {
          return bound(params);
        },
        async first<T>() {
          return bound([]).first<T>();
        },
        async all<T>() {
          return bound([]).all<T>();
        },
        async run() {
          return bound([]).run();
        },
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
