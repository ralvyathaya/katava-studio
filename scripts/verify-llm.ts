// Katava Studio — LLM Access Verification
//
// Makes REAL, minimal API calls. Never simulates success.
// Usage:
//   npx tsx scripts/verify-llm.ts
//   npx tsx scripts/verify-llm.ts <baseUrl> <model>
//
// Exit code 0 is reserved for a real chat completion. A blank key, an HTTP
// error, a timeout or a malformed body all report NOT VERIFIED and exit 1.
//
// The API key is read from process.env / .env and is NEVER printed.

import fs from "node:fs";
import path from "node:path";
import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
} from "../lib/llm-adapter";

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    // Real environment variables always win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));

const apiKey = process.env.OPENAI_API_KEY || "";
const baseUrl = (
  process.argv[2] ||
  process.env.OPENAI_BASE_URL ||
  OPENAI_DEFAULT_BASE_URL
).replace(/\/$/, "");
const model = process.argv[3] || process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;

function sanitize(text: string): string {
  return apiKey ? text.split(apiKey).join("[REDACTED]") : text;
}

interface ApiError {
  code?: string | number;
  message?: string;
  request_id?: string;
}

function readError(raw: string): { error?: ApiError; parsed?: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { error: parsed.error as ApiError | undefined, parsed };
  } catch {
    return {};
  }
}

/** Informational only: some OpenAI-compatible gateways do not expose /models. */
async function checkModelCatalog(): Promise<void> {
  console.log("  STEP 1 — Model catalog: GET {baseUrl}/models (informational)");
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await res.text().catch(() => "");
    const { parsed, error } = readError(raw);
    const models = (parsed?.data as Array<{ id?: string; status?: string }> | undefined) ?? [];
    const match = models.find((m) => m.id === model);
    console.log(`  HTTP ${res.status} ${res.statusText}`);
    if (res.ok) {
      console.log(`  Catalog reachable (${models.length} models visible)`);
      console.log(`  Model '${model}' in catalog: ${match ? `yes (${match.status ?? "listed"})` : "NO"}`);
    } else {
      console.log(`  Catalog unavailable — ${error?.code ?? "-"} ${sanitize(error?.message ?? raw).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`  Catalog unavailable — network error: ${e instanceof Error ? sanitize(e.message) : String(e)}`);
  }
}

async function checkInference(): Promise<boolean> {
  console.log("");
  console.log("  STEP 2 — Inference: POST {baseUrl}/chat/completions (minimal real call)");
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Reply with the single word OK." },
          { role: "user", content: "OK?" },
        ],
        temperature: 0,
        // Reasoning models may spend all tokens on reasoning_content before
        // producing visible content. A tiny budget would return an empty
        // completion and make this check misleading.
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await res.text();
    const { error, parsed } = readError(raw);
    const content = (parsed?.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content;
    console.log(`  HTTP ${res.status} ${res.statusText} (${Date.now() - started} ms)`);

    // A 200 with an empty content string is NOT a usable completion — the
    // adapter would classify it as malformed and fail closed.
    if (res.ok && typeof content === "string" && content.trim().length > 0) {
      console.log("  RESULT: ACCESS VERIFIED (real completion received)");
      console.log(`  Model echoed by API: ${sanitize(String(parsed?.model ?? "n/a"))}`);
      console.log(`  Content: ${sanitize(content).slice(0, 120)}`);
      return true;
    }

    console.log("  RESULT: NOT VERIFIED (no successful completion)");
    console.log(`  Error code: ${sanitize(String(error?.code ?? "-"))}`);
    console.log(`  Message   : ${sanitize(error?.message ?? raw).slice(0, 400)}`);
    if (error?.request_id) console.log(`  request_id: ${sanitize(error.request_id)}`);
    return false;
  } catch (e) {
    console.log(`  RESULT: NOT VERIFIED — network error: ${e instanceof Error ? sanitize(e.message) : String(e)}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("Katava Studio — LLM access verification (real calls, no simulation)");
  console.log("────────────────────────────────────────────────────────────");
  console.log(`  Provider        : ${process.env.LLM_PROVIDER || "openai"}`);
  console.log(`  API key present : ${apiKey.length > 0 ? "yes" : "NO"}`);
  console.log(`  API key length  : ${apiKey.length}`);
  console.log(`  API key prefix  : ${apiKey.slice(0, 4)}...`);
  console.log(`  Base URL        : ${baseUrl}`);
  console.log(`  Model           : ${model}`);
  console.log("");

  if (!apiKey) {
    console.log("  RESULT: NOT VERIFIED — OPENAI_API_KEY is blank. Fill it in .env. The app fails closed.");
    process.exitCode = 1;
    return;
  }

  await checkModelCatalog();
  const verified = await checkInference();
  process.exitCode = verified ? 0 : 1;
}

main().catch((e) => {
  console.error(sanitize(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
