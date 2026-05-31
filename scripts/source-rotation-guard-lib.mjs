/**
 * Shared helpers for source rotation guards (reads Python-generated inventory + registry).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, "..");

export const MAX_FETCHES_PER_HOUR = Number(process.env.MAX_SOURCE_FETCHES_PER_HOUR || "4");
export const MAX_FETCHES_EXCEPTION = Number(process.env.MAX_SOURCE_FETCHES_PER_HOUR_EXCEPTION || "5");

export function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function inventoryPath() {
  return (
    process.env.SOURCE_ROTATION_INVENTORY_PATH ||
    path.join(root, "projects", "data", "source_rotation_inventory.json")
  );
}

export function registryPath() {
  return process.env.SOURCE_REGISTRY_PATH || path.join(root, "projects", "data", "source_registry.json");
}

export function loadInventory() {
  const p = inventoryPath();
  if (!fs.existsSync(p)) {
    throw new Error(`missing inventory ${p} — run: py -3 scripts/source_rotation_inventory.py`);
  }
  return loadJson(p);
}

export function loadRegistry() {
  const p = registryPath();
  if (!fs.existsSync(p)) {
    throw new Error(`missing registry ${p}`);
  }
  return loadJson(p);
}

export function activeRegistryEntries(registry) {
  const out = [];
  for (const e of registry.entries || []) {
    if (!e || e.blocked || e.active === false) continue;
    const url = String(e.feed_url || "").trim();
    if (!url) continue;
    if (url.includes("hedvabnastezka")) continue;
    out.push(e);
  }
  return out;
}
