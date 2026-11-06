// Katava Studio — Deterministic Preflight Guard
//
// Runs BEFORE the Planner. Certain inputs are non-remediable: no amount of
// Writer revision can make them compliant, so attempting a reject/remediate
// loop would be dishonest. Those inputs escalate to a human immediately.
//
// This module is deterministic (no LLM). All findings cite real rule IDs
// from the loaded rulebook. It never claims statutory/legal compliance.

import { Fact, Finding } from "../types";

const RULE_SOURCE = "Katava demo policy v0.1";

export interface PreflightInput {
  creativeBrief?: string;
  facts: Fact[];
  category: string;
  ruleIds: string[];
}

export interface PreflightResult {
  escalate: boolean;
  reason?: string;
  findings: Finding[];
  /** Non-blocking observations, e.g. prompt-injection attempts in source data. */
  warnings: string[];
  /** True when the input can proceed to the normal Planner/Writer/Reviewer loop. */
  proceed: boolean;
}

/** Explicit instruction verbs — a brief that merely QUOTES a claim is not a demand. */
const DEMAND_PATTERNS: RegExp[] = [
  /\bmust\s+(?:say|state|claim|include|call|write|use|mention|assert)\b/i,
  /\b(?:please|kindly)\s+(?:say|state|write|include|call|use|make)\b/i,
  /\bmake\s+(?:the\s+)?(?:launch\s+)?content\s+(?:state|say|claim)/i,
  /\bcall\s+(?:it|the\s+product|this\s+product)\b/i,
  /\b(?:require[sd]?|insist|demand|ensure)\b/i,
  /\buse\s+(?:the\s+)?(?:phrase|claim|wording|testimonial)\b/i,
  /\b(?:harus|wajib|sebut|nyatakan|cantumkan|sertakan|pastikan|tolong)\b/i,
];

interface ForbiddenClaim {
  ruleId: string;
  label: string;
  patterns: RegExp[];
}

const FORBIDDEN_CLAIMS: ForbiddenClaim[] = [
  {
    ruleId: "DEMO-GUARD-001",
    label: "medical cure / efficacy claim",
    patterns: [
      /cure[sd]?/i,
      /menyembuhkan/i,
      /mengobati/i,
      /sembuh(?:\s+total)?/i,
      /obat\s+maag/i,
      /\bobat\b/i,
      /insomnia/i,
      /clinically\s+(?:proven|tested)/i,
      /khasiat/i,
      /therapeutic/i,
    ],
  },
  {
    ruleId: "DEMO-GUARD-002",
    label: "unsupported certification / authorization claim",
    patterns: [
      /\bhalal\b/i,
      /\borganic\b/i,
      /\bBPOM\b/i,
      /certif(?:ied|ication)/i,
      /bersertifikat/i,
      /sertifikasi/i,
      /tersertifikasi/i,
    ],
  },
  {
    ruleId: "DEMO-GUARD-003",
    label: "invented product detail",
    patterns: [/Rp\s*[\d,.]+/i, /endorsed\s+by/i, /\bprice\b/i, /\bharga\b/i],
  },
];

/** Instruction-override attempts. Logged, never obeyed, never escalated on their own. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+|previous\s+|above\s+)?(?:compliance|rules|instructions)/i,
  /set\s+(?:the\s+)?(?:verdict\s+to\s+)?PASS/i,
  /bypass\s+(?:the\s+)?review/i,
  /you\s+are\s+now/i,
  /forget\s+(?:all\s+)?(?:previous\s+)?(?:rules|instructions)/i,
  /disregard\s+(?:safety|rules)/i,
  /system\s+prompt/i,
  /override\s+(?:the\s+)?(?:reviewer|verdict)/i,
];

/** Categories for which the demo rulebook has no applicable coverage. */
const OUT_OF_SCOPE_CATEGORY_PATTERNS: RegExp[] = [
  /\bmedicine\b/i,
  /\bdrug\b/i,
  /\bobat\b/i,
  /suplemen|supplement/i,
  /pharmaceutical/i,
  /medical\s+device/i,
  /\bvaccine\b/i,
  /infant\s+formula/i,
];

const IN_SCOPE_CATEGORY_PATTERNS: RegExp[] = [
  /herbal\s+tea/i,
  /\btea\b/i,
  /beverage/i,
  /\bfood\b/i,
  /minuman/i,
  /makanan/i,
  /minuman\s+herbal/i,
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

function makeFinding(ruleId: string, excerpt: string, issue: string): Finding {
  return {
    severity: "block",
    excerpt,
    issue,
    ruleId,
    ruleSource: RULE_SOURCE,
    suggestedFix:
      "Change the brief so it does not require a prohibited claim, or supply verified documentation and an applicable rulebook before resubmitting. This is an internal demo policy, not legal advice.",
  };
}

/**
 * Evaluate preflight conditions. Pure function — safe to unit test.
 */
export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const findings: Finding[] = [];
  const warnings: string[] = [];

  // Combine the explicit brief with any adversarial brief embedded in the sheet.
  const embeddedBriefs = input.facts
    .filter((f) => f.factKey === "adversarial_brief")
    .map((f) => f.statement)
    .join(" ");
  const briefText = `${input.creativeBrief || ""} ${embeddedBriefs}`.trim();

  // ─── 1. Non-remediable brief: explicit demand for a forbidden claim ──
  if (briefText) {
    const demand = firstMatch(briefText, DEMAND_PATTERNS);
    if (demand) {
      for (const claim of FORBIDDEN_CLAIMS) {
        const hit = firstMatch(briefText, claim.patterns);
        if (hit && input.ruleIds.includes(claim.ruleId)) {
          findings.push(
            makeFinding(
              claim.ruleId,
              `${demand} ... ${hit}`,
              `The brief explicitly mandates a ${claim.label} ("${hit}"). ` +
                `No compliant revision exists while this requirement stands, so the pipeline escalates without drafting. ` +
                `Rule ${claim.ruleId} (${RULE_SOURCE}) requires rejecting or escalating such claims.`
            )
          );
        }
      }
    }

    // ─── 2. Injection attempts: log, never obey, never alter state ─────
    const injection = firstMatch(briefText, INJECTION_PATTERNS);
    if (injection) {
      warnings.push(
        `Instruction-override attempt detected in source data: "${injection}". ` +
          `Treated as untrusted data (DEMO-GUARD-004); agent policies and verdicts are unchanged.`
      );
    }
  }

  // ─── 3. Contradictory sources ───────────────────────────────────────
  const conflicting = input.facts.filter((f) => f.status === "conflicting");
  if (conflicting.length > 0 && input.ruleIds.includes("DEMO-GUARD-006")) {
    findings.push(
      makeFinding(
        "DEMO-GUARD-006",
        conflicting.map((f) => f.statement).join(" | ").substring(0, 200),
        "Product facts contain contradictions. A reliable compliance conclusion is impossible without reconciling the source."
      )
    );
  }

  // ─── 4. Category with no applicable rulebook coverage ───────────────
  const category = (input.category || "").trim();
  // Strip explicit negation clauses such as "do not infer medicine or
  // supplement classification" — the seed sheet uses one of these.
  const normalized = category
    .replace(/do not infer[^;,.|]*/gi, "")
    .replace(/\bnot\s+(?:a\s+)?(?:medicine|drug|supplement)\b/gi, "")
    .trim();
  let categoryProblem: string | null = null;
  if (!category || /^unknown$/i.test(category)) {
    categoryProblem = "No product category was supplied";
  } else if (OUT_OF_SCOPE_CATEGORY_PATTERNS.some((p) => p.test(normalized))) {
    categoryProblem = `Category "${category}" is outside the demo rulebook coverage`;
  } else if (!IN_SCOPE_CATEGORY_PATTERNS.some((p) => p.test(normalized))) {
    categoryProblem = `Category "${category}" is not covered by the demo rulebook`;
  }

  if (categoryProblem && input.ruleIds.includes("DEMO-GUARD-006")) {
    findings.push(
      makeFinding(
        "DEMO-GUARD-006",
        category,
        `${categoryProblem}. DEMO-GUARD-006 requires escalation or review_incomplete — ` +
          `the system must never issue a generic legal PASS or fabricate a rule. ` +
          `No statutory compliance claim is made.`
      )
    );
  }

  // ─── 5. Rulebook itself missing ─────────────────────────────────────
  if (input.ruleIds.length === 0) {
    findings.push(
      makeFinding(
        "DEMO-GUARD-006",
        "no rules loaded",
        "No rulebook entries are available, so no compliance conclusion can be reached."
      )
    );
  }

  const escalate = findings.length > 0;
  return {
    escalate,
    reason: escalate
      ? findings.map((f) => f.issue).join(" ")
      : undefined,
    findings,
    warnings,
    proceed: !escalate,
  };
}
