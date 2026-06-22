#!/usr/bin/env node
process.env.PEXELS_IMPORT_BATCH_NUMBER = "2";
const { main } = await import("./iu-pexels-import-batch.mjs");
await main();
