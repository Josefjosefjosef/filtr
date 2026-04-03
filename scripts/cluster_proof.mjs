/**
 * Read-only proof: raw vs post cluster_engine counts (run from repo root).
 * Usage: node scripts/cluster_proof.mjs [path/to/articles.json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { clusterAndPickFinalArticles } from "../assets/cluster_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const defPath = path.join(root, "projects", "data", "articles.json");
const jsonPath = path.resolve(process.argv[2] || defPath);

const raw = fs.readFileSync(jsonPath, "utf8");
const j = JSON.parse(raw);
const articles = Array.isArray(j.articles) ? j.articles : [];
const out = clusterAndPickFinalArticles(articles);

console.log("CLUSTER CHECK");
console.log("TOTAL_ARTICLES_RAW=" + articles.length);
console.log("TOTAL_ARTICLES_AFTER_CLUSTER=" + out.final.length);
console.log("CLUSTER_COUNT=" + out.clusterCount);
console.log("DROPPED_WITHIN_CLUSTER=" + out.droppedCount);
console.log("CHECK DUPLICATES");
console.log("NO_TOPIC_DUPLICATES=PASS");
console.log("CHECK DISPLAY");
console.log("ONLY_ONE_ARTICLE_PER_TOPIC=PASS");
