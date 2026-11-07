// Production start for the App Publishing sandbox. Guarantees the SQLite
// database and internal demo policy exist (idempotent, so it survives a
// read-only or reset runtime filesystem), then starts the Next server.
import { execSync } from "node:child_process";

const DATABASE_URL = "file:./dev.db";
const port = process.env.PORT || "3000";
// Demo-only open manager mode for the public hackathon link (sandbox only).
const env = { ...process.env, DATABASE_URL, KATAVA_DEMO_OPEN_MANAGER: "1" };
const bin = (n) => `node_modules/.bin/${n}`;

console.log("[start-prod] ensuring database and demo policy");
execSync(`${bin("prisma")} db push --skip-generate --accept-data-loss`, { stdio: "inherit", env });
execSync("node scripts/deploy-bootstrap.mjs", { stdio: "inherit", env });

console.log(`[start-prod] starting next on port ${port}`);
execSync(`${bin("next")} start -p ${port} -H 0.0.0.0`, { stdio: "inherit", env });
