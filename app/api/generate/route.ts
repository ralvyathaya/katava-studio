// Normal generation and Quick Test share this request-bound execution path.
// NDJSON streams actual events; regular JSON preserves the single-item API.
import { NextRequest, NextResponse } from "next/server";
import { generateBatch, generationRequestSchema } from "@/lib/generation";
import { getLLMStatus, isLLMConfigured, redactLLMDiagnostic } from "@/lib/llm-adapter";
import type { GenerationEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 }); }
  const parsed = generationRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({
    error: "Invalid generation request", issues: parsed.error.issues,
  }, { status: 400 });

  if (!isLLMConfigured()) return NextResponse.json({
    error: "LLM not configured", message: "Configure OPENAI_API_KEY in .env. No fake output will be generated.",
    llm: getLLMStatus(),
  }, { status: 503 });

  const streaming = request.headers.get("accept")?.includes("application/x-ndjson");
  if (streaming) {
    const lifetime = new AbortController();
    const signal = AbortSignal.any([request.signal, lifetime.signal]);
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: GenerationEvent) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); }
          catch {
            closed = true;
            lifetime.abort(new Error("Client disconnected. Review incomplete for unfinished items."));
          }
        };
        try { await generateBatch(parsed.data, { signal, onEvent: emit }); }
        catch (error) { emit({ type: "error", message: redactLLMDiagnostic(error instanceof Error ? error.message : "Generation failed") }); }
        finally {
          if (!closed) { closed = true; controller.close(); }
        }
      },
      cancel() {
        closed = true;
        lifetime.abort(new Error("Client cancelled generation. Review incomplete for unfinished items."));
      },
    });
    return new Response(stream, { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
    } });
  }

  try {
    const batch = await generateBatch(parsed.data, { signal: request.signal });
    const single = batch.results.length === 1 ? batch.results[0] : undefined;
    return NextResponse.json({
      success: true, ...batch, ...(single ?? {}), llm: getLLMStatus(),
    });
  } catch (error) {
    return NextResponse.json({ error: "Generation failed",
      message: redactLLMDiagnostic(error instanceof Error ? error.message : "Unknown error") }, { status: 500 });
  }
}
