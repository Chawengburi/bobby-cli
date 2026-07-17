import { createRequire } from "node:module";

// Single source of truth for the CLI version — package.json. Hardcoded
// strings drifted once already (0.1.0 shipped inside the v0.2.0 tag).
const require = createRequire(import.meta.url);

export const VERSION: string = require("../package.json").version;
