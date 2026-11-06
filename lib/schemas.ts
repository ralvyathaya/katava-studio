// Katava Studio — Zod Validation Schemas
// All agent LLM outputs are validated against these schemas at runtime.
// Malformed output fails closed — never approved.

import { z } from "zod";

// ─── Planner Output Schema ───────────────────────────────────────────

export const plannerOutputSchema = z.object({
  format: z.enum(["instagram", "reels", "marketplace"]),
  audience: z.string().min(1),
  angle: z.string().min(1),
  allowedFactIds: z.array(z.string()).min(1, "Must include at least one allowed fact ID"),
  restrictedClaims: z.array(z.string()),
  notes: z.array(z.string()),
});

// ─── Writer Output Schema ────────────────────────────────────────────

export const writerOutputSchema = z.object({
  format: z.enum(["instagram", "reels", "marketplace"]),
  draftText: z.string().min(10, "Draft text must be at least 10 characters"),
  citedFactIds: z.array(z.string()).min(1, "At least one factual anchor is required"),
  revisionOf: z.string().optional(),
});

// A format-contract check, NOT a new compliance rule or legal conclusion.
export function validateReelsStructure(text: string): boolean {
  const scenes = text.split(/\bScene\s+\d+[^\n]*\n/i).slice(1);
  return scenes.length >= 2 && scenes.every((scene) =>
    /\bVisual\s*:\s*\S/i.test(scene) &&
    /\bVO\s*:\s*\S/i.test(scene) &&
    /\bOverlay\s*:\s*\S/i.test(scene)
  );
}

// ─── Finding Schema ──────────────────────────────────────────────────

export const findingSchema = z.object({
  severity: z.enum(["block", "warning"]),
  excerpt: z.string().min(1, "Excerpt must quote the problematic text"),
  issue: z.string().min(1),
  ruleId: z.string().min(1, "Rule ID must be provided"),
  ruleSource: z.string().min(1, "Rule source must be provided"),
  suggestedFix: z.string().optional(),
});

// ─── Reviewer Output Schema ──────────────────────────────────────────

export const reviewerOutputSchema = z.object({
  verdict: z.enum(["PASS", "REJECT", "ESCALATE"]),
  findings: z.array(findingSchema),
  summary: z.string().min(1),
  reviewerModelId: z.string().min(1),
  rulebookVersionId: z.string().min(1),
});

// ─── Helper: Extract JSON from LLM Response ──────────────────────────

/**
 * LLMs sometimes wrap JSON in markdown code fences or prepend text.
 * This helper extracts the JSON object from the response.
 */
export function extractJson(raw: string): string {
  // Try to find JSON block in code fences
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find the first { and last }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.substring(firstBrace, lastBrace + 1);
  }

  // Return as-is and let JSON.parse fail
  return raw.trim();
}

/**
 * Parse LLM output safely. A malformed response must fail closed with an
 * explicit validation error rather than throwing an uncaught SyntaxError.
 */
export function safeParseJson(
  raw: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(extractJson(raw)) };
  } catch (e) {
    return {
      ok: false,
      error: `Malformed JSON from LLM — output fails closed: ${
        e instanceof Error ? e.message : "unknown parse error"
      }`,
    };
  }
}
