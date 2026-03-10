/**
 * Environment variable loader.
 *
 * Loads .env files from multiple paths (first found wins for each variable).
 * Must be imported BEFORE any other module that reads process.env.
 *
 * Search order:
 *   1. .env in current working directory
 *   2. ~/.atomus/aegis/.env (user config dir)
 *   3. /etc/aegis-cli/.env (system-wide config)
 */

import { config } from "dotenv";
import path from "path";

const ENV_PATHS = [
  path.resolve(process.cwd(), ".env"),
  path.join(process.env.HOME || "~", ".atomus", "aegis", ".env"),
  "/etc/aegis-cli/.env",
];

for (const envPath of ENV_PATHS) {
  config({ path: envPath, override: false });
}
