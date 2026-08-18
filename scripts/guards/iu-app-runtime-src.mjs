import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { readAppRuntimeSrc } = require("./iu-app-runtime-src.cjs");
