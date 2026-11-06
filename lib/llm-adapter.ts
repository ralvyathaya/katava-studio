// Katava Studio — OpenAI-Compatible LLM Adapter
//
// Uses the standard OpenAI chat completions contract. Any OpenAI-compatible
// gateway can be selected through OPENAI_BASE_URL / OPENAI_MODEL without code
// changes. No vendor-specific endpoints are baked in.
//
// Security / integrity guarantees:
//   * No API key is ever hardcoded, logged, or returned in any response.
//   * Configuration is resolved from environment variables at call time.
//   * Missing credentials, timeouts, HTTP errors and malformed responses
//     all fail closed — never a fabricated completion.
//   * The test transport below is a TEST SEAM ONLY. It cannot be enabled in
//     production and is never used to represent a real integration.

export interface LLMConfig {
  provider: "openai";
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
  success: boolean;
  error?: string;
  errorKind?: "not_configured" | "timeout" | "cancelled" | "http" | "network" | "malformed";
}

/** Redact configured secrets BEFORE truncating or exposing upstream diagnostics. */
export function redactLLMDiagnostic(text: string): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? text.split(key).join("[REDACTED]") : text;
}

/** Standard OpenAI defaults. The base URL is not a secret; only the key is. */
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export class LLMNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMNotConfiguredError";
  }
}

function resolveTimeoutMs(): number {
  const raw = process.env.LLM_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20_000;
}

/**
 * Resolve the current LLM configuration from environment variables.
 * Throws LLMNotConfiguredError when no valid key exists — callers must
 * convert that into a fail-closed state, never silently proceed.
 */
export function resolveLLMConfig(): LLMConfig {
  const provider = process.env.LLM_PROVIDER || "openai";
  if (provider !== "openai") {
    throw new LLMNotConfiguredError(
      `Unsupported LLM provider: ${provider}. Only "openai" (OpenAI-compatible) is supported. ` +
        "The system fails closed — no fake LLM output will be generated."
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new LLMNotConfiguredError(
      "OpenAI API key is not configured. Set OPENAI_API_KEY in .env. " +
        "See docs/LLM_SETUP.md. The system fails closed — no fake LLM output will be generated."
    );
  }

  return {
    provider: "openai",
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL,
    timeoutMs: resolveTimeoutMs(),
  };
}

export function isLLMConfigured(): boolean {
  try {
    resolveLLMConfig();
    return true;
  } catch {
    return false;
  }
}

/** Safe status object for the health endpoint / UI. Never contains the key. */
export function getLLMStatus(): {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  configured: boolean;
  keyPresent: boolean;
} {
  try {
    const c = resolveLLMConfig();
    return {
      provider: c.provider,
      baseUrl: c.baseUrl,
      model: c.model,
      timeoutMs: c.timeoutMs,
      configured: true,
      keyPresent: true,
    };
  } catch {
    return {
      provider: process.env.LLM_PROVIDER || "openai",
      baseUrl: (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).replace(/\/$/, ""),
      model: process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL,
      timeoutMs: resolveTimeoutMs(),
      configured: false,
      keyPresent: false,
    };
  }
}

// ─── Test seam ──────────────────────────────────────────────────────────
// Deterministic contract tests need to exercise the bounded loop, escalation
// and fail-closed branches without a live model. This seam lets a test inject
// a scripted transport. It is DISABLED in production and is never used by the
// running application. Test transport output is NOT a real AI execution.
// ────────────────────────────────────────────────────────────────────────

export type TestLLMTransport = (messages: LLMMessage[]) => Promise<{
  content: string;
  success?: boolean;
  error?: string;
  delayMs?: number;
  throwError?: string;
}> | {
  content: string;
  success?: boolean;
  error?: string;
  delayMs?: number;
  throwError?: string;
};

let testTransport: TestLLMTransport | null = null;

export function __setLLMTransportForTests(transport: TestLLMTransport | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Test LLM transport is forbidden in production.");
  }
  testTransport = transport;
}

function isTestTransportActive(): boolean {
  return testTransport !== null && process.env.NODE_ENV !== "production";
}

// Test transport cancellation mirrors network cancellation. The abandoned
// transport promise may finish, but cannot resume the orchestrator or persist.
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason ?? new Error("Cancelled"));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

// ─── Network call ───────────────────────────────────────────────────────

interface RawResult {
  ok: boolean;
  status: number;
  statusText: string;
  raw: string;
  data?: Record<string, unknown>;
  error?: string;
  errorKind?: LLMResponse["errorKind"];
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /timeout|abort/i.test(error.name) || /timeout|abort/i.test(error.message);
}

/**
 * Make a REAL OpenAI-compatible chat completions call:
 * POST {baseUrl}/chat/completions with Authorization: Bearer <key>.
 * On any failure, returns success=false with a classified error.
 */
export async function callLLM(
  messages: LLMMessage[],
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean; signal?: AbortSignal }
): Promise<LLMResponse> {
  const startTime = Date.now();
  if (options?.signal?.aborted) return {
    content: "", model: isTestTransportActive() ? "scripted-test-transport" : getLLMStatus().model,
    latencyMs: 0, success: false, error: "LLM call cancelled before execution", errorKind: "cancelled",
  };

  // Test seam — only reachable in a test process with an explicitly injected
  // transport. Production always continues to the real network path below.
  if (isTestTransportActive() && testTransport) {
    try {
      const out = await abortable(Promise.resolve(testTransport(messages)), options?.signal);
      if (out.delayMs) await abortable(new Promise<void>((r) => setTimeout(r, out.delayMs)), options?.signal);
      if (out.throwError) throw new Error(out.throwError);
      const success = out.success !== false;
      return {
        content: success ? out.content : "",
        model: "scripted-test-transport",
        latencyMs: Date.now() - startTime,
        success,
        error: success ? undefined : redactLLMDiagnostic(out.error || "Scripted transport failure"),
        errorKind: success ? undefined : "http",
      };
    } catch (e) {
      return {
        content: "",
        model: "scripted-test-transport",
        latencyMs: Date.now() - startTime,
        success: false,
        error: redactLLMDiagnostic(e instanceof Error ? e.message : "Scripted transport error"),
        errorKind: options?.signal?.aborted ? "cancelled" : "network",
      };
    }
  }

  let config: LLMConfig;
  try {
    config = resolveLLMConfig();
  } catch (e) {
    return {
      content: "",
      model: "unconfigured",
      latencyMs: Date.now() - startTime,
      success: false,
      error: e instanceof Error ? e.message : "LLM not configured",
      errorKind: "not_configured",
    };
  }

  const baseBody: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2000,
  };

  const url = `${config.baseUrl}/chat/completions`;
  // One call budget across compatibility retries, plus the item/request signal.
  const callTimeout = AbortSignal.timeout(config.timeoutMs);
  const signal = options?.signal ? AbortSignal.any([options.signal, callTimeout]) : callTimeout;

  const request = async (body: Record<string, unknown>): Promise<RawResult> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
      const raw = await response.text().catch(() => "");
      let data: Record<string, unknown> | undefined;
      try {
        data = JSON.parse(raw);
      } catch {
        /* non-JSON response body */
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        raw,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: "",
        raw: "",
        error: error instanceof Error ? error.message : "Unknown network error",
        errorKind: options?.signal?.aborted ? "cancelled" : isTimeoutError(error) ? "timeout" : "network",
      };
    }
  };

  const wantsJson = options?.jsonMode === true;
  let result = await request(wantsJson ? { ...baseBody, response_format: { type: "json_object" } } : baseBody);

  // Some OpenAI-compatible gateways do not support response_format.
  // Retry once without it ONLY when the gateway explicitly complains about it.
  if (
    wantsJson &&
    !result.ok &&
    /response_format|json_object/i.test(result.raw)
  ) {
    result = await request(baseBody);
  }

  const latencyMs = Date.now() - startTime;

  if (!result.ok) {
    const detail = result.error
      ? `${result.errorKind === "timeout" ? "LLM request timed out" : "Network error"}: ${result.error}`
      : `LLM API returned ${result.status} ${result.statusText}: ${redactLLMDiagnostic(result.raw).substring(0, 500)}`;
    return {
      content: "",
      model: config.model,
      latencyMs,
      success: false,
      error: redactLLMDiagnostic(detail),
      errorKind: result.errorKind || "http",
    };
  }

  const choice = result.data?.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choice?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim() || signal.aborted) {
    return {
      content: "",
      model: config.model,
      latencyMs,
      success: false,
      error: "LLM API returned an empty or malformed response body",
      errorKind: "malformed",
    };
  }

  const usage = result.data?.usage as
    | { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
    | undefined;
  const tokensUsed =
    usage?.total_tokens ??
    (typeof usage?.prompt_tokens === "number" && typeof usage?.completion_tokens === "number"
      ? usage.prompt_tokens + usage.completion_tokens
      : undefined);

  return { content: redactLLMDiagnostic(content), model: config.model, tokensUsed, latencyMs, success: true };
}

/** Verify access with one minimal REAL call. Never simulates success. */
export async function verifyLLMAccess(): Promise<{
  configured: boolean;
  accessible: boolean;
  model: string;
  error?: string;
}> {
  const status = getLLMStatus();
  if (!status.configured) {
    return {
      configured: false,
      accessible: false,
      model: status.model,
      error: "No API key configured for the selected provider.",
    };
  }

  const response = await callLLM(
    [
      { role: "system", content: "You are a test assistant. Respond with the single word: OK" },
      { role: "user", content: "Reply OK." },
    ],
    // Some reasoning models emit reasoning tokens before any visible content.
    // A tiny budget can therefore return an empty `content` even with a valid
    // key, which callLLM correctly classifies as malformed. Give the probe
    // enough headroom so "accessible" reflects a genuinely usable completion.
    { temperature: 0, maxTokens: 256 }
  );

  return {
    configured: true,
    accessible: response.success,
    model: status.model,
    error: response.error,
  };
}
