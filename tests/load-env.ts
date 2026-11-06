// Test-environment loader for .env (Next.js loads .env automatically at
// runtime, but standalone tsx test processes do not). Secrets are only read
// into process.env; they are never printed.

import fs from "node:fs";
import path from "node:path";

// Resolve from the test directory, not the caller's shell cwd.
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
