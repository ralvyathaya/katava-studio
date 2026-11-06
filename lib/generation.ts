// Shared generation service for normal generation and Quick Test.
// Each format uses the real existing orchestrator; concurrency is bounded to
// two per request, with independent execution deadlines and outcomes.
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ingestProductSheet } from "./ingestion";
import { runOrchestrator } from "./orchestrator";
import { redactLLMDiagnostic } from "./llm-adapter";
import type { Fact, GenerationBatch, GenerationEvent, OrchestratorResult } from "./types";

const prisma = new PrismaClient();
const formatSchema = z.enum(["instagram", "reels", "marketplace"]);
export const generationRequestSchema = z.object({
  productSheet: z.string().trim().min(1).max(50_000),
  creativeBrief: z.string().max(10_000).optional(),
  campaignGoal: z.string().trim().min(1).max(500).default("Product launch"),
  audience: z.string().trim().min(1).max(500).default("General audience"),
  format: formatSchema.optional(),
  formats: z.array(formatSchema).min(1).max(3).optional(),
  timeoutMs: z.number().int().min(1000).max(180_000).default(90_000),
}).strict().refine((value) => !(value.format && value.formats), {
  message: "Use format or formats, not both", path: ["formats"],
}).transform((value) => ({
  ...value,
  formats: [...new Set(value.formats ?? [value.format ?? "instagram"])],
}));

export type GenerationRequest = z.output<typeof generationRequestSchema>;
export interface GenerationOptions {
  signal?: AbortSignal;
  onEvent?: (event: GenerationEvent) => void;
}

export async function generateBatch(
  request: GenerationRequest,
  options: GenerationOptions = {}
): Promise<GenerationBatch> {
  const started = Date.now();
  options.signal?.throwIfAborted();
  const ingestion = ingestProductSheet(request.productSheet);
  // Atomic preparation only; never hold a SQLite transaction during LLM calls.
  const prepared = await prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({ data: {
      name: `${ingestion.productName} Launch`, brandName: ingestion.brandName,
      campaignGoal: request.campaignGoal, audience: request.audience,
      language: "id", brandTone: ingestion.brandTone, creativeBrief: request.creativeBrief,
    } });
    const source = await tx.productSource.create({ data: {
      campaignId: campaign.id, rawText: request.productSheet,
      productName: ingestion.productName, category: ingestion.category,
      brandName: ingestion.brandName,
    } });
    // Citations use these SAME source-scoped IDs in DB, prompts and output.
    const facts: Fact[] = ingestion.facts.map((fact) => ({ ...fact, id: `${source.id}:${fact.id}` }));
    for (const fact of facts) {
      await tx.productFact.create({ data: {
        id: fact.id, productSourceId: source.id, factKey: fact.factKey,
        statement: fact.statement, status: fact.status, sourceExcerpt: fact.sourceExcerpt,
      } });
    }
    const items = [];
    for (const format of request.formats) {
      const item = await tx.contentItem.create({ data: { campaignId: campaign.id, format, status: "created" } });
      items.push({ contentItemId: item.id, format });
    }
    return { campaignId: campaign.id, facts, items };
  });
  const emit = (event: GenerationEvent) => {
    // Observer failures must never change persisted review decisions.
    try { options.onEvent?.(event); } catch { /* disconnected observer */ }
  };
  const concurrency = Math.min(2, prepared.items.length);
  emit({ type: "started", ...prepared, timeoutMs: request.timeoutMs, concurrency });
  const results: OrchestratorResult[] = new Array(prepared.items.length);
  let next = 0;
  const worker = async () => {
    while (next < prepared.items.length) {
      const index = next++;
      const item = prepared.items[index];
      // Budget starts when this item actually runs, not while waiting in queue.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error(`Execution deadline exceeded (${request.timeoutMs} ms). Review incomplete; no PASS inferred.`)), request.timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, deadline.signal])
        : deadline.signal;
      let result: OrchestratorResult;
      try {
        result = await runOrchestrator({
          campaignId: prepared.campaignId, ...item, facts: prepared.facts,
          productName: ingestion.productName, category: ingestion.category,
          brandName: ingestion.brandName, brandTone: ingestion.brandTone,
          campaignGoal: request.campaignGoal, audience: request.audience,
          creativeBrief: request.creativeBrief, signal,
          onProgress: (event) => emit({ type: "progress", ...item, event }),
        });
      } catch (error) {
        // Isolate unexpected service/storage errors to the affected item.
        const reason = redactLLMDiagnostic(error instanceof Error ? error.message : "Unexpected pipeline error");
        result = { ...item, status: "review_incomplete", timeline: [], reviewCycles: 0,
          escalated: false, failureReason: reason };
        try {
          await prisma.contentItem.update({ where: { id: item.contentItemId }, data: { status: "review_incomplete" } });
          await prisma.auditEvent.create({ data: { campaignId: prepared.campaignId,
            contentItemId: item.contentItemId, actor: "generation", action: "fail_closed",
            details: JSON.stringify({ format: item.format }), verdict: "review_incomplete", error: reason } });
        } catch {
          result.failureReason = `${reason}. Persistence also failed; stored state must be checked.`;
        }
      } finally {
        clearTimeout(timer);
      }
      results[index] = result;
      emit({ type: "result", result });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const batch = { campaignId: prepared.campaignId, facts: prepared.facts, results, durationMs: Date.now() - started };
  emit({ type: "complete", campaignId: batch.campaignId, results, durationMs: batch.durationMs });
  return batch;
}
