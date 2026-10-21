#!/usr/bin/env node

/** Local HTTP server — production D1 SQL API over SQLite shim (not memory mock). */

import http from "node:http";

import path from "node:path";

import os from "node:os";

import { handleIngestRpcHttpRequest } from "./iu-cj-affiliate-phase2-cj-email-d1-rpc-service.mjs";

import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";

import { createD1SqlIngestApi } from "./iu-cj-affiliate-phase2-cj-email-d1-sql-api.mjs";



export async function startD1WorkerLocalServer(options = {}) {

  const host = options.host || process.env.IU_CJ_D1_WORKER_TEST_HOST || "127.0.0.1";

  const listenPort = Number(options.port || process.env.IU_CJ_D1_WORKER_TEST_PORT || 0);

  const token = options.token || process.env.IU_CJ_D1_WORKER_INGEST_TOKEN || "test-ingest-token-32chars-minimum-length";

  const dbPath =

    options.dbPath ||

    process.env.IU_CJ_D1_SQLITE_TEST_PATH ||

    path.join(os.tmpdir(), "iu-cj-d1-sql-test-" + process.pid + ".sqlite");



  const shim = await createNodeSqliteD1Shim(dbPath);

  if (!shim.ok) {

    throw new Error(shim.reason || "sqlite_shim_failed");

  }

  const ingestApi = await createD1SqlIngestApi(shim.db);



  const server = http.createServer(async (req, res) => {

    try {

      const url = `http://${host}${req.url || ""}`;

      const headers = new Headers();

      for (const [k, v] of Object.entries(req.headers)) {

        if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);

      }

      const chunks = [];

      for await (const chunk of req) chunks.push(chunk);

      const bodyBuf = Buffer.concat(chunks);

      const request = new Request(url, { method: req.method, headers, body: bodyBuf.length ? bodyBuf : undefined });

      const response = await handleIngestRpcHttpRequest(request, {

        IU_CJ_D1_WORKER_INGEST_TOKEN: token,

        ingestApi,

      });

      res.statusCode = response.status;

      for (const [k, v] of response.headers.entries()) res.setHeader(k, v);

      res.end(Buffer.from(await response.arrayBuffer()));

    } catch {

      res.statusCode = 500;

      res.setHeader("Content-Type", "application/json");

      res.end(JSON.stringify({ ok: false, reason: "server_error" }));

    }

  });



  return new Promise((resolve) => {

    server.listen(listenPort, host, () => {

      const addr = server.address();

      resolve({

        host,

        port: addr.port,

        baseUrl: "http://" + host + ":" + addr.port,

        token,

        dbPath,

        backend: "d1-sql-sqlite-shim",

        close: () =>

          new Promise((r) => {

            server.close(() => {

              try {

                shim.db.close();

              } catch {

                /* ignore */

              }

              r();

            });

          }),

      });

    });

  });

}



if (process.argv[1]?.includes("iu-cj-affiliate-phase2-cj-email-d1-worker-local-server.mjs")) {

  startD1WorkerLocalServer().then((s) => {

    console.log(

      JSON.stringify({

        IU_CJ_D1_WORKER_LOCAL_SERVER: "OK",

        baseUrl: s.baseUrl,

        dbPath: s.dbPath,

        backend: s.backend,

        rpcPath: "/v1/ingest/rpc",

      })

    );

  });

}


