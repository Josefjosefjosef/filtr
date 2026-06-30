#!/usr/bin/env node
process.env.IU_LONG_SESSION_STRESS = "1";
await import("./iu-article-long-session-memory-guard.mjs");
