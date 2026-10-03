/**
 * Local static file server for browser guards — always binds 127.0.0.1:0 (no port collisions).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export function createRepoStaticServer(root) {
  return http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(root, p.replace(/^\/+/, ""));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(fp).toLowerCase();
      const mime =
        ext === ".css" ? "text/css; charset=utf-8"
          : ext === ".js" ? "text/javascript; charset=utf-8"
            : ext === ".html" ? "text/html; charset=utf-8"
              : ext === ".json" ? "application/json; charset=utf-8"
                : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });
}

export function listenGuardServer(server) {
  return new Promise((resolve, reject) => {
    const onErr = (err) => reject(err);
    server.once("error", onErr);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onErr);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

export function closeGuardServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}
