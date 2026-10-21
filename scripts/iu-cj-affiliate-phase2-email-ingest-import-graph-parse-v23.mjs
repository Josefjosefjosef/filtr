/** ECMAScript module import/export extraction via Acorn AST (v23). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "./vendor/acorn.mjs";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export function parseModuleImportsAst(source, modulePath = "<module>") {
  const staticImports = [];
  const dynamicImports = [];
  const exportFrom = [];

  let ast;
  try {
    ast = parse(source, { sourceType: "module", ecmaVersion: "latest", locations: false });
  } catch (err) {
    return { staticImports, dynamicImports, exportFrom, parseError: String(err.message || err), modulePath };
  }

  function addStatic(spec) {
    if (typeof spec === "string" && spec.length > 0) staticImports.push(spec);
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "ImportDeclaration":
        addStatic(node.source?.value);
        break;
      case "ExportNamedDeclaration":
        if (node.source?.value) exportFrom.push(node.source.value);
        break;
      case "ExportAllDeclaration":
        if (node.source?.value) exportFrom.push(node.source.value);
        break;
      case "ImportExpression":
        if (node.source?.type === "Literal" && typeof node.source.value === "string") {
          dynamicImports.push({ kind: "literal", value: node.source.value });
        } else {
          dynamicImports.push({ kind: "non-literal", snippet: source.slice(node.start, Math.min(node.end, node.start + 80)) });
        }
        break;
      default:
        break;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c);
      } else if (child && typeof child === "object" && child.type) {
        walk(child);
      }
    }
  }

  for (const stmt of ast.body) walk(stmt);

  return { staticImports, dynamicImports, exportFrom, parseError: null, modulePath };
}

export function loadAndParseModuleImports(modulePath) {
  const text = fs.readFileSync(modulePath, "utf8");
  return parseModuleImportsAst(text, modulePath);
}
