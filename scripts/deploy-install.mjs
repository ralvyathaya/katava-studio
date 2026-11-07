// Build pipeline for the App Publishing sandbox. Runs as the deploy
// "install command": installs deps, generates the Prisma client, creates the
// SQLite schema, seeds the internal demo policy, and builds the Next app.
// Uses local binaries (node_modules/.bin) to avoid npx network fetches.
import { execSync } from "node:child_process";

const DATABASE_URL = "file:./dev.db";
const env = { ...process.env, DATABASE_URL };
const bin = (n) => `node_modules/.bin/${n}`;

function run(label, cmd) {
  console.log(`\n[deploy-install] ${label}`);
  execSync(cmd, { stdio: "inherit", env });
}

run("install dependencies", "npm install --include=dev");
run("generate prisma client", `${bin("prisma")} generate`);
run("push schema to sqlite", `${bin("prisma")} db push --skip-generate --accept-data-loss`);
run("seed demo policy", "node scripts/deploy-bootstrap.mjs");
run("build next app", "npm run build");
console.log("\n[deploy-install] complete");
