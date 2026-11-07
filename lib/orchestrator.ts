// Katava Studio — Orchestrator
//
// Controls the state machine: preflight guard -> Planner -> Writer ->
// deterministic Rule Engine -> Reviewer, with a bounded 3-cycle revision
// loop, human escalation, and an append-only audit trail.
//
// Fail-closed guarantee: any missing config, timeout, malformed output,
// invalid rule citation, or service error yields `review_incomplete`.
// No successful agent execution is ever simulated.

import { PrismaClient } from "@prisma/client";
import { redactLLMDiagnostic } from "./llm-adapter";
import { contentDigest, sourceDigest, policyDigest, sha256 } from "./content-integrity";
import { runPlanner, PlannerInput, PlannerResult } from "./agents/planner";
import { runWriter, WriterInput, WriterResult } from "./agents/writer";
import { runReviewer, ReviewerInput, ReviewerResult } from "./agents/reviewer";
import { runRuleEngine } from "./rules/engine";
import { evaluatePreflight } from "./rules/brief-guard";
import {
  ContentItemStatus,
  OrchestratorResult,
  TimelineEvent,
  ContentFormat,
  Fact,
  Finding,
  RuleEngineResult,
} from "./types";

const prisma = new PrismaClient();
const MAX_CYCLES = 3;

export interface PolicyPassTransaction {
  updateStatus: () => Promise<unknown>;
  appendAudit: () => Promise<unknown>;
}

/** Run INSIDE a transaction. Cancellation wins up to the final check after
 * both writes; throwing rolls them back together. After that check the terminal
 * decision owns the commit and later client disconnects cannot revoke it. */
export async function commitPolicyPass(tx: PolicyPassTransaction, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await tx.updateStatus();
  signal?.throwIfAborted();
  await tx.appendAudit();
  signal?.throwIfAborted();
}

export interface OrchestratorInput {
  campaignId: string;
  contentItemId: string;
  format: ContentFormat;
  facts: Fact[];
  productName: string;
  category: string;
  brandName: string;
  brandTone: string;
  campaignGoal: string;
  audience: string;
  creativeBrief?: string;
  signal?: AbortSignal;
  onProgress?: (event: TimelineEvent) => void;
}

interface AgentRunLike {
  rawResponse: string;
  valid: boolean;
  validationError: string | null;
  modelId: string;
  latencyMs: number;
  error?: string;
}

export async function runOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const runStarted = Date.now();
  const timeline: TimelineEvent[] = [];
  const stepStarts = new Map<string, number>();
  let cycle = 1;
  // Early cancellation/missing-policy audit intentionally has no rulebook ID.
  let rulebookVersionId: string | undefined = undefined;
  const preflightWarnings: string[] = [];

  const addTimeline = (
    step: string,
    agent: string,
    status: "running" | "completed" | "failed",
    error?: string,
    output?: unknown
  ) => {
    const key = `${step}:${cycle}`;
    let durationMs: number | undefined;
    if (status === "running") {
      stepStarts.set(key, Date.now());
    } else {
      const start = stepStarts.get(key);
      if (start !== undefined) durationMs = Date.now() - start;
    }
    const event: TimelineEvent = {
      step, agent, status, timestamp: new Date().toISOString(),
      cycle, error, output, durationMs,
    };
    timeline.push(event);
    try { input.onProgress?.(event); } catch { /* Observers cannot change verdicts. */ }
  };

  const audit = async (
    action: string,
    error?: string,
    details?: Record<string, unknown>
  ) => {
    await prisma.auditEvent.create({
      data: {
        campaignId: input.campaignId,
        contentItemId: input.contentItemId,
        actor: "orchestrator",
        action,
        details: JSON.stringify({
          ...(details || {}),
          format: input.format,
          rulebookVersionId,
        }),
        rulebookVersion: rulebookVersionId,
        verdict: (details?.verdict as string | undefined) ?? undefined,
        error,
      },
    });
  };

  const setStatus = async (status: ContentItemStatus) => {
    await prisma.contentItem.update({
      where: { id: input.contentItemId },
      data: { status },
    });
  };

  const persistRun = async (
    versionId: string | null,
    agentName: string,
    result: AgentRunLike,
    inputSummary: Record<string, unknown> = {}
  ) => {
    return prisma.agentRun.create({
      data: {
        contentItemId: input.contentItemId,
        contentVersionId: versionId,
        agentName,
        agentRole: agentName,
        inputSummary: JSON.stringify(inputSummary),
        outputRaw: (agentName === "reviewer" && result.valid
          ? redactLLMDiagnostic(result.rawResponse)
          : redactLLMDiagnostic(result.rawResponse).substring(0, 4000)) || null,
        outputValid: result.valid,
        validationError: result.validationError,
        modelId: result.modelId,
        latencyMs: result.latencyMs,
        cycleNumber: cycle,
      },
    });
  };

  const failClosed = async (
    step: string,
    agent: string,
    reason: string,
    result?: AgentRunLike
  ): Promise<OrchestratorResult> => {
    reason = redactLLMDiagnostic(reason);
    addTimeline(step, agent, "failed", reason);
    if (result) {
      await persistRun(null, agent, result, {
        step,
        cycle,
        factCount: input.facts.length,
      });
    }
    addTimeline("pipeline", "orchestrator", "failed", reason);
    await setStatus("review_incomplete");
    await audit("fail_closed", reason, { step, agent, cycle, verdict: "review_incomplete" });
    return {
      contentItemId: input.contentItemId,
      format: input.format,
      status: "review_incomplete",
      timeline,
      reviewCycles: cycle,
      escalated: false,
      failureReason: reason,
      durationMs: Date.now() - runStarted,
      rulebookVersionId,
      preflightWarnings,
    };
  };

  const escalate = async (
    reason: string,
    findings: Finding[],
    cycles: number,
    action: string
  ): Promise<OrchestratorResult> => {
    addTimeline("escalation", "orchestrator", "completed", undefined, {
      reason,
      findings,
    });
    await setStatus("escalated");
    await audit(action, undefined, {
      cycle: cycles,
      reason,
      findings,
      verdict: "ESCALATE",
    });
    return {
      contentItemId: input.contentItemId,
      format: input.format,
      status: "escalated",
      timeline,
      findings,
      verdict: "ESCALATE",
      reviewCycles: cycles,
      escalated: true,
      escalationReason: reason,
      durationMs: Date.now() - runStarted,
      rulebookVersionId,
      preflightWarnings,
    };
  };

  const interruptionReason = () => input.signal?.aborted
    ? (input.signal.reason instanceof Error ? input.signal.reason.message : "Generation cancelled. Review incomplete.")
    : undefined;

  if (input.signal?.aborted) {
    return failClosed("pipeline", "orchestrator", interruptionReason()!);
  }

  // ─── Step 0: Load active rulebook ────────────────────────────────────
  const rulebookVersion = await prisma.rulebookVersion.findFirst({
    where: { isActive: true },
    include: { rules: true },
  });

  if (!rulebookVersion) {
    return failClosed(
      "rulebook_load",
      "orchestrator",
      "No active rulebook found. Cannot reach a compliance conclusion — review incomplete."
    );
  }
  rulebookVersionId = rulebookVersion.id;
  const ruleIds = rulebookVersion.rules.map((r) => r.ruleId);

  if (input.signal?.aborted) return failClosed("preflight", "guard", interruptionReason()!);

  // ─── Step 0b: Deterministic preflight guard ─────────────────────────
  addTimeline("preflight", "guard", "running");
  const preflight = evaluatePreflight({
    creativeBrief: input.creativeBrief,
    facts: input.facts,
    category: input.category,
    ruleIds,
  });
  preflightWarnings.push(...preflight.warnings);

  for (const warning of preflight.warnings) {
    await audit("injection_attempt_logged", undefined, { warning, cycle: 0 });
  }

  if (preflight.escalate) {
    addTimeline("preflight", "guard", "completed", undefined, {
      escalate: true,
      findings: preflight.findings,
      warnings: preflight.warnings,
    });
    await audit("preflight_escalated", undefined, {
      reason: preflight.reason,
      findings: preflight.findings,
      verdict: "ESCALATE",
      cycle: 0,
    });
    return escalate(
      preflight.reason || "Non-remediable input",
      preflight.findings,
      0,
      "escalated_preflight"
    );
  }

  addTimeline("preflight", "guard", "completed", undefined, {
    escalate: false,
    warnings: preflight.warnings,
  });
  await audit("preflight_passed", undefined, { warnings: preflight.warnings, cycle: 0 });

  // ─── Step 1: Planner (distinct LLM call) ─────────────────────────────
  if (input.signal?.aborted) return failClosed("planning", "planner", interruptionReason()!);
  await setStatus("planned");
  addTimeline("planning", "planner", "running");
  const plannerInput: PlannerInput = {
    facts: input.facts,
    productName: input.productName,
    category: input.category,
    brandName: input.brandName,
    brandTone: input.brandTone,
    campaignGoal: input.campaignGoal,
    audience: input.audience,
    format: input.format,
    creativeBrief: input.creativeBrief,
    signal: input.signal,
  };

  let plannerResult: PlannerResult;
  try {
    plannerResult = await runPlanner(plannerInput);
  } catch (e) {
    return failClosed(
      "planning",
      "planner",
      `Planner threw: ${e instanceof Error ? e.message : "unknown error"}`
    );
  }

  if (input.signal?.aborted) return failClosed("planning", "planner", interruptionReason()!, {
    ...plannerResult, valid: false, validationError: interruptionReason()!,
  });
  if (!plannerResult.valid || !plannerResult.output) {
    return failClosed(
      "planning",
      "planner",
      plannerResult.validationError || plannerResult.error || "Planner output invalid",
      plannerResult
    );
  }

  addTimeline("planning", "planner", "completed", undefined, {
    allowedFactIds: plannerResult.output.allowedFactIds,
    restrictedClaims: plannerResult.output.restrictedClaims,
    angle: plannerResult.output.angle,
  });
  await persistRun(null, "planner", plannerResult, {
    format: input.format,
    factCount: input.facts.length,
    briefPresent: Boolean(input.creativeBrief),
  });
  await audit("planner_executed", undefined, { cycle: 0 });

  // ─── Review loop (max 3 cycles) ──────────────────────────────────────
  let currentDraft: string | null = null;
  let currentVersionId: string | null = null;
  let lastFindings: Finding[] = [];

  for (cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    // ─── Step 2: Writer (distinct LLM call) ───────────────────────────
    if (input.signal?.aborted) return failClosed("drafting", "writer", interruptionReason()!);
    await setStatus("drafting");
    addTimeline("drafting", "writer", "running");
    const writerInput: WriterInput = {
      plannerOutput: plannerResult.output,
      facts: input.facts,
      brandTone: input.brandTone,
      cycle,
      previousDraft: cycle > 1 ? currentDraft || undefined : undefined,
      reviewFindings: cycle > 1 ? lastFindings : undefined,
      signal: input.signal,
    };

    let writerResult: WriterResult;
    try {
      writerResult = await runWriter(writerInput);
    } catch (e) {
      return failClosed(
        "drafting",
        "writer",
        `Writer threw: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }

    if (input.signal?.aborted) return failClosed("drafting", "writer", interruptionReason()!, {
      ...writerResult, valid: false, validationError: interruptionReason()!,
    });
    if (!writerResult.valid || !writerResult.output) {
      return failClosed(
        "drafting",
        "writer",
        writerResult.validationError || writerResult.error || "Writer output invalid",
        writerResult
      );
    }

    currentDraft = writerResult.output.draftText;
    const contentVersion: { id: string } = await prisma.contentVersion.create({
      data: {
        contentItemId: input.contentItemId,
        versionNumber: cycle,
        draftText: writerResult.output.draftText,
        citedFactIds: JSON.stringify(writerResult.output.citedFactIds),
        revisionOfId: currentVersionId || undefined,
        reviewCycle: cycle,
      },
    });
    currentVersionId = contentVersion.id;

    addTimeline("drafting", "writer", "completed", undefined, {
      versionId: contentVersion.id,
      versionNumber: cycle,
      draftPreview: writerResult.output.draftText.substring(0, 200),
      draftText: writerResult.output.draftText,
      verified: false,
      citedFactIds: writerResult.output.citedFactIds,
    });
    await persistRun(currentVersionId, "writer", writerResult, {
      cycle,
      revision: cycle > 1,
      findingCount: lastFindings.length,
    });

    // ─── Step 3: Deterministic Rule Engine ───────────────────────────
    addTimeline("rule_check", "rule_engine", "running");
    const ruleEngineResult: RuleEngineResult = runRuleEngine(
      writerResult.output,
      input.facts,
      plannerResult.output.allowedFactIds
    );
    addTimeline(
      "rule_check",
      "rule_engine",
      ruleEngineResult.passed ? "completed" : "failed",
      ruleEngineResult.passed
        ? undefined
        : `${ruleEngineResult.hardBlocks.length} hard blocks, ${ruleEngineResult.warnings.length} warnings`,
      {
        passed: ruleEngineResult.passed,
        hardBlocks: ruleEngineResult.hardBlocks.length,
        warnings: ruleEngineResult.warnings.length,
      }
    );
    await persistRun(
      currentVersionId,
      "rule_engine",
      {
        rawResponse: JSON.stringify(ruleEngineResult),
        valid: true,
        validationError: null,
        modelId: "deterministic-rule-engine",
        latencyMs: 0,
      },
      { cycle, allowedFactCount: plannerResult.output.allowedFactIds.length }
    );

    for (const block of [...ruleEngineResult.hardBlocks, ...ruleEngineResult.warnings]) {
      await prisma.reviewFinding.create({
        data: {
          contentItemId: input.contentItemId,
          contentVersionId: contentVersion.id,
          severity: block.severity,
          excerpt: block.excerpt,
          issue: block.issue,
          ruleId: block.ruleId,
          ruleSource: block.ruleSource,
          suggestedFix: block.suggestedFix,
        },
      });
    }

    // ─── Step 4: Reviewer (distinct LLM call) ────────────────────────
    if (input.signal?.aborted) return failClosed("reviewing", "reviewer", interruptionReason()!);
    await setStatus("reviewing");
    addTimeline("reviewing", "reviewer", "running");
    const reviewerInput: ReviewerInput = {
      writerOutput: writerResult.output,
      facts: input.facts,
      ruleEngineResult,
      plannerAngle: plannerResult.output.angle,
      brandTone: input.brandTone,
      rulebookEntries: rulebookVersion.rules.map((r) => ({
        ruleId: r.ruleId,
        policyText: r.policyText,
        requiredEvidence: r.requiredEvidence,
      })),
      rulebookVersionId: rulebookVersion.id,
      cycle,
      signal: input.signal,
    };

    let reviewerResult: ReviewerResult;
    try {
      reviewerResult = await runReviewer(reviewerInput);
    } catch (e) {
      return failClosed(
        "reviewing",
        "reviewer",
        `Reviewer threw: ${e instanceof Error ? e.message : "unknown error"}`
      );
    }

    if (input.signal?.aborted) return failClosed("reviewing", "reviewer", interruptionReason()!, {
      ...reviewerResult, valid: false, validationError: interruptionReason()!,
    });
    if (!reviewerResult.valid || !reviewerResult.output) {
      return failClosed(
        "reviewing",
        "reviewer",
        reviewerResult.validationError || reviewerResult.error || "Reviewer output invalid",
        reviewerResult
      );
    }

    for (const finding of reviewerResult.output.findings) {
      await prisma.reviewFinding.create({
        data: {
          contentItemId: input.contentItemId,
          contentVersionId: contentVersion.id,
          severity: finding.severity,
          excerpt: finding.excerpt,
          issue: finding.issue,
          ruleId: finding.ruleId,
          ruleSource: finding.ruleSource,
          suggestedFix: finding.suggestedFix,
        },
      });
    }

    addTimeline("reviewing", "reviewer", "completed", undefined, {
      verdict: reviewerResult.output.verdict,
      findingsCount: reviewerResult.output.findings.length,
      rulebookVersionId: rulebookVersion.id,
    });
    // Save complete canonical validated output, not truncated diagnostic JSON.
    const reviewerRun = await persistRun(currentVersionId, "reviewer", {
      ...reviewerResult, rawResponse: JSON.stringify(reviewerResult.output),
    }, {
      cycle,
      rulebookRuleCount: ruleIds.length,
    });
    await audit("review_completed", undefined, {
      cycle,
      verdict: reviewerResult.output.verdict,
      findingsCount: reviewerResult.output.findings.length,
      contentVersionId: currentVersionId,
    });

    lastFindings = reviewerResult.output.findings;

    // ─── Decision ───────────────────────────────────────────────────
    // Hard blocks from the deterministic Rule Engine can never be
    // overridden by a Reviewer PASS (defence in depth).
    const hardBlocked = ruleEngineResult.hardBlocks.length > 0;
    const effectiveVerdict =
      hardBlocked && reviewerResult.output.verdict === "PASS"
        ? "REJECT"
        : reviewerResult.output.verdict;

    if (input.signal?.aborted) return failClosed("pipeline", "orchestrator", interruptionReason()!);

    if (effectiveVerdict === "PASS") {
      const approvedContentDigest = contentDigest(currentDraft!, JSON.stringify(writerResult.output!.citedFactIds), input.format);
      const reviewedPolicyDigest = policyDigest(rulebookVersion);
      try {
        await prisma.$transaction(async (tx) => commitPolicyPass({
          updateStatus: () => tx.contentItem.update({ where: { id: input.contentItemId }, data: { status: "review_passed" } }),
          appendAudit: () => tx.auditEvent.create({ data: {
            campaignId: input.campaignId, contentItemId: input.contentItemId,
            contentVersionId: currentVersionId,
            actor: "orchestrator", action: "review_passed", verdict: "PASS",
            rulebookVersion: rulebookVersionId,
            details: JSON.stringify({ cycle, verdict: "PASS", format: input.format, rulebookVersionId,
              contentVersionId: currentVersionId,
              contentDigest: approvedContentDigest, policyDigest: reviewedPolicyDigest,
              sourceDigest: sourceDigest(input.facts), reviewerRunId: reviewerRun.id,
              reviewerDigest: sha256(reviewerRun.outputRaw ?? ""),
            }),
          } }),
        }, input.signal));
      } catch (error) {
        return failClosed("pipeline", "orchestrator", interruptionReason() ??
          `Terminal policy decision could not be committed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      addTimeline("pipeline", "orchestrator", "completed", undefined, {
        status: "review_passed",
        note: "Awaiting human approval before publication. Demo policy pass, not statutory certification.",
      });
      return {
        contentItemId: input.contentItemId,
        format: input.format,
        status: "review_passed",
        timeline,
        finalDraft: currentDraft || undefined,
        verdict: "PASS",
        findings: reviewerResult.output.findings,
        reviewCycles: cycle,
        escalated: false,
        durationMs: Date.now() - runStarted,
        rulebookVersionId,
        preflightWarnings,
      };
    }

    if (effectiveVerdict === "ESCALATE") {
      await audit("review_escalated", undefined, {
        cycle,
        reason: reviewerResult.output.summary,
      });
      return escalate(
        reviewerResult.output.summary,
        reviewerResult.output.findings,
        cycle,
        "escalated_reviewer"
      );
    }

    // REJECT
    await audit("review_rejected", undefined, {
      cycle,
      findings: lastFindings,
      verdict: "REJECT",
    });

    if (cycle >= MAX_CYCLES) {
      return escalate(
        `Maximum ${MAX_CYCLES} review cycles exhausted without a pass. Human escalation required.`,
        lastFindings,
        cycle,
        "escalated_max_cycles"
      );
    }

    await setStatus("revising");
    addTimeline("revising", "writer", "running", undefined, {
      findings: lastFindings.map((f) => ({
        ruleId: f.ruleId,
        issue: f.issue,
        suggestedFix: f.suggestedFix,
      })),
    });
  }

  // Defensive: the loop must always return. Fail closed if it falls through.
  return failClosed(
    "pipeline",
    "orchestrator",
    "Review loop terminated unexpectedly without a verdict."
  );
}
