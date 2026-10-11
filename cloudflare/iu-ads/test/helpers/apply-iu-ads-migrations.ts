import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

export function createIuAdsSchemaDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/i.test(f))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec(sql);
  }
  return db;
}
