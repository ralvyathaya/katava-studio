// Opt-in local setup only. Preserve all existing LLM settings and never log secrets.
import { randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = resolve(root, ".env");

// Pure planning seam for regression tests. Manager credentials are one-line
// literals; ambiguous/multiline/interpolated values fail closed, never overwritten.
export function planManagerSetup(original: string, generate = () => randomBytes(32).toString("base64url")) {
  const assignments = [...original.matchAll(/^[\t ]*(?:export[\t ]+)?KATAVA_MANAGER_KEY[\t ]*=[^\r\n]*/gm)];
  if (assignments.length > 1) throw new Error("Duplicate manager assignments require manual correction; no existing settings were overwritten.");
  const assignment = assignments[0];
  if (assignment) {
    const raw = assignment[0].slice(assignment[0].indexOf("=") + 1);
    const parsed = raw.match(/^[\t ]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^#'"\r\n]*?))[\t ]*(?:#.*)?$/);
    if (!parsed) throw new Error("Manager key must be an unambiguous one-line literal; no existing settings were overwritten.");
    const value = (parsed[1] ?? parsed[2] ?? parsed[3] ?? "").trim();
    if (/[$`\\]/.test(value)) throw new Error("Use a literal random manager key without interpolation or escapes; no settings were overwritten.");
    if (value.length >= 32) return { changed: false, content: original };
    if (value) throw new Error("Manager key exists but is too short. Set a separate random secret of at least 32 characters; no existing settings were overwritten.");
    const suffix = raw.match(/[\t ]*(#.*)$/)?.[0] ?? "";
    const replacement = `${assignment[0].slice(0, assignment[0].indexOf("=") + 1)}"${generate()}"${suffix}`;
    return { changed: true, content: original.slice(0, assignment.index) + replacement + original.slice(assignment.index! + assignment[0].length) };
  }
  return { changed: true, content: `${original}${original.endsWith("\n") ? "" : "\n"}\n# Local manager authorization; never publish or commit this value.\nKATAVA_MANAGER_KEY="${generate()}"\n` };
}

async function main(): Promise<void> {
  await access(root);
  let original: string;
  try { original = await readFile(env, "utf8"); }
  catch {
    console.error("Cannot read .env. Create it from .env.example without overwriting an existing setup, then run setup:approval again.");
    process.exitCode = 1;
    return;
  }
  let plan: ReturnType<typeof planManagerSetup>;
  try { plan = planManagerSetup(original); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Manager configuration requires manual correction. No secret printed.");
    process.exitCode = 1;
    return;
  }
  if (!plan.changed) { console.log("Manager key already configured. No changes made; no secret printed."); return; }
  // Only an absent/empty manager assignment changes. Every other byte is retained.
  await writeFile(env, plan.content, "utf8");
  console.log("Separate manager key configured in local .env. All other settings preserved. No secret printed. Restart Next, then copy KATAVA_MANAGER_KEY from .env into the manager password input when needed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    console.error("Manager setup failed. No secret printed; check local file access before retrying.");
    process.exitCode = 1;
  });
}
