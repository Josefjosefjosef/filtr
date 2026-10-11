import type { DatabaseSync } from "node:sqlite";

/** Minimal D1Database adapter over node:sqlite for migration-faithful integration tests. */
export function d1FromSqlite(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
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
              db.prepare(sql).run(...params);
              return { success: true, meta: {} };
            },
          };
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
