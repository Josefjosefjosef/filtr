import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const adsRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(adsRoot, "migrations");
const cjArchiveMigrationsDir = join(adsRoot, "migrations-cj-affiliate-archive");

function applySqlMigrations(db: DatabaseSync, dir: string): void {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/i.test(f))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    db.exec(sql);
  }
}

/** Premium ads schema + optional CJ affiliate archive tables when migration dir is present. */
export function createIuAdsSchemaDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  applySqlMigrations(db, migrationsDir);
  applySqlMigrations(db, cjArchiveMigrationsDir);
  return db;
}
