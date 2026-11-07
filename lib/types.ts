// Katava Studio — Core Type Definitions
// These types define the contracts for all agent I/O.

// ─── Product Facts ───────────────────────────────────────────────────

export type FactStatus = "source_backed" | "unverified" | "conflicting";

export interface Fact {
  id: string;
  factKey: string;
  statement: string;
  status: FactStatus;
  sourceExcerpt?: string;
}

// ─── Planner Agent Output ────────────────────────────────────────────

export type ContentFormat = "instagram" | "reels" | "marketplace";

export interface PlannerOutput {
  format: ContentFormat;
  audience: string;
  angle: string;
  allowedFactIds: string[];
  restrictedClaims: string[];
  notes: string[];
}

// ─── Writer Agent Output ─────────────────────────────────────────────

export interface WriterOutput {
  format: ContentFormat;
  draftText: string;
  citedFactIds: string[];
  revisionOf?: string;
}

// ─── Reviewer Agent Output ───────────────────────────────────────────

export type Verdict = "PASS" | "REJECT" | "ESCALATE";

export interface Finding {
  severity: "block" | "warning";
  excerpt: string;
  issue: string;
  ruleId: string;
  ruleSource: string;
  suggestedFix?: string;
}

export interface ReviewerOutput {
  verdict: Verdict;
  findings: Finding[];
  summary: string;
  reviewerModelId: string;
  rulebookVersionId: string;
}

// ─── Rule Engine Result ──────────────────────────────────────────────

export interface RuleEngineFinding {
  severity: "block" | "warning";
  excerpt: string;
  issue: string;
  ruleId: string;
  ruleSource: string;
  suggestedFix?: string;
}

export interface RuleEngineResult {
  hardBlocks: RuleEngineFinding[];
  warnings: RuleEngineFinding[];
  passed: boolean;
}

// ─── State Machine ───────────────────────────────────────────────────

export type ContentItemStatus =
  | "created"
  | "ingesting"
  | "planned"
  | "drafting"
  | "reviewing"
  | "review_passed"
  | "rejected"
  | "revising"
  | "escalated"
  | "review_incomplete"
  | "awaiting_client_approval"
  | "client_approved"
  | "client_rejected"
  | "client_revision_requested";

// ─── Orchestrator Timeline Event ─────────────────────────────────────

export interface TimelineEvent {
  step: string;
  agent: string;
  status: "running" | "completed" | "failed";
  timestamp: string;
  output?: unknown;
  error?: string;
  cycle?: number;
  durationMs?: number;
}

// ─── Orchestrator Result ─────────────────────────────────────────────

export interface OrchestratorResult {
  contentItemId: string;
  format: ContentFormat;
  status: ContentItemStatus;
  timeline: TimelineEvent[];
  finalDraft?: string;
  verdict?: Verdict;
  findings?: Finding[];
  reviewCycles: number;
  escalated: boolean;
  /** Explicit reason when the run failed closed or escalated. */
  failureReason?: string;
  escalationReason?: string;
  preflightWarnings?: string[];
  durationMs?: number;
  rulebookVersionId?: string;
}

// Request-bound streaming: no detached background jobs or fabricated progress.
export interface GenerationItem {
  contentItemId: string;
  format: ContentFormat;
}

export type GenerationEvent =
  | { type: "started"; campaignId: string; items: GenerationItem[]; facts: Fact[]; timeoutMs: number; concurrency: number }
  | { type: "progress"; contentItemId: string; format: ContentFormat; event: TimelineEvent }
  | { type: "result"; result: OrchestratorResult }
  | { type: "complete"; campaignId: string; durationMs: number; results: OrchestratorResult[] }
  | { type: "error"; message: string };

export interface GenerationBatch {
  campaignId: string;
  facts: Fact[];
  results: OrchestratorResult[];
  durationMs: number;
}
